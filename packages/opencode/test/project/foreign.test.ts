import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import type { Tool } from "../../src/tool/tool"
import type { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { Foreign } from "../../src/project/foreign"
import { assertExternalDirectory } from "../../src/tool/external-directory"
import { SessionID, MessageID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

function ctx(session: string) {
  const asked: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
  const value: Tool.Context = {
    sessionID: SessionID.make(session),
    messageID: MessageID.make(""),
    callID: "",
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => Effect.void,
    ask: (req) =>
      Effect.sync(() => {
        asked.push(req)
      }),
  }
  return { asked, value }
}

const client = process.env["OPENCODE_CLIENT"]
afterEach(() => {
  if (client === undefined) delete process.env["OPENCODE_CLIENT"]
  else process.env["OPENCODE_CLIENT"] = client
})

describe("project.foreign", () => {
  test("lists the other projects and finds the one a path is in", async () => {
    await using home = await tmpdir({ git: true })
    await using other = await tmpdir({ git: true })
    await Instance.provide({ directory: other.path, fn: async () => {} })

    await Instance.provide({
      directory: home.path,
      fn: async () => {
        expect(Foreign.projects().map((item) => item.worktree)).toContain(other.path)
        expect(Foreign.projects().map((item) => item.worktree)).not.toContain(home.path)
        expect(Foreign.owner(path.join(other.path, "src", "a.ts"))?.worktree).toBe(other.path)
        expect(Foreign.owner(path.join(home.path, "a.ts"))).toBeUndefined()
        expect(Foreign.here()).toBe(path.basename(home.path))
        expect(Foreign.find(other.path)?.worktree).toBe(other.path)
        expect(Foreign.find(path.basename(other.path).toUpperCase())?.worktree).toBe(other.path)
        expect(Foreign.find(path.join(other.path, "src"))?.worktree).toBe(other.path)
        expect(Foreign.find("src")).toBeUndefined()
      },
    })
  })

  test("holds an edit in another project until project_switch keeps it here", async () => {
    process.env["OPENCODE_CLIENT"] = "desktop"
    await using home = await tmpdir({ git: true })
    await using other = await tmpdir({ git: true })
    await Instance.provide({ directory: other.path, fn: async () => {} })
    const file = path.join(other.path, "a.ts")
    const run = ctx("ses_foreign_edit")

    await Instance.provide({
      directory: home.path,
      fn: async () => {
        await expect(assertExternalDirectory(run.value, file, { write: true })).rejects.toThrow("project_switch")
        // Reading another project for reference is not held.
        await assertExternalDirectory(run.value, file)
        expect(run.asked.map((req) => req.permission)).toEqual(["external_directory"])

        Foreign.keep("ses_foreign_edit", other.path)
        await assertExternalDirectory(run.value, file, { write: true })
        expect(run.asked.length).toBe(1)
      },
    })
  })

  test("does not hold edits where no app answers project_switch", async () => {
    process.env["OPENCODE_CLIENT"] = "cli"
    await using home = await tmpdir({ git: true })
    await using other = await tmpdir({ git: true })
    await Instance.provide({ directory: other.path, fn: async () => {} })
    const run = ctx("ses_foreign_cli")

    await Instance.provide({
      directory: home.path,
      fn: async () => {
        await assertExternalDirectory(run.value, path.join(other.path, "a.ts"), { write: true })
        expect(run.asked.map((req) => req.permission)).toEqual(["external_directory"])
      },
    })
  })
})
