import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
import { DesignShotTool, screen, sizes } from "../../src/tool/design-shot"
import { Instance } from "../../src/project/instance"
import { Truncate } from "../../src/tool/truncate"
import { Agent } from "../../src/agent/agent"
import { SessionID, MessageID } from "../../src/session/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { AppFileSystem } from "../../src/filesystem"

const ctx = {
  sessionID: SessionID.make("ses_test-design-shot"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "design",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

afterEach(async () => {
  await Instance.disposeAll()
})

const it = testEffect(
  Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer, AppFileSystem.defaultLayer, CrossSpawnSpawner.defaultLayer),
)

describe("tool.design_shot", () => {
  test("accepts only screens inside a design folder", () => {
    expect(screen("design/Req.design/List.html")).toBe("design/Req.design/List.html")
    expect(screen("design\\app\\Req.design\\List.html")).toBe("design/app/Req.design/List.html")
    expect(screen("./design/x/../Req.design/List.html")).toBe("design/Req.design/List.html")
    expect(screen("design/Req.design/canvas.json")).toBeUndefined()
    expect(screen("design/Req.design/assets/a.html")).toBeUndefined()
    expect(screen("design/page.html")).toBeUndefined()
    expect(screen("src/x.html")).toBeUndefined()
    expect(screen("../design/Req.design/List.html")).toBeUndefined()
    expect(screen("design/../../Req.design/List.html")).toBeUndefined()
    expect(screen("/design/Req.design/List.html")).toBeUndefined()
    expect(screen("C:/design/Req.design/List.html")).toBeUndefined()
  })

  test("draws the frame, and a fluid page also at phone width", () => {
    expect(sizes(undefined)).toEqual([{ w: 1440, h: 980 }])
    expect(sizes({ w: 1280, h: 800, fluid: true })).toEqual([
      { w: 1280, h: 800 },
      { w: 390, h: 844 },
    ])
    expect(sizes({ w: 390, h: 844, fluid: true })).toEqual([{ w: 390, h: 844 }])
    expect(sizes({ w: 1280, h: 800 })).toEqual([{ w: 1280, h: 800 }])
    expect(sizes({ w: 1280, h: 800, fluid: true }, 768)).toEqual([{ w: 768, h: 800 }])
  })

  // Works with or without a browser on the machine: it either returns the pictures or says the check was skipped.
  it.live(
    "returns the drawn screen as images, or says the check was skipped",
    () =>
      provideTmpdirInstance((dir) =>
        Effect.gen(function* () {
          const root = path.join(dir, "design", "Req.design")
          yield* Effect.promise(async () => {
            await fs.mkdir(root, { recursive: true })
            await fs.writeFile(
              path.join(root, "canvas.json"),
              JSON.stringify({ v: 1, screens: { "List.html": { x: 0, y: 0, w: 800, h: 600, fluid: true } } }),
            )
            await fs.writeFile(path.join(root, "List.html"), "<!doctype html><h1>List</h1>")
          })
          const tool = yield* (yield* DesignShotTool).init()
          const result = yield* tool.execute({ path: "design/Req.design/List.html" }, ctx)
          if (result.output.startsWith("The visual check was skipped")) return
          expect(result.attachments?.map((item) => item.mime)).toEqual(["image/png", "image/png"])
          expect(result.output).toContain("800x600 and 390x844")
          expect(result.attachments?.[0]?.url.startsWith("data:image/png;base64,")).toBe(true)
          const exit = yield* tool.execute({ path: "src/x.html" }, ctx).pipe(Effect.exit)
          expect(exit._tag).toBe("Failure")
        }),
      ),
    60_000,
  )
})
