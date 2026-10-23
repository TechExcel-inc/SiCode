import path from "path"
import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { Job } from "../../src/tool/job"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

// A local OpenAI-compatible endpoint: the reply to a job's message is a turn of the agent, and this
// answers it with "ok" and counts the requests.
function chat() {
  const state = { requests: 0 }
  const encoder = new TextEncoder()
  const server = Bun.serve({
    port: 0,
    async fetch() {
      state.requests++
      const chunks = [
        { choices: [{ delta: { role: "assistant" } }] },
        { choices: [{ delta: { content: "ok" } }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ]
      const payload =
        chunks.map((c) => `data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", ...c })}`).join("\n\n") +
        "\n\ndata: [DONE]\n\n"
      return new Response(encoder.encode(payload), { headers: { "content-type": "text/event-stream" } })
    },
  })
  return { server, state }
}

async function within(url: string, fn: (dir: string) => Promise<void>) {
  const config = {
    provider: {
      test: {
        name: "Test",
        id: "test",
        env: [],
        npm: "@ai-sdk/openai-compatible",
        models: {
          regular: {
            id: "regular",
            name: "Regular",
            attachment: false,
            reasoning: false,
            temperature: false,
            tool_call: true,
            release_date: "2025-01-01",
            limit: { context: 100000, output: 10000 },
            cost: { input: 0, output: 0 },
            options: {},
          },
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
  await Instance.provide({ directory: tmp.path, fn: () => fn(tmp.path) })
}

async function until<T>(read: () => Promise<T | undefined>, ms = 15_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const value = await read()
    if (value !== undefined) return value
    await Bun.sleep(100)
  }
  throw new Error("timed out")
}

const notes = async (id: Session.Info["id"]) =>
  (await Session.messages({ sessionID: id })).flatMap((msg) =>
    msg.parts.flatMap((part) =>
      part.type === "text" && part.synthetic && part.metadata?.job ? [part as MessageV2.TextPart] : [],
    ),
  )

describe("background jobs", () => {
  test("a job's end comes back to the session with its exit code and output, and the agent replies", async () => {
    const ai = chat()
    try {
      await within(`http://localhost:${ai.server.port}`, async (dir) => {
        const session = await Session.create({})
        const job = Job.start({
          sessionID: session.id,
          agent: "build",
          command: "echo building; echo done-line; exit 3",
          description: "Builds the app",
          cwd: dir,
          shell: "/bin/sh",
          env: process.env,
        })
        const [note] = await until(async () => {
          const list = await notes(session.id)
          return list.length ? list : undefined
        })
        expect(note.metadata?.job).toMatchObject({ id: job.id, code: 3, stopped: false })
        expect(note.text).toContain("failed with exit code 3")
        expect(note.text).toContain("done-line")
        // The message started a turn of the agent.
        await until(async () => (ai.state.requests > 0 ? true : undefined))
        expect(Job.running(job.id)).toBe(false)
      })
    } finally {
      ai.server.stop(true)
    }
  })

  test("a stopped job says it was stopped", async () => {
    const ai = chat()
    try {
      await within(`http://localhost:${ai.server.port}`, async (dir) => {
        const session = await Session.create({})
        const job = Job.start({
          sessionID: session.id,
          agent: "build",
          command: "echo serving; sleep 30",
          description: "Starts the dev server",
          cwd: dir,
          shell: "/bin/sh",
          env: process.env,
        })
        expect(Job.running(job.id)).toBe(true)
        await until(async () => (Job.tail(job.file).includes("serving") ? true : undefined))
        expect(Job.stop(job.id)).toBe(true)
        const [note] = await until(async () => {
          const list = await notes(session.id)
          return list.length ? list : undefined
        })
        expect(note.text).toContain("was stopped")
        expect(Job.list(session.id).map((item) => item.id)).toEqual([job.id])
      })
    } finally {
      ai.server.stop(true)
    }
  })
})
