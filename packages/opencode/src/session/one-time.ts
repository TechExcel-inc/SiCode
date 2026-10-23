import z from "zod"
import { Effect, Option } from "effect"
import { NamedError } from "@opencode-ai/util/error"
import { Session } from "./index"
import { MessageV2 } from "./message-v2"
import { MessageID, PartID, SessionID } from "./schema"
import { Provider } from "@/provider/provider"
import { Agent } from "@/agent/agent"

/**
 * One-session-only models: a session opened for a single special-service model.
 * The model is stored on the session and wins over every other model choice
 * (composer pick, agent model, command model), so the server holds the lock.
 */
export namespace SessionOneTime {
  export const ClosedError = NamedError.create(
    "SessionOneTimeClosedError",
    z.object({ sessionID: z.string(), message: z.string() }),
  )
  export const LimitError = NamedError.create(
    "SessionOneTimeLimitError",
    z.object({ sessionID: z.string(), limit: z.number(), message: z.string() }),
  )

  export const OnlyError = NamedError.create(
    "SessionOneTimeOnlyError",
    z.object({ providerID: z.string(), modelID: z.string(), message: z.string() }),
  )

  export type Model = Session.OneTime["model"]

  /** Refuses a one-session-only model in a regular session. */
  export function only(model: Provider.Model) {
    if (!model.oneSession) return
    return new OnlyError({
      providerID: model.providerID,
      modelID: model.id,
      message: `${model.name} is a one-session model. Open it in a one-time session from the model picker.`,
    })
  }

  /** The session, or undefined when it was deleted. `Session.get` reports a missing row as a defect. */
  const find = (sessions: Session.Interface, id: SessionID) =>
    sessions.get(id).pipe(Effect.catchDefect(() => Effect.succeed(undefined)))

  /** Why this session can't take another turn, or undefined when it can (or isn't a one-time session). */
  export function blocked(session: Session.Info) {
    const one = session.oneTime
    if (!one) return
    if (one.status === "closed")
      return new ClosedError({
        sessionID: session.id,
        message: "This one-time session is closed. Reopen it to send another request.",
      })
    if (one.limit !== undefined && one.requests >= one.limit)
      return new LimitError({
        sessionID: session.id,
        limit: one.limit,
        message: `This one-time session has used all ${one.limit} requests. Mark it done or reopen it.`,
      })
  }

  /** The variant to use under a lock: the locked one if set, else the requested one. */
  export function variant(model: Model | undefined, requested: string | undefined) {
    if (!model) return requested
    return model.variant ?? requested
  }

  export const OpenInput = z.object({
    originSessionID: SessionID.zod.optional(),
    model: Session.OneTime.shape.model,
    title: z.string().optional(),
    limit: z.number().int().positive().optional(),
  })
  export type OpenInput = z.output<typeof OpenInput>

  export const open = Effect.fn("SessionOneTime.open")(function* (input: OpenInput) {
    const sessions = yield* Session.Service
    const provider = yield* Provider.Service
    const model = yield* provider.getModel(input.model.providerID, input.model.modelID)
    const from = input.originSessionID ? yield* find(sessions, input.originSessionID) : undefined
    return yield* sessions.create({
      directory: from?.directory,
      workspaceID: from?.workspaceID,
      title: input.title ?? (from ? `⟡ ${model.name} · from "${from.title}"` : `⟡ ${model.name}`),
      oneTime: {
        model: input.model,
        originSessionID: from?.id,
        status: "open",
        requests: 0,
        limit: input.limit ?? model.oneSession?.limit,
        allowance: input.limit ?? model.oneSession?.limit,
        time: { opened: Date.now() },
      },
    })
  })

  export const DoneInput = z.object({
    sessionID: SessionID.zod,
    goTo: z.enum(["origin", "new"]),
    addResult: z.boolean(),
  })
  export type DoneInput = z.output<typeof DoneInput>

  export const done = Effect.fn("SessionOneTime.done")(function* (input: DoneInput) {
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const session = yield* sessions.get(input.sessionID)
    const one = session.oneTime
    if (!one) throw new Error(`Session ${session.id} is not a one-time session`)

    const origin = one.originSessionID ? yield* find(sessions, one.originSessionID) : undefined
    const usable = origin && !origin.time.archived ? origin : undefined

    // Already closed: return the same target as the first call.
    if (one.status === "closed" && one.targetSessionID)
      return { session, targetSessionID: one.targetSessionID, fallback: false }

    const target =
      input.goTo === "origin" && usable
        ? usable
        : yield* sessions.create({ directory: session.directory, workspaceID: session.workspaceID })

    // Nothing was asked in it: drop the session instead of keeping an empty closed record.
    if ((yield* sessions.messages({ sessionID: session.id, limit: 1 })).length === 0) {
      yield* sessions.remove(session.id)
      return {
        session: { ...session, oneTime: { ...one, status: "closed" as const, targetSessionID: target.id } },
        targetSessionID: target.id,
        fallback: input.goTo === "origin" && !usable,
        removed: true,
      }
    }

    const card = input.addResult ? yield* result(target.id, session, agents) : undefined
    const next: Session.OneTime = {
      ...one,
      status: "closed",
      resultMessageID: card ?? one.resultMessageID,
      targetSessionID: target.id,
      time: { ...one.time, closed: Date.now() },
    }
    yield* sessions.setOneTime({ sessionID: session.id, oneTime: next })
    return {
      session: { ...session, oneTime: next },
      targetSessionID: target.id,
      fallback: input.goTo === "origin" && !usable,
      removed: false,
    }
  })

  /** Writes a card into the target session that links back to the one-time session. No model turn runs. */
  const result = Effect.fnUntraced(function* (target: SessionID, session: Session.Info, agents: Agent.Interface) {
    const sessions = yield* Session.Service
    const provider = yield* Provider.Service
    const one = session.oneTime!
    const model = yield* provider
      .getModel(one.model.providerID, one.model.modelID)
      .pipe(Effect.catchDefect(() => Effect.succeed(undefined)))
    const last = yield* sessions.findMessage(target, (m) => m.info.role === "user")
    const prior = Option.getOrUndefined(last)?.info
    const user = prior?.role === "user" ? prior : undefined
    const msg: MessageV2.User = {
      id: MessageID.ascending(),
      role: "user",
      sessionID: target,
      time: { created: Date.now() },
      agent: user?.agent ?? (yield* agents.defaultAgent()),
      model: user?.model ?? { providerID: one.model.providerID, modelID: one.model.modelID },
    }
    const name = model?.name ?? `${one.model.providerID}/${one.model.modelID}`
    const answer = excerpt(yield* sessions.messages({ sessionID: session.id }))
    const head = `Result from one-time session "${session.title}" (${name}, ${one.requests} request${one.requests === 1 ? "" : "s"}).`
    yield* sessions.updateMessage(msg)
    yield* sessions.updatePart({
      id: PartID.ascending(),
      messageID: msg.id,
      sessionID: target,
      type: "text",
      // The text is what the model sees on the next turn here, so it carries the answer itself.
      text: answer ? `${head}\n\n${answer}` : head,
      metadata: {
        oneTimeResult: {
          sessionID: session.id,
          title: session.title,
          model: one.model,
          name,
          requests: one.requests,
          answer,
        },
      },
    } satisfies MessageV2.TextPart)
    yield* sessions.touch(target)
    return msg.id
  })

  /** The last answer in a session, trimmed to a size that fits as context in another session. */
  export function excerpt(messages: MessageV2.WithParts[], max = 1500) {
    const last = messages.findLast((m) => m.info.role === "assistant" && m.parts.some((p) => p.type === "text"))
    const text = (last?.parts ?? [])
      .flatMap((p) => (p.type === "text" && !p.synthetic ? [p.text] : []))
      .join("\n")
      .trim()
    if (text.length <= max) return text
    return text.slice(0, max).trimEnd() + "…"
  }

  export const reopen = Effect.fn("SessionOneTime.reopen")(function* (sessionID: SessionID) {
    const sessions = yield* Session.Service
    const session = yield* sessions.get(sessionID)
    const one = session.oneTime
    if (!one) throw new Error(`Session ${session.id} is not a one-time session`)
    const next: Session.OneTime = {
      ...one,
      status: "open",
      // A reopened session gets a fresh allowance on top of what it already used.
      limit: one.allowance ? one.requests + one.allowance : one.limit,
      targetSessionID: undefined,
      time: { opened: one.time.opened },
    }
    yield* sessions.setOneTime({ sessionID, oneTime: next })
    return { ...session, oneTime: next }
  })
}
