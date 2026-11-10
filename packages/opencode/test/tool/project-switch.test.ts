import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Foreign } from "../../src/project/foreign"
import { Instance } from "../../src/project/instance"
import { Question } from "../../src/question"
import { MessageID, SessionID } from "../../src/session/schema"
import { ProjectSwitchTool } from "../../src/tool/project"
import { Truncate } from "../../src/tool/truncate"
import { Log } from "../../src/util/log"
import { provideTmpdirInstance, tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

Log.init({ print: false })

const it = testEffect(Layer.mergeAll(Question.defaultLayer, CrossSpawnSpawner.defaultLayer, Truncate.defaultLayer, Agent.defaultLayer))

const ctx = {
  sessionID: SessionID.make("ses_moved-here"),
  messageID: MessageID.make("test-message"),
  callID: "test-call",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

describe("project_switch", () => {
  it.live("keeps work the person moved here instead of sending it back", () =>
    Effect.gen(function* () {
      const other = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir({ git: true })),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => Instance.provide({ directory: other.path, fn: async () => {} }))

      yield* provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const question = yield* Question.Service
            const tool = yield* (yield* ProjectSwitchTool).init()
            Foreign.arrive("ses_moved-here", other.path)

            const result = yield* tool.execute({ project: other.path, prompt: "Design the sort control", changes: "src/list.tsx" }, ctx)
            expect(result.title).toContain("Kept in")
            expect(result.output).toContain("moved this work here")
            expect(yield* question.list()).toEqual([])
            expect(Foreign.stays("ses_moved-here", other.path)).toBe(true)
          }),
        { git: true },
      )
    }),
  )

  it.live("reads where moved work came from out of the session, so it holds after a restart", () =>
    Effect.gen(function* () {
      const other = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir({ git: true })),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => Instance.provide({ directory: other.path, fn: async () => {} }))
      const name = other.path.split("/").at(-1)!

      yield* provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const question = yield* Question.Service
            const tool = yield* (yield* ProjectSwitchTool).init()
            const messages = [
              { info: { role: "user" }, parts: [{ type: "text", text: `Design the sort tip\n\n(Continued from a session in ${name}.)` }] },
            ] as never
            const result = yield* tool.execute(
              { project: other.path, prompt: "Design the sort tip", changes: "src/list.tsx" },
              { ...ctx, sessionID: SessionID.make("ses_after-restart"), messages },
            )
            expect(result.title).toContain("Kept in")
            expect(yield* question.list()).toEqual([])
          }),
        { git: true },
      )
    }),
  )

  it.live("keeps work that changes nothing in the other project, such as a design, without asking", () =>
    Effect.gen(function* () {
      const other = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir({ git: true })),
        (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => Instance.provide({ directory: other.path, fn: async () => {} }))

      yield* provideTmpdirInstance(
        () =>
          Effect.gen(function* () {
            const question = yield* Question.Service
            const tool = yield* (yield* ProjectSwitchTool).init()
            const result = yield* tool.execute(
              { project: other.path, prompt: "Design a sort tooltip", changes: " " },
              { ...ctx, sessionID: SessionID.make("ses_design-only") },
            )
            expect(result.output).toContain("must change")
            expect(yield* question.list()).toEqual([])
          }),
        { git: true },
      )
    }),
  )
})
