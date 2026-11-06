import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { streamText } from "ai"
import { Cause, Effect, Schedule } from "effect"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Instance } from "../../src/project/instance"
import { ProviderError } from "../../src/provider/error"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionRetry } from "../../src/session/retry"
import { tmpdir } from "../fixture/fixture"

const encoder = new TextEncoder()
const chunk = (text: string) =>
  encoder.encode(
    `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [{ delta: { content: text } }] })}\n\n`,
  )
const sse = (body: ReadableStream<Uint8Array>) =>
  new Response(body, { headers: { "Content-Type": "text/event-stream" } })

const replies: Record<string, () => Response | Promise<Response>> = {
  // One chunk, then silence with the connection left open.
  "/silent/v1/chat/completions": () =>
    sse(
      new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(chunk("Hello"))
        },
      }),
    ),
  // No response at all.
  "/mute/v1/chat/completions": () => new Promise<Response>(() => {}),
  // Slower overall than the limit, but no single gap is.
  "/slow/v1/chat/completions": () =>
    sse(
      new ReadableStream({
        async start(ctrl) {
          for (const text of ["a", "b", "c", "d", "e", "f"]) {
            ctrl.enqueue(chunk(text))
            await Bun.sleep(100)
          }
          ctrl.enqueue(encoder.encode("data: [DONE]\n\n"))
          ctrl.close()
        },
      }),
    ),
}

let server: ReturnType<typeof Bun.serve>

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch: (req) => replies[new URL(req.url).pathname]?.() ?? new Response("not found", { status: 404 }),
  })
})

afterAll(() => {
  delete process.env.OPENCODE_CONFIG_CONTENT
  server.stop(true)
})

async function run(route: string) {
  process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
    enabled_providers: ["ead"],
    provider: {
      ead: {
        name: "EAD",
        npm: "@ai-sdk/openai-compatible",
        options: { apiKey: "test", baseURL: `${server.url.origin}/${route}/v1`, chunkTimeout: 300 },
        models: { "EAD 3.2": { name: "EAD 3.2" } },
      },
    },
  })
  await using tmp = await tmpdir({ git: true })
  return Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const language = await AppRuntime.runPromise(
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          return yield* provider.getLanguage(yield* provider.getModel(ProviderID.make("ead"), ModelID.make("EAD 3.2")))
        }),
      )
      const result = streamText({ model: language, prompt: "hi", maxRetries: 0, onError: () => {} })
      const found = { text: "", error: undefined as unknown }
      // The error either arrives as a stream part or fails the stream itself; the processor handles both.
      const read = async () => {
        for await (const part of result.fullStream) {
          if (part.type === "text-delta") found.text += part.text
          if (part.type === "error") found.error = part.error
        }
      }
      await read().catch((err) => {
        found.error = err
      })
      return found
    },
  })
}

const parse = (e: unknown) => MessageV2.fromError(e, { providerID: ProviderID.make("ead") })

describe("stalled model replies", () => {
  test("a reply that goes silent ends in a retryable error", async () => {
    const found = await run("silent")
    expect(found.text).toBe("Hello")
    expect(SessionRetry.retryable(parse(found.error))).toBe("The model stopped responding")
  })

  test("a request that never gets a response ends in a retryable error", async () => {
    const found = await run("mute")
    expect(SessionRetry.retryable(parse(found.error))).toBe("The model stopped responding")
  })

  test("a slow reply that keeps sending is left alone", async () => {
    const found = await run("slow")
    expect(found.error).toBeUndefined()
    expect(found.text).toBe("abcdef")
  })

  test("retries stop after the limit", async () => {
    const error = parse(Object.assign(new Error("SSE read timed out"), { code: ProviderError.STALLED }))
    const seen: number[] = []
    const end = await Effect.runPromise(
      Effect.gen(function* () {
        const step = yield* Schedule.toStepWithMetadata(
          SessionRetry.policy({
            parse: (err) => err as MessageV2.APIError,
            set: (info) => Effect.sync(() => void seen.push(info.attempt)),
          }),
        )
        return yield* Effect.forever(step(error)).pipe(Effect.catchCause((cause) => Effect.succeed(Cause.isDone(cause))))
      }),
    )
    expect(end).toBeDefined()
    expect(seen).toEqual([1, 2, 3])
  })
})
