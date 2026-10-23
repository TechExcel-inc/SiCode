import path from "path"
import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { SessionOneTime } from "../../src/session/one-time"
import { SessionPrompt } from "../../src/session/prompt"
import { Provider } from "../../src/provider/provider"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

const premium = { providerID: ProviderID.make("test"), modelID: ModelID.make("premium") }
const regular = { providerID: ProviderID.make("test"), modelID: ModelID.make("regular") }

function model(id: string) {
  return {
    id,
    name: id === "premium" ? "Premium Review" : "Regular",
    attachment: false,
    reasoning: false,
    temperature: false,
    tool_call: true,
    release_date: "2025-01-01",
    limit: { context: 100000, output: 10000 },
    cost: { input: 0, output: 0 },
    options: {},
  }
}

// A local OpenAI-compatible endpoint that answers every chat request with "done",
// and records which model each request asked for.
function chat() {
  const seen: string[] = []
  const tags: (string | null)[] = []
  const plans: (string | null)[] = []
  const encoder = new TextEncoder()
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as { model: string }
      seen.push(body.model)
      tags.push(req.headers.get("x-sicode-one-time"))
      plans.push(req.headers.get("x-sicode-origin-plan"))
      const chunks = [
        { choices: [{ delta: { role: "assistant" } }] },
        { choices: [{ delta: { content: "done" } }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ]
      const payload =
        chunks.map((c) => `data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", ...c })}`).join("\n\n") +
        "\n\ndata: [DONE]\n\n"
      return new Response(encoder.encode(payload), { headers: { "content-type": "text/event-stream" } })
    },
  })
  return { server, seen, tags, plans }
}

async function within(fn: () => Promise<void>, url = "http://localhost:1") {
  // The project config loader reads opencode.json (config.ts projectFiles("opencode")),
  // while tmpdir's `config` option writes kloudcode.json, so write the file directly.
  const config = {
    provider: {
      test: {
        name: "Test",
        id: "test",
        env: [],
        npm: "@ai-sdk/openai-compatible",
        models: {
          premium: { ...model("premium"), one_session: { price: "≈ $0.40 / request", limit: 5 } },
          regular: model("regular"),
        },
        options: { apiKey: "test-key", baseURL: `${url}/v1` },
      },
    },
    agent: { build: { model: "test/regular" } },
  }
  await using tmp = await tmpdir({
    git: true,
    init: (dir) => Bun.write(path.join(dir, "opencode.json"), JSON.stringify(config)),
  })
  await Instance.provide({ directory: tmp.path, fn })
}

const open = (input: SessionOneTime.OpenInput) => AppRuntime.runPromise(SessionOneTime.open(input))
const done = (input: SessionOneTime.DoneInput) => AppRuntime.runPromise(SessionOneTime.done(input))
const reopen = (id: Session.Info["id"]) => AppRuntime.runPromise(SessionOneTime.reopen(id))
// A question without a model turn, so the session is no longer empty.
const ask = (id: Session.Info["id"]) =>
  SessionPrompt.prompt({ sessionID: id, agent: "build", noReply: true, parts: [{ type: "text", text: "question" }] })

describe("one-time session data", () => {
  test("open stores the lock and the origin, and it survives a reload", async () => {
    await within(async () => {
      const origin = await Session.create({ title: "Plan cost work" })
      const session = await open({ originSessionID: origin.id, model: premium, limit: 3 })

      expect(session.title).toBe('⟡ Premium Review · from "Plan cost work"')
      const stored = await Session.get(session.id)
      expect(stored.oneTime).toMatchObject({
        model: premium,
        originSessionID: origin.id,
        status: "open",
        requests: 0,
        limit: 3,
      })
      expect(stored.parentID).toBeUndefined()
    })
  })

  test("open rejects a model the provider doesn't know", async () => {
    await within(async () => {
      await expect(
        open({ model: { providerID: ProviderID.make("test"), modelID: ModelID.make("no-such-model") } }),
      ).rejects.toThrow()
    })
  })

  test("fork of a one-time session is a normal session", async () => {
    await within(async () => {
      const session = await open({ model: premium })
      const fork = await Session.fork({ sessionID: session.id })
      expect(fork.oneTime).toBeUndefined()
    })
  })

  test("deleting the origin keeps the one-time session", async () => {
    await within(async () => {
      const origin = await Session.create({})
      const session = await open({ originSessionID: origin.id, model: premium })
      await Session.remove(origin.id)
      expect((await Session.get(session.id)).oneTime?.originSessionID).toBe(origin.id)
    })
  })
})

describe("one-time model lock", () => {
  test("the locked model wins over the requested model and the agent model", async () => {
    await within(async () => {
      const session = await open({ model: premium })
      const msg = await SessionPrompt.prompt({
        sessionID: session.id,
        agent: "build",
        model: regular,
        noReply: true,
        parts: [{ type: "text", text: "review this" }],
      })
      if (msg.info.role !== "user") throw new Error("expected user message")
      expect(msg.info.model.providerID).toBe(premium.providerID)
      expect(msg.info.model.modelID).toBe(premium.modelID)
    })
  })

  test("a locked variant wins over the requested variant", async () => {
    await within(async () => {
      const session = await open({ model: { ...premium, variant: "high" } })
      const msg = await SessionPrompt.prompt({
        sessionID: session.id,
        agent: "build",
        variant: "low",
        noReply: true,
        parts: [{ type: "text", text: "review this" }],
      })
      if (msg.info.role !== "user") throw new Error("expected user message")
      expect(msg.info.model.variant).toBe("high")
    })
  })

  test("a real turn runs on the locked model and counts as a request", async () => {
    const mock = chat()
    try {
      await within(async () => {
        const session = await open({ model: premium })
        const reply = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          model: regular,
          parts: [{ type: "text", text: "review this" }],
        })
        expect(mock.seen).toContain("premium")
        expect(mock.seen).not.toContain("regular")
        expect(mock.tags).toContain(session.id)
        if (reply.info.role !== "assistant") throw new Error("expected assistant message")
        expect(reply.info.modelID).toBe(premium.modelID)
        expect((await Session.get(session.id)).oneTime?.requests).toBe(1)
      }, mock.server.url.origin)
    } finally {
      mock.server.stop(true)
    }
  })

  test("a one-time request names the parent session's EAD plan for reading images", async () => {
    const mock = chat()
    try {
      await within(async () => {
        const origin = await Session.create({})
        await SessionPrompt.prompt({
          sessionID: origin.id,
          agent: "build",
          model: { providerID: ProviderID.make("ead"), modelID: ModelID.make("EAD 3.2") },
          noReply: true,
          parts: [{ type: "text", text: "earlier work on the plan" }],
        })
        const session = await open({ originSessionID: origin.id, model: premium })
        await SessionPrompt.prompt({ sessionID: session.id, agent: "build", parts: [{ type: "text", text: "look" }] })
        expect(mock.plans).toContain("EAD 3.2")
      }, mock.server.url.origin)
    } finally {
      mock.server.stop(true)
    }
  })

  test("noReply messages don't count as requests", async () => {
    await within(async () => {
      const session = await open({ model: premium, limit: 1 })
      await SessionPrompt.prompt({
        sessionID: session.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "context" }],
      })
      expect((await Session.get(session.id)).oneTime?.requests).toBe(0)
    })
  })

  test("a closed session refuses a new turn", async () => {
    await within(async () => {
      const session = await open({ model: premium })
      await ask(session.id)
      await done({ sessionID: session.id, goTo: "new", addResult: false })
      await expect(
        SessionPrompt.prompt({ sessionID: session.id, agent: "build", parts: [{ type: "text", text: "again" }] }),
      ).rejects.toThrow("SessionOneTimeClosedError")
    })
  })

  test("a session at its limit refuses a new turn", async () => {
    await within(async () => {
      const session = await open({ model: premium, limit: 2 })
      await AppRuntime.runPromise(
        Session.Service.use((svc) =>
          svc.setOneTime({ sessionID: session.id, oneTime: { ...session.oneTime!, requests: 2 } }),
        ),
      )
      await expect(
        SessionPrompt.prompt({ sessionID: session.id, agent: "build", parts: [{ type: "text", text: "more" }] }),
      ).rejects.toThrow("SessionOneTimeLimitError")
    })
  })

  test("blocked() is quiet for normal sessions", async () => {
    await within(async () => {
      expect(SessionOneTime.blocked(await Session.create({}))).toBeUndefined()
    })
  })
})

describe("one-session-only models", () => {
  test("open takes the request limit from the model setting", async () => {
    await within(async () => {
      const session = await open({ model: premium })
      expect(session.oneTime?.limit).toBe(5)
    })
  })

  test("an explicit limit wins over the model setting", async () => {
    await within(async () => {
      const session = await open({ model: premium, limit: 2 })
      expect(session.oneTime?.limit).toBe(2)
    })
  })

  test("the provider exposes the one-session setting", async () => {
    await within(async () => {
      const found = await AppRuntime.runPromise(
        Provider.Service.use((svc) => svc.getModel(premium.providerID, premium.modelID)),
      )
      expect(found.oneSession).toEqual({ price: "≈ $0.40 / request", limit: 5 })
      const plain = await AppRuntime.runPromise(
        Provider.Service.use((svc) => svc.getModel(regular.providerID, regular.modelID)),
      )
      expect(plain.oneSession).toBeUndefined()
    })
  })

  test("a regular session refuses a one-session model", async () => {
    await within(async () => {
      const session = await Session.create({})
      await expect(
        SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          model: premium,
          parts: [{ type: "text", text: "review this" }],
        }),
      ).rejects.toThrow("SessionOneTimeOnlyError")
    })
  })
})

describe("one-time done and reopen", () => {
  test("done returns to the origin and adds a result card there", async () => {
    await within(async () => {
      const origin = await Session.create({})
      const session = await open({ originSessionID: origin.id, model: premium })
      await ask(session.id)
      const result = await done({ sessionID: session.id, goTo: "origin", addResult: true })

      expect(result.targetSessionID).toBe(origin.id)
      expect(result.removed).toBe(false)
      expect(result.fallback).toBe(false)
      expect(result.session.oneTime?.status).toBe("closed")

      const msgs = await Session.messages({ sessionID: origin.id })
      const card = msgs.at(-1)
      expect(card?.info.id).toBe(result.session.oneTime!.resultMessageID!)
      const part = card?.parts[0]
      expect(part?.type === "text" && part.metadata?.oneTimeResult?.sessionID).toBe(session.id)
      // the card is not a model turn
      expect(msgs.filter((m) => m.info.role === "assistant")).toHaveLength(0)
    })
  })

  test("done falls back to a new session when the origin is gone", async () => {
    await within(async () => {
      const origin = await Session.create({})
      const session = await open({ originSessionID: origin.id, model: premium })
      await ask(session.id)
      await Session.remove(origin.id)
      const result = await done({ sessionID: session.id, goTo: "origin", addResult: true })
      expect(result.fallback).toBe(true)
      expect(result.targetSessionID).not.toBe(origin.id)
      expect((await Session.messages({ sessionID: result.targetSessionID })).length).toBe(1)
    })
  })

  test("done twice returns the same target", async () => {
    await within(async () => {
      const session = await open({ model: premium })
      await ask(session.id)
      const first = await done({ sessionID: session.id, goTo: "new", addResult: false })
      const second = await done({ sessionID: session.id, goTo: "new", addResult: false })
      expect(second.targetSessionID).toBe(first.targetSessionID)
    })
  })

  test("reopen grants a fresh allowance after the limit is used", async () => {
    await within(async () => {
      const session = await open({ model: premium, limit: 2 })
      await AppRuntime.runPromise(
        Session.Service.use((svc) =>
          svc.setOneTime({ sessionID: session.id, oneTime: { ...session.oneTime!, requests: 2 } }),
        ),
      )
      expect(SessionOneTime.blocked(await Session.get(session.id))).toBeDefined()
      await ask(session.id)
      await done({ sessionID: session.id, goTo: "new", addResult: false })
      const again = await reopen(session.id)
      expect(again.oneTime?.limit).toBe(4)
      expect(SessionOneTime.blocked(await Session.get(session.id))).toBeUndefined()
    })
  })

  test("the result card carries the one-time session's last answer", async () => {
    const mock = chat()
    try {
      await within(async () => {
        const origin = await Session.create({})
        const session = await open({ originSessionID: origin.id, model: premium })
        await SessionPrompt.prompt({ sessionID: session.id, agent: "build", parts: [{ type: "text", text: "go" }] })
        await done({ sessionID: session.id, goTo: "origin", addResult: true })
        const card = (await Session.messages({ sessionID: origin.id })).at(-1)
        const part = card?.parts[0]
        if (part?.type !== "text") throw new Error("expected a text part")
        expect(part.text).toContain("done")
        expect(part.metadata?.oneTimeResult).toMatchObject({
          sessionID: session.id,
          name: "Premium Review",
          answer: "done",
        })
      }, mock.server.url.origin)
    } finally {
      mock.server.stop(true)
    }
  })

  test("reopen lets the session take turns again", async () => {
    await within(async () => {
      const session = await open({ model: premium })
      await ask(session.id)
      await done({ sessionID: session.id, goTo: "new", addResult: false })
      const again = await reopen(session.id)
      expect(again.oneTime?.status).toBe("open")
      expect(again.oneTime?.time.closed).toBeUndefined()
      expect(SessionOneTime.blocked(await Session.get(session.id))).toBeUndefined()
    })
  })
})

describe("empty sessions are not kept", () => {
  test("done deletes a one-time session nobody asked anything in", async () => {
    await within(async () => {
      const origin = await Session.create({})
      const session = await open({ originSessionID: origin.id, model: premium })
      const result = await done({ sessionID: session.id, goTo: "origin", addResult: true })
      expect(result.removed).toBe(true)
      expect(result.targetSessionID).toBe(origin.id)
      await expect(Session.get(session.id)).rejects.toThrow()
      // no result card for a session that produced nothing
      expect(await Session.messages({ sessionID: origin.id })).toHaveLength(0)
    })
  })

  test("done & new session also drops an empty one-time session", async () => {
    await within(async () => {
      const session = await open({ model: premium })
      const result = await done({ sessionID: session.id, goTo: "new", addResult: true })
      expect(result.removed).toBe(true)
      await expect(Session.get(session.id)).rejects.toThrow()
      expect((await Session.get(result.targetSessionID)).id).toBe(result.targetSessionID)
    })
  })

  test("sweep deletes sessions without messages and keeps the rest", async () => {
    await within(async () => {
      const empty = await Session.create({})
      const used = await Session.create({})
      await ask(used.id)
      const parent = await Session.create({})
      const child = await Session.create({ parentID: parent.id })
      await ask(child.id)
      // made in this run, so only an explicit cutoff after them makes them old enough
      expect(await Session.sweep()).toBe(0)
      expect(await Session.sweep(Date.now() + 1)).toBe(1)
      await expect(Session.get(empty.id)).rejects.toThrow()
      expect((await Session.get(used.id)).id).toBe(used.id)
      // a session whose child has the conversation stays
      expect((await Session.get(parent.id)).id).toBe(parent.id)
    })
  })
})
