import { beforeAll, describe, expect, mock, test } from "bun:test"
import { createStore } from "solid-js/store"
import type { State, VcsCache } from "./types"

const toasts: unknown[] = []
mock.module("@opencode-ai/ui/toast", () => ({ showToast: (input: unknown) => toasts.push(input) }))

let bootstrap: typeof import("./bootstrap")
beforeAll(async () => {
  bootstrap = await import("./bootstrap")
})

const answers: Record<string, unknown> = {
  "app.agents": [],
  "config.get": {},
  "session.status": {},
  "project.current": { id: "p" },
  "path.get": { directory: "/repo" },
  "vcs.get": undefined,
  "command.list": [],
  "permission.list": [],
  "question.list": [],
  "mcp.status": {},
  "provider.list": { all: [], connected: [], default: {} },
}

/** An SDK whose calls answer from `answers`, except the ones `fail` replaces. */
function sdk(fail: Record<string, () => Promise<unknown>> = {}) {
  return new Proxy(
    {},
    {
      get: (_, group: string) =>
        new Proxy(
          {},
          {
            get: (_, method: string) => () => {
              const key = `${group}.${method}`
              if (fail[key]) return fail[key]()
              return Promise.resolve({ data: answers[key] })
            },
          },
        ),
    },
  ) as never
}

function run(input: { sdk: never; quiet?: boolean }) {
  const [store, setStore] = createStore({
    status: "loading",
    provider: { all: [], connected: [], default: {} },
    config: {},
    session: [],
    permission: {},
    question: {},
    limit: 5,
  } as unknown as State)
  const result = bootstrap.bootstrapDirectory({
    directory: "/repo",
    sdk: input.sdk,
    store,
    setStore,
    vcsCache: { setStore: () => undefined } as unknown as VcsCache,
    loadSessions: () => undefined,
    translate: (key) => key,
    quiet: input.quiet,
    global: { config: {}, path: { directory: "" } as never, project: [], provider: { all: [] } as never },
  })
  return { store, result }
}

describe("withTimeout", () => {
  test("rejects a promise that never settles", async () => {
    const never = new Promise<void>(() => undefined)
    await expect(bootstrap.withTimeout(never, 10)).rejects.toThrow("No answer from the engine")
  })

  test("passes an answer through", async () => {
    expect(await bootstrap.withTimeout(Promise.resolve(1), 10)).toBe(1)
  })

  test("marks no answer as worth another try, and other errors not", async () => {
    const never = new Promise<void>(() => undefined)
    const err = await bootstrap.withTimeout(never, 10).catch((e) => e)
    expect(bootstrap.expired(err)).toBe(true)
    expect(bootstrap.expired(new Error("Not found"))).toBe(false)
  })
})

describe("bootstrapDirectory", () => {
  test("marks the directory complete when every request answers", async () => {
    const { store, result } = run({ sdk: sdk() })
    expect(await result).toBe(true)
    expect(store.status).toBe("complete")
  })

  test("reports a failed request so the caller can try again", async () => {
    toasts.length = 0
    const { store, result } = run({ sdk: sdk({ "config.get": () => Promise.reject(new Error("boom")) }) })
    expect(await result).toBe(false)
    expect(store.status).toBe("partial")
    expect(toasts.length).toBe(1)
  })

  test("a quiet retry does not repeat the error toast", async () => {
    toasts.length = 0
    const { result } = run({ sdk: sdk({ "config.get": () => Promise.reject(new Error("boom")) }), quiet: true })
    expect(await result).toBe(false)
    expect(toasts.length).toBe(0)
  })
})
