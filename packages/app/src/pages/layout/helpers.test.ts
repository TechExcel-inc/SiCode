import { describe, expect, test } from "bun:test"
import {
  collectNewSessionDeepLinks,
  collectOpenProjectDeepLinks,
  drainPendingDeepLinks,
  parseDeepLink,
  parseNewSessionDeepLink,
} from "./deep-links"
import { type Session } from "@opencode-ai/sdk/v2/client"
import {
  startupProject,
  currentProjectRoot,
  childSessionOnPath,
  displayName,
  scoped,
  effectiveWorkspaceOrder,
  errorMessage,
  hasProjectPermissions,
  latestRootSession,
  workspaceKey,
} from "./helpers"
import { nestOneTime, oneTimeRows } from "./helpers"
import { activeSessions, runStopSteps, sessionAttention, stopSteps, type ActiveSource } from "./active-sessions"
import type { PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2/client"

const session = (input: Partial<Session> & Pick<Session, "id" | "directory">) =>
  ({
    title: "",
    version: "v2",
    parentID: undefined,
    messageCount: 0,
    permissions: { session: {}, share: {} },
    time: { created: 0, updated: 0, archived: undefined },
    ...input,
  }) as Session

describe("layout deep links", () => {
  test("parses open-project deep links", () => {
    expect(parseDeepLink("opencode://open-project?directory=/tmp/demo")).toBe("/tmp/demo")
  })

  test("ignores non-project deep links", () => {
    expect(parseDeepLink("opencode://other?directory=/tmp/demo")).toBeUndefined()
    expect(parseDeepLink("https://example.com")).toBeUndefined()
  })

  test("ignores malformed deep links safely", () => {
    expect(() => parseDeepLink("opencode://open-project/%E0%A4%A%")).not.toThrow()
    expect(parseDeepLink("opencode://open-project/%E0%A4%A%")).toBeUndefined()
  })

  test("parses links when URL.canParse is unavailable", () => {
    const original = Object.getOwnPropertyDescriptor(URL, "canParse")
    Object.defineProperty(URL, "canParse", { configurable: true, value: undefined })
    try {
      expect(parseDeepLink("opencode://open-project?directory=/tmp/demo")).toBe("/tmp/demo")
    } finally {
      if (original) Object.defineProperty(URL, "canParse", original)
      if (!original) Reflect.deleteProperty(URL, "canParse")
    }
  })

  test("ignores open-project deep links without directory", () => {
    expect(parseDeepLink("opencode://open-project")).toBeUndefined()
    expect(parseDeepLink("opencode://open-project?directory=")).toBeUndefined()
  })

  test("collects only valid open-project directories", () => {
    const result = collectOpenProjectDeepLinks([
      "opencode://open-project?directory=/a",
      "opencode://other?directory=/b",
      "opencode://open-project?directory=/c",
    ])
    expect(result).toEqual(["/a", "/c"])
  })

  test("parses new-session deep links with optional prompt", () => {
    expect(parseNewSessionDeepLink("opencode://new-session?directory=/tmp/demo")).toEqual({ directory: "/tmp/demo" })
    expect(parseNewSessionDeepLink("opencode://new-session?directory=/tmp/demo&prompt=hello%20world")).toEqual({
      directory: "/tmp/demo",
      prompt: "hello world",
    })
  })

  test("ignores new-session deep links without directory", () => {
    expect(parseNewSessionDeepLink("opencode://new-session")).toBeUndefined()
    expect(parseNewSessionDeepLink("opencode://new-session?directory=")).toBeUndefined()
  })

  test("collects only valid new-session deep links", () => {
    const result = collectNewSessionDeepLinks([
      "opencode://new-session?directory=/a",
      "opencode://open-project?directory=/b",
      "opencode://new-session?directory=/c&prompt=ship%20it",
    ])
    expect(result).toEqual([{ directory: "/a" }, { directory: "/c", prompt: "ship it" }])
  })

  test("drains global deep links once", () => {
    const target = {
      __OPENCODE__: {
        deepLinks: ["opencode://open-project?directory=/a"],
      },
    } as unknown as Window & { __OPENCODE__?: { deepLinks?: string[] } }

    expect(drainPendingDeepLinks(target)).toEqual(["opencode://open-project?directory=/a"])
    expect(drainPendingDeepLinks(target)).toEqual([])
  })
})

describe("layout workspace helpers", () => {
  test("normalizes trailing slash in workspace key", () => {
    expect(workspaceKey("/tmp/demo///")).toBe("/tmp/demo")
    expect(workspaceKey("C:\\tmp\\demo\\\\")).toBe("C:/tmp/demo")
  })

  test("preserves posix and drive roots in workspace key", () => {
    expect(workspaceKey("/")).toBe("/")
    expect(workspaceKey("///")).toBe("/")
    expect(workspaceKey("C:\\")).toBe("C:/")
    expect(workspaceKey("C://")).toBe("C:/")
    expect(workspaceKey("C:///")).toBe("C:/")
  })

  test("keeps local first while preserving known order", () => {
    const result = effectiveWorkspaceOrder("/root", ["/root", "/b", "/c"], ["/root", "/c", "/a", "/b"])
    expect(result).toEqual(["/root", "/c", "/b"])
  })

  test("finds the latest root session across workspaces", () => {
    const result = latestRootSession(
      [
        {
          path: { directory: "/root" },
          session: [session({ id: "root", directory: "/root", time: { created: 1, updated: 1, archived: undefined } })],
        },
        {
          path: { directory: "/workspace" },
          session: [
            session({
              id: "workspace",
              directory: "/workspace",
              time: { created: 2, updated: 2, archived: undefined },
            }),
          ],
        },
      ],
      120_000,
    )

    expect(result?.id).toBe("workspace")
  })

  test("detects project permissions with a filter", () => {
    const result = hasProjectPermissions(
      {
        root: [{ id: "perm-root" }, { id: "perm-hidden" }],
        child: [{ id: "perm-child" }],
      },
      (item) => item.id === "perm-child",
    )

    expect(result).toBe(true)
  })

  test("ignores project permissions filtered out", () => {
    const result = hasProjectPermissions(
      {
        root: [{ id: "perm-root" }],
      },
      () => false,
    )

    expect(result).toBe(false)
  })

  test("ignores archived and child sessions when finding latest root session", () => {
    const result = latestRootSession(
      [
        {
          path: { directory: "/workspace" },
          session: [
            session({
              id: "archived",
              directory: "/workspace",
              time: { created: 10, updated: 10, archived: 10 },
            }),
            session({
              id: "child",
              directory: "/workspace",
              parentID: "parent",
              time: { created: 20, updated: 20, archived: undefined },
            }),
            session({
              id: "root",
              directory: "/workspace",
              time: { created: 30, updated: 30, archived: undefined },
            }),
          ],
        },
      ],
      120_000,
    )

    expect(result?.id).toBe("root")
  })

  test("finds the direct child on the active session path", () => {
    const list = [
      session({ id: "root", directory: "/workspace" }),
      session({ id: "child", directory: "/workspace", parentID: "root" }),
      session({ id: "leaf", directory: "/workspace", parentID: "child" }),
    ]

    expect(childSessionOnPath(list, "root", "leaf")?.id).toBe("child")
    expect(childSessionOnPath(list, "child", "leaf")?.id).toBe("leaf")
    expect(childSessionOnPath(list, "root", "root")).toBeUndefined()
    expect(childSessionOnPath(list, "root", "other")).toBeUndefined()
  })

  test("formats fallback project display name", () => {
    expect(displayName({ worktree: "/tmp/app" })).toBe("app")
    expect(displayName({ worktree: "/tmp/app", name: "My App" })).toBe("My App")
  })

  test("extracts api error message and fallback", () => {
    expect(errorMessage({ data: { message: "boom" } }, "fallback")).toBe("boom")
    expect(errorMessage(new Error("broken"), "fallback")).toBe("broken")
    expect(errorMessage("unknown", "fallback")).toBe("fallback")
  })
})

describe("scoped", () => {
  const list = [{ worktree: "/a" }, { worktree: "/b/" }, { worktree: "/c" }, { worktree: "/d" }]

  test("lists the current project first, then its associated projects in sidebar order", () => {
    expect(scoped(list, "/c", ["/d", "/b"]).map((item) => item.worktree)).toEqual(["/c", "/b/", "/d"])
  })

  test("lists only the current project when nothing is associated", () => {
    expect(scoped(list, "/a", []).map((item) => item.worktree)).toEqual(["/a"])
  })

  test("ignores associated projects that are no longer open", () => {
    expect(scoped(list, "/a", ["/gone"]).map((item) => item.worktree)).toEqual(["/a"])
  })

  test("lists every open project when there is no current project", () => {
    expect(scoped(list, undefined, ["/b"])).toBe(list)
    expect(scoped(list, "/not-open", [])).toBe(list)
  })
})

describe("displayName", () => {
  test("names a root folder by its path instead of leaving it blank", () => {
    expect(displayName({ worktree: "/" })).toBe("/")
    expect(displayName({ worktree: "/Users/me/KloudCode" })).toBe("KloudCode")
    expect(displayName({ name: "Pilot", worktree: "/x" })).toBe("Pilot")
  })
})

describe("startupProject", () => {
  test("reopens the last active project first, then Pilot's recent one, then the first known", () => {
    expect(startupProject("/work/kloudcode", ["/work/kloudmeet"], ["/work/a"])).toBe("/work/kloudcode")
    expect(startupProject(undefined, [undefined, "/work/kloudmeet"], ["/work/a"])).toBe("/work/kloudmeet")
    expect(startupProject(undefined, [], ["/work/a"])).toBe("/work/a")
    expect(startupProject(undefined, [], [])).toBeUndefined()
  })
})

describe("currentProjectRoot", () => {
  const open = ["/work/kloudcode", "/work/kloudmeet"]
  test("keeps the chosen project while a related project's session is on screen", () => {
    expect(currentProjectRoot("/work/kloudcode", "/work/kloudmeet", open)).toBe("/work/kloudcode")
    expect(currentProjectRoot("/work/kloudcode/", "/work/kloudcode", open)).toBe("/work/kloudcode")
  })
  test("falls back to the project on screen when nothing is chosen or the chosen one was closed", () => {
    expect(currentProjectRoot(undefined, "/work/kloudmeet", open)).toBe("/work/kloudmeet")
    expect(currentProjectRoot("/work/closed", "/work/kloudmeet", open)).toBe("/work/kloudmeet")
    expect(currentProjectRoot("/work/closed", undefined, open)).toBeUndefined()
  })
})

describe("active sessions", () => {
  const root = session({ id: "ses_a", directory: "/p", time: { created: 1, updated: 5, archived: undefined } })
  const child = session({ id: "ses_c", directory: "/p", parentID: "ses_a" })
  const idle = session({ id: "ses_i", directory: "/p", time: { created: 1, updated: 9, archived: undefined } })
  const asking = session({ id: "ses_q", directory: "/p", time: { created: 1, updated: 2, archived: undefined } })
  const archived = session({ id: "ses_x", directory: "/p", time: { created: 1, updated: 1, archived: 3 } })
  const perm = (id: string, sessionID: string) => ({ id, sessionID }) as PermissionRequest
  const question = (id: string, sessionID: string) => ({ id, sessionID, questions: [] }) as unknown as QuestionRequest
  const source = (input: Partial<ActiveSource> = {}): ActiveSource => ({
    directory: "/p",
    session: [root, child, idle, asking, archived],
    session_status: { ses_x: { type: "busy" } },
    message: { ses_i: [{ role: "assistant", time: { created: 1, completed: 2 } }] },
    ...input,
  })

  test("lists busy and waiting root sessions, waiting first, and skips idle and archived ones", () => {
    const list = activeSessions([
      {
        project: "P",
        sources: [
          source({
            session_status: { ses_c: { type: "busy" }, ses_x: { type: "busy" } },
            question: { ses_q: [question("que_1", "ses_q")] },
          }),
        ],
      },
    ])
    expect(list.map((item) => [item.session.id, item.state, item.project])).toEqual([
      ["ses_q", "waiting", "P"],
      ["ses_a", "working", "P"],
    ])
  })

  test("an unfinished reply with nothing running is stuck; an auto-answered permission does not count as waiting", () => {
    const list = activeSessions(
      [
        {
          project: "P",
          sources: [
            source({
              message: { ses_i: [{ role: "assistant", time: { created: 1 } }] },
              permission: { ses_q: [perm("per_auto", "ses_q")] },
            }),
          ],
        },
      ],
      (item) => item.id !== "per_auto",
    )
    expect(list.map((item) => [item.session.id, item.state])).toEqual([["ses_i", "stuck"]])
  })

  test("an idle session whose current task has steps left waits on the person; a finished or dismissed one does not", () => {
    const user = (id: string, sessionID: string) => ({ id, sessionID, role: "user", time: { created: 1 } })
    const reply = (id: string, sessionID: string, parentID: string) => ({
      id,
      sessionID,
      role: "assistant",
      parentID,
      time: { created: 2, completed: 3 },
    })
    const steps = (messageID: string, ...statuses: string[]) => [
      {
        id: `p-${messageID}`,
        messageID,
        type: "tool",
        tool: "todowrite",
        state: {
          status: "completed",
          input: { todos: statuses.map((status, i) => ({ content: `Step ${i}`, status })) },
          time: { start: 1, end: 2 },
        },
      },
    ]
    const groups = (dismissed?: (sessionID: string, taskID: string) => boolean) =>
      activeSessions(
        [
          {
            project: "P",
            sources: [
              source({
                message: {
                  ses_i: [user("u1", "ses_i"), reply("a1", "ses_i", "u1")],
                  ses_q: [user("u2", "ses_q"), reply("a2", "ses_q", "u2")],
                },
                part: { a1: steps("a1", "completed", "in_progress"), a2: steps("a2", "completed", "cancelled") },
              } as unknown as Partial<ActiveSource>),
            ],
          },
        ],
        undefined,
        undefined,
        dismissed,
      )
    expect(groups().map((item) => [item.session.id, item.state])).toEqual([["ses_i", "waiting"]])
    expect(groups((sessionID, taskID) => sessionID === "ses_i" && taskID === "u1")).toEqual([])
  })

  describe("sessionAttention", () => {
    const open = { id: "msg_a", role: "assistant", time: { created: 1 } }
    const asked = {
      msg_a: [{ id: "prt_q", messageID: "msg_a", type: "tool", tool: "question", state: { status: "running" } }],
    } as unknown as ActiveSource["part"]

    test("a running question waits on the person for an answer and is not working", () => {
      const running = source({ session_status: { ses_a: { type: "busy" } }, message: { ses_a: [open] }, part: asked })
      expect(sessionAttention(running, "ses_a")).toEqual({ kind: "waiting", cause: "question" })
      const requested = source({
        session_status: { ses_a: { type: "busy" } },
        message: { ses_a: [open] },
        question: { ses_c: [question("que_1", "ses_c")] },
      })
      expect(sessionAttention(requested, "ses_a")).toEqual({ kind: "waiting", cause: "question" })
    })

    test("a busy session or subagent is working", () => {
      expect(sessionAttention(source({ session_status: { ses_a: { type: "busy" } } }), "ses_a")).toEqual({
        kind: "working",
      })
      expect(sessionAttention(source({ session_status: { ses_c: { type: "retry" } } }), "ses_a")?.kind).toBe("working")
    })

    test("an unfinished reply on an idle session with nothing asked is stuck", () => {
      const idleOpen = source({ session_status: { ses_a: { type: "idle" } }, message: { ses_a: [open] } })
      expect(sessionAttention(idleOpen, "ses_a")).toEqual({ kind: "stuck", cause: "unfinished" })
      // A question tool left running after the engine went idle is stuck too: nobody can answer it.
      expect(sessionAttention(source({ message: { ses_a: [open] }, part: asked }), "ses_a")).toEqual({
        kind: "stuck",
        cause: "unfinished",
      })
    })

    test("a permission request waits on the person unless it is answered automatically", () => {
      const asking = source({
        session_status: { ses_c: { type: "busy" } },
        permission: { ses_c: [perm("per_1", "ses_c")] },
      })
      expect(sessionAttention(asking, "ses_a")).toEqual({ kind: "waiting", cause: "permission" })
      expect(sessionAttention(asking, "ses_a", () => false)).toEqual({ kind: "working" })
    })

    test("steps left undone on an idle session wait on the person", () => {
      const done = source({
        message: {
          ses_a: [
            { id: "u1", role: "user", time: { created: 1 } },
            { id: "a1", role: "assistant", parentID: "u1", time: { created: 2, completed: 3 } },
          ],
        },
        part: {
          a1: [
            {
              id: "p1",
              messageID: "a1",
              type: "tool",
              tool: "todowrite",
              state: {
                status: "completed",
                input: { todos: [{ content: "Step", status: "pending" }] },
                time: { start: 1, end: 2 },
              },
            },
          ],
        },
      } as unknown as Partial<ActiveSource>)
      expect(sessionAttention(done, "ses_a")).toEqual({ kind: "waiting", cause: "steps" })
      expect(sessionAttention(done, "ses_a", undefined, () => true)).toBeUndefined()
    })
  })

  test("stopping rejects every pending request in the tree before aborting busy subagents and the session", () => {
    const steps = stopSteps(
      source({
        session_status: { ses_c: { type: "busy" } },
        permission: { ses_c: [perm("per_1", "ses_c")] },
        question: { ses_a: [question("que_1", "ses_a")] },
      }),
      "ses_a",
    )
    expect(steps).toEqual([
      { type: "question", requestID: "que_1" },
      { type: "permission", requestID: "per_1" },
      { type: "abort", sessionID: "ses_c" },
      { type: "abort", sessionID: "ses_a" },
    ])
  })

  test("runs the steps in order, tolerates gone requests, and fails when an abort fails", async () => {
    const calls: string[] = []
    const api = {
      rejectPermission: async (id: string) => {
        calls.push(`permission:${id}`)
        throw new Error("gone")
      },
      rejectQuestion: async (id: string) => void calls.push(`question:${id}`),
      abort: async (id: string) => void calls.push(`abort:${id}`),
    }
    await runStopSteps(
      [
        { type: "permission", requestID: "per_1" },
        { type: "question", requestID: "que_1" },
        { type: "abort", sessionID: "ses_a" },
      ],
      api,
    )
    expect(calls).toEqual(["permission:per_1", "question:que_1", "abort:ses_a"])
    const failing = { ...api, abort: async () => Promise.reject(new Error("offline")) }
    await expect(runStopSteps([{ type: "abort", sessionID: "ses_a" }], failing)).rejects.toThrow("offline")
  })
})

describe("activeSessions on screen", () => {
  test("leaves out the session on screen, which shows its own state", () => {
    const groups = [
      {
        project: "P",
        sources: [
          {
            directory: "/w",
            session: [
              { id: "ses_a", directory: "/w", time: { created: 1, updated: 1 } },
              { id: "ses_b", directory: "/w", time: { created: 2, updated: 2 } },
            ],
            session_status: { ses_a: { type: "busy" }, ses_b: { type: "busy" } },
          },
        ],
      },
    ] as unknown as Parameters<typeof activeSessions>[0]
    expect(activeSessions(groups, () => true, "ses_a").map((item) => item.session.id)).toEqual(["ses_b"])
    expect(activeSessions(groups).map((item) => item.session.id)).toEqual(["ses_b", "ses_a"])
  })
})

describe("nestOneTime", () => {
  const row = (id: string, origin?: string) => ({ id, oneTime: origin ? { originSessionID: origin } : undefined })

  test("puts one-time sessions right after the session they came from", () => {
    const list = [row("a"), row("t1", "b"), row("b"), row("t2", "a")]
    expect(nestOneTime(list).map((item) => item.id)).toEqual(["a", "t2", "b", "t1"])
  })

  test("keeps a one-time session in place when its origin isn't listed", () => {
    const list = [row("t1", "gone"), row("a")]
    expect(nestOneTime(list).map((item) => item.id)).toEqual(["t1", "a"])
  })
})

describe("oneTimeRows", () => {
  const row = (id: string, origin?: string, status = "open") => ({
    id,
    oneTime: origin ? { originSessionID: origin, status } : undefined,
  })
  const ids = (rows: ReturnType<typeof oneTimeRows<ReturnType<typeof row>>>) =>
    rows.map((r) => ("session" in r ? r.session.id : `archived:${r.archived}:${r.count}`))

  test("hides closed one-time sessions behind an Archived row under their parent", () => {
    const list = nestOneTime([row("a"), row("t1", "a"), row("t2", "a", "closed"), row("t3", "a", "closed"), row("b")])
    expect(ids(oneTimeRows(list, new Set()))).toEqual(["a", "t1", "archived:a:2", "b"])
  })

  test("shows them once the Archived row is open", () => {
    const list = nestOneTime([row("a"), row("t2", "a", "closed")])
    expect(ids(oneTimeRows(list, new Set(["a"])))).toEqual(["a", "archived:a:1", "t2"])
  })

  test("keeps a one-time session whose parent isn't listed", () => {
    expect(ids(oneTimeRows([row("t1", "gone", "closed"), row("b")], new Set()))).toEqual(["t1", "b"])
  })
})
