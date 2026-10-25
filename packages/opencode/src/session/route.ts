import z from "zod"
import { Effect, Stream } from "effect"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { Foreign } from "@/project/foreign"
import { Related } from "@/project/related"
import { Session } from "./index"
import { LLM } from "./llm"
import { MessageV2 } from "./message-v2"
import { SessionID } from "./schema"

/**
 * Where a request sent in a session with earlier work belongs: here, a new session in this project, or a
 * new session in another of the user's projects. Read by the small model before the request runs.
 */
export namespace SessionRoute {
  export const Input = z.object({
    text: z.string(),
    files: z.string().array().optional(),
  })

  export const Result = z
    .object({
      where: z.enum(["here", "new", "project"]),
      title: z.string().optional(),
      directory: z.string().optional().describe("The project folder for where=project"),
      project: z.string().optional().describe("The project's name for where=project"),
    })
    .meta({ ref: "SessionRoute" })
  export type Result = z.infer<typeof Result>

  const HERE: Result = { where: "here" }

  const PROMPT = [
    `You route a coding assistant user's new request. The user is in a session that already has work in it.`,
    `Decide whether the new request continues that session's work, or is a separate task that should start in its own session.`,
    ``,
    `Answer "here" for: follow-ups, corrections, refinements, retries, approvals ("yes", "do it", "commit", "deploy it"), questions about the session's work or its results, and anything that builds on or relates to it. Answer "here" when unsure.`,
    `Answer "new" only when the request is clearly a different task with nothing to do with the session's work.`,
    `Answer "project" only when the request is clearly a separate task for one of the listed other projects (for example the user names it).`,
    ``,
    `Reply with only one line of JSON, no other text:`,
    `{"where":"here"}`,
    `{"where":"new","title":"<short name of the new task, a few words, in the user's language>"}`,
    `{"where":"project","project":"<project name exactly as listed>","title":"<short name>"}`,
  ].join("\n")

  /** The model's JSON line as a result; anything unreadable is "here". */
  export function parse(text: string): Result {
    const json = text.replace(/<think>[\s\S]*?<\/think>/g, "").match(/\{[\s\S]*?\}/)?.[0]
    if (!json) return HERE
    const out = Result.safeParse((() => {
      try {
        return JSON.parse(json)
      } catch {
        return undefined
      }
    })())
    if (!out.success) return HERE
    const title = out.data.title?.trim().slice(0, 100) || undefined
    if (out.data.where === "here") return HERE
    if (out.data.where === "new") return { where: "new", title }
    return { where: "project", title, project: out.data.project?.trim() || undefined }
  }

  /** A project answer names a known other project; otherwise the new task starts in this project. */
  export function resolve(result: Result): Result {
    if (result.where !== "project") return result
    const hit = result.project ? Foreign.find(result.project) : undefined
    if (!hit || Related.dirs().includes(hit.worktree)) return { where: "new", title: result.title }
    return { where: "project", title: result.title, project: Foreign.name(hit), directory: hit.worktree }
  }

  const real = (m: MessageV2.WithParts) =>
    m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic)

  const words = (m: MessageV2.WithParts) =>
    m.parts
      .flatMap((p) => (p.type === "text" && !p.synthetic ? [p.text] : []))
      .join("\n")
      .trim()

  export const route = Effect.fn("SessionRoute.route")(function* (sessionID: SessionID, input: z.infer<typeof Input>) {
    const sessions = yield* Session.Service
    const session = yield* sessions.get(sessionID)
    if (session.parentID || session.oneTime || !input.text.trim()) return HERE
    const msgs = (yield* sessions.messages({ sessionID, limit: 60 })).toSorted((a, b) =>
      a.info.id.localeCompare(b.info.id),
    )
    const users = msgs.filter(real)
    const last = users.at(-1)?.info
    if (!last || last.role !== "user") return HERE

    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const llm = yield* LLM.Service
    const ag = yield* agents.get("title")
    if (!ag) return HERE
    const mdl = ag.model
      ? yield* provider.getModel(ag.model.providerID, ag.model.modelID)
      : ((yield* provider.getSmallModel(last.model.providerID)) ??
        (yield* provider.getModel(last.model.providerID, last.model.modelID)))

    const requests = users.slice(-10).map((m) => {
      const name = m.info.role === "user" ? m.info.summary?.title : undefined
      return `  - ${name ?? words(m).slice(0, 200).replaceAll("\n", " ")}`
    })
    const reply = msgs.findLast((m) => m.info.role === "assistant" && words(m))
    const related = Related.dirs().map(Related.name)
    const others = Foreign.projects()
      .filter((item) => !Related.dirs().includes(item.worktree))
      .slice(0, 30)
      .map(Foreign.name)
    const context = [
      `Project: ${Foreign.here()}${related.length ? ` (with related projects ${related.join(", ")}, worked on from the same sessions)` : ""}`,
      `Session title: ${session.title}`,
      `Earlier requests in this session:`,
      ...requests,
      ...(reply ? [`End of the assistant's last reply:`, words(reply).slice(-600)] : []),
      ...(others.length ? [`Other projects:`, ...others.map((name) => `  - ${name}`)] : []),
      ``,
      `New request:`,
      input.text.slice(0, 2000),
      ...(input.files?.length ? [`Attached: ${input.files.join(", ")}`] : []),
    ].join("\n")

    const text = yield* llm
      .stream({
        agent: { ...ag, prompt: PROMPT, temperature: 0 },
        user: last,
        system: [],
        small: true,
        tools: {},
        model: mdl,
        sessionID,
        retries: 1,
        messages: [{ role: "user", content: context }],
      })
      .pipe(
        Stream.filter((e): e is Extract<LLM.Event, { type: "text-delta" }> => e.type === "text-delta"),
        Stream.map((e) => e.text),
        Stream.mkString,
      )
    return resolve(parse(text))
  })
}
