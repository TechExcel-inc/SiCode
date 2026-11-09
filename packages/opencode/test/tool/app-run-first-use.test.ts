import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { Question } from "../../src/question"
import { MessageID, SessionID } from "../../src/session/schema"
import { AppRun, AppRunTool } from "../../src/tool/app-run"
import { Truncate } from "../../src/tool/truncate"
import { Log } from "../../src/util/log"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

Log.init({ print: false })

const it = testEffect(
  Layer.mergeAll(Question.defaultLayer, CrossSpawnSpawner.defaultLayer, Truncate.defaultLayer, Agent.defaultLayer),
)

const ctx = {
  sessionID: SessionID.make("ses_test-session"),
  messageID: MessageID.make("test-message"),
  callID: "test-call",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const pending = Effect.fn("AppRunTest.pending")(function* (question: Question.Interface) {
  for (;;) {
    const item = (yield* question.list())[0]
    if (item) return item
    yield* Effect.sleep("10 millis")
  }
})

describe("first use", () => {
  it.live("asks once to save what the project suggests, and runs only after a yes", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const port = 20000 + Math.floor(Math.random() * 20000)
          yield* Effect.promise(() =>
            Bun.write(
              `${dir}/package.json`,
              JSON.stringify({ scripts: { dev: `true --port ${port}` } }),
            ),
          )
          const question = yield* Question.Service
          const tool = yield* (yield* AppRunTool).init()

          const declined = yield* tool.execute({ action: "dev" }, ctx).pipe(Effect.forkScoped)
          const first = yield* pending(question)
          expect(first.questions[0].question).toContain("Dev server: npm run dev")
          expect(first.questions[0].question).toContain(`Port: ${port}`)
          yield* question.reply({ requestID: first.id, answers: [["Not now"]] })
          expect((yield* Fiber.join(declined)).title).toBe("Run commands not saved")
          expect(AppRun.commands().dev).toBeUndefined()

          const accepted = yield* tool.execute({ action: "dev" }, ctx).pipe(Effect.forkScoped)
          const second = yield* pending(question)
          yield* question.reply({ requestID: second.id, answers: [["Save and run"]] })
          yield* Fiber.join(accepted)
          expect(AppRun.commands()).toMatchObject({ dev: "npm run dev", port })
          expect((yield* question.list()).length).toBe(0)
        }),
      { git: true },
    ),
    30_000,
  )

  it.live("does not start the dev server when another app answers on its port", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          using other = Bun.serve({ port: 0, fetch: () => new Response("another app") })
          const project = Instance.project.id
          yield* Effect.promise(() =>
            Project.update({ projectID: project, commands: { dev: "exit 0", port: other.port } }),
          )
          const tool = yield* (yield* AppRunTool).init()
          const result = yield* tool.execute({ action: "dev" }, ctx)
          expect(result.title).toBe(`Port ${other.port} is in use`)
          expect(AppRun.running()).toBeUndefined()
        }),
      { git: true },
    ),
  )
})
