import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { currentTask, sameChecklist, sessionBackground, sessionTasks } from "./agent-tasks"
import { costReport, costTotals, type CostEntry } from "./agent-cost"

const user = (id: string, title?: string, diffs: { file: string; additions: number; deletions: number }[] = []) =>
  ({ id, sessionID: "s", role: "user", time: { created: 1 }, summary: { title, diffs }, agent: "build", model: {} }) as unknown as Message

const reply = (id: string, parentID: string, cost = 0) =>
  ({ id, sessionID: "s", role: "assistant", parentID, cost, time: { created: 2 } }) as unknown as Message

const text = (messageID: string, value: string, synthetic = false) =>
  ({ id: `t-${messageID}`, sessionID: "s", messageID, type: "text", text: value, synthetic }) as unknown as Part

const tool = (messageID: string, name: string, input: Record<string, unknown>, status = "completed", extra: Record<string, unknown> = {}) =>
  ({
    id: `p-${messageID}-${name}-${Math.random()}`,
    sessionID: "s",
    messageID,
    type: "tool",
    tool: name,
    callID: "c",
    state: { status, input, output: "", title: "", metadata: {}, time: { start: 100, end: 200 }, ...extra },
  }) as unknown as Part

const todos = (...items: [string, string][]) => ({ todos: items.map(([content, status]) => ({ content, status, priority: "medium" })) })

describe("sessionTasks", () => {
  test("one task per checklist, newest first, with the request as its title", () => {
    const messages = [
      user("u1", undefined),
      reply("a1", "u1", 0.5),
      user("u2"),
      reply("a2", "u2"),
      user("u3"),
      reply("a3", "u3", 0.25),
    ]
    const parts: Record<string, Part[]> = {
      u1: [text("u1", "\n  Build the usage report\nwith details")],
      a1: [
        tool("a1", "todowrite", todos(["Add table", "in_progress"], ["Add page", "pending"])),
        tool("a1", "todowrite", todos(["Add table", "completed"], ["Add page", "completed"])),
        tool("a1", "write", { filePath: "/repo/docs/usage.md" }),
        tool("a1", "edit", { filePath: "/pilot/Usage.java" }),
      ],
      u2: [text("u2", "what is 2+2?")],
      a2: [text("a2", "4")],
      u3: [text("u3", "Deploy it")],
      a3: [tool("a3", "todowrite", todos(["Back up", "completed"], ["Restart", "in_progress"]))],
    }
    const tasks = sessionTasks(messages, parts)
    expect(tasks.map((task) => task.title)).toEqual(["Deploy it", "Build the usage report"])
    const [deploy, build] = tasks
    expect([deploy!.done, deploy!.steps.length, deploy!.finished]).toEqual([1, 2, false])
    expect([build!.done, build!.finished, build!.cost]).toEqual([2, true, 0.5])
    expect(build!.documents.map((item) => item.path)).toEqual(["/repo/docs/usage.md"])
    expect(build!.elsewhere.map((item) => item.path)).toEqual(["/pilot/Usage.java"])
  })

  test("a request that updates the same checklist joins its task, and its code changes add up", () => {
    const messages = [user("u1", "Build panel", [{ file: "a.ts", additions: 10, deletions: 2 }, { file: "docs/plan.md", additions: 40, deletions: 0 }]), reply("a1", "u1", 1), user("u2", "continue", [{ file: "a.ts", additions: 3, deletions: 1 }, { file: "b.ts", additions: 5, deletions: 0 }]), reply("a2", "u2", 2)]
    const parts: Record<string, Part[]> = {
      a1: [tool("a1", "todowrite", todos(["Map code", "completed"], ["Build UI", "in_progress"], ["Test", "pending"])), tool("a1", "edit", { filePath: "/repo/a.ts" })],
      a2: [tool("a2", "todowrite", todos(["Map code", "completed"], ["Build UI", "completed"], ["Test", "completed"]))],
    }
    const tasks = sessionTasks(messages, parts)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.title).toBe("Build panel")
    expect([tasks[0]!.finished, tasks[0]!.cost]).toEqual([true, 3])
    expect(tasks[0]!.code).toEqual([
      { file: "a.ts", additions: 13, deletions: 3 },
      { file: "b.ts", additions: 5, deletions: 0 },
    ])
    expect([tasks[0]!.added, tasks[0]!.removed]).toEqual([18, 3])
    expect(tasks[0]!.elsewhere).toEqual([])
  })

  test("the current task is the latest request's checklist; a new request leaves an earlier one behind", () => {
    const parked = todos(["Design icon", "pending"], ["Fix animation", "pending"])
    const base = [user("u1"), reply("a1", "u1")]
    const parts: Record<string, Part[]> = { u1: [text("u1", "Stop for now")], a1: [tool("a1", "todowrite", parked)] }
    expect(currentTask(base, parts)?.steps.map((step) => step.content)).toEqual(["Design icon", "Fix animation"])

    // A new request that has not written a checklist yet: no current task, the parked one stays behind.
    const asked = [...base, user("u2"), reply("a2", "u2")]
    const next = { ...parts, u2: [text("u2", "Show me the design results again")], a2: [text("a2", "Sure")] }
    expect(currentTask(asked, next)).toBeUndefined()

    // Its own checklist becomes the current task.
    const own = { ...next, a2: [tool("a2", "todowrite", todos(["Render previews", "in_progress"]))] }
    expect(currentTask(asked, own)?.steps.map((step) => step.content)).toEqual(["Render previews"])
  })

  test("a continue request carries the earlier task on until it writes its own steps", () => {
    const messages = [user("u1"), reply("a1", "u1"), user("u2"), reply("a2", "u2")]
    const parts: Record<string, Part[]> = {
      a1: [tool("a1", "todowrite", todos(["Map code", "completed"], ["Build UI", "pending"]))],
      u2: [text("u2", "Continue with the remaining steps.")],
      a2: [],
    }
    expect(currentTask(messages, parts)?.steps.map((step) => step.status)).toEqual(["completed", "pending"])
    expect(currentTask(messages, { ...parts, u2: [text("u2", "continue")] })?.id).toBe("u1")
  })

  test("steps left open when the work moved to another project are cancelled, not waiting here", () => {
    const messages = [user("u1"), reply("a1", "u1"), reply("a2", "u1")]
    const list = todos(["Inspect sorting", "in_progress"], ["Create design", "pending"])
    const parts: Record<string, Part[]> = {
      u1: [text("u1", "Design the sort control")],
      a1: [tool("a1", "todowrite", list)],
      a2: [tool("a2", "project_switch", { project: "P1_VP12" }, "completed", { metadata: { project: "/p/P1_VP12", session: "ses_new" } })],
    }
    const task = currentTask(messages, parts)!
    expect(task.steps.map((step) => step.status)).toEqual(["cancelled", "cancelled"])
    expect(task.finished).toBe(true)

    // Kept here instead: the steps stay open.
    const kept = { ...parts, a2: [tool("a2", "project_switch", { project: "P1_VP12" }, "completed", { metadata: { project: "/p/P1_VP12" } })] }
    expect(currentTask(messages, kept)!.finished).toBe(false)
  })

  test("checklists match when half the shorter one's steps are shared", () => {
    const steps = (...names: string[]) => names.map((content) => ({ content, status: "pending" }))
    expect(sameChecklist(steps("A", "B", "C", "D"), steps("a", "b", "X"))).toBe(true)
    expect(sameChecklist(steps("A", "B", "C", "D"), steps("A", "X", "Y"))).toBe(false)
    expect(sameChecklist([], steps("A"))).toBe(false)
  })
})

describe("sessionBackground", () => {
  test("lists running helper agents and counts finished ones", () => {
    const parts = [
      tool("a1", "task", { description: "Map the engine" }, "running", { title: undefined, metadata: { sessionId: "ses_child" }, time: { start: 50 } }),
      tool("a1", "task", { description: "Search tests" }, "completed"),
      tool("a1", "task", { description: "Broken" }, "error", { error: "x" }),
      tool("a1", "bash", { command: "ls" }, "running"),
    ]
    const result = sessionBackground(parts)
    expect(result.finished).toBe(2)
    expect(result.running).toEqual([{ id: result.running[0]!.id, title: "Map the engine", started: 50, sessionID: "ses_child" }])
  })
})

describe("costReport", () => {
  const entry = (at: number, cost: number | null, extra: Partial<CostEntry> = {}): CostEntry => ({
    usageId: at,
    providerId: "zai",
    modelId: "glm-5",
    slotKey: "advanced",
    sessionUid: "s",
    promptTokens: 100,
    cachedTokens: 0,
    completionTokens: 10,
    costMicroUsd: cost,
    startedAt: new Date(at).toISOString(),
    endedAt: new Date(at + 1000).toISOString(),
    ...extra,
  })
  const asked = (id: string, created: number) => ({ ...user(id), time: { created } }) as unknown as Message

  test("requests group into numbered tasks by step, then Other work, then helpers", () => {
    const messages = [asked("u1", 1000), reply("a1", "u1"), asked("u2", 5000), reply("a2", "u2"), asked("u3", 9000), reply("a3", "u3")]
    const parts: Record<string, Part[]> = {
      u1: [text("u1", "Build the report")],
      a1: [
        tool("a1", "todowrite", todos(["Add table", "completed"], ["Add page", "completed"])),
        tool("a1", "task", { description: "Search the code" }, "completed", { metadata: { sessionId: "child" } }),
      ],
      u2: [text("u2", "what is 2+2?")],
      u3: [text("u3", "Deploy")],
      a3: [tool("a3", "todowrite", todos(["Back up", "in_progress"]))],
    }
    const tasks = sessionTasks(messages, parts)
    const items = costReport("s", messages, Object.values(parts).flat(), tasks, [
      entry(1100, 200_000, { messageUid: "u1", stepText: "Add table" }),
      entry(1200, 300_000, { messageUid: "u1", stepText: "Add page" }),
      entry(1300, 100_000, { messageUid: "u1", stepText: "Add table" }),
      entry(1400, 50_000, { sessionUid: "child", messageUid: "c1" }),
      entry(5100, 400_000, { messageUid: "u2" }),
      // An older request that does not name its message belongs to the request sent before it.
      entry(9100, 70_000),
      entry(9200, null, { messageUid: "u3", stepText: "Back up" }),
    ])
    expect(items.map((row) => [row.number, row.kind, row.title, Math.round(row.cost * 100) / 100])).toEqual([
      [1, "task", "Build the report", 0.6],
      [2, "task", "Deploy", 0.07],
      [3, "other", "", 0.4],
      [4, "helper", "Search the code", 0.05],
    ])
    const [build, deploy] = items
    expect(build!.steps.map((step) => [step.title, step.entries.length, Math.round(step.cost * 10) / 10])).toEqual([
      ["Add table", 2, 0.3],
      ["Add page", 1, 0.3],
    ])
    expect(deploy!.steps.map((step) => step.title)).toEqual([undefined, "Back up"])
    // Subtotals add the parts of every request.
    const sum = costTotals(build!.entries)
    expect([sum.input, sum.cached, sum.output, sum.cost]).toEqual([300, 0, 30, 600_000])
    expect(deploy!.unpriced).toBe(1)
  })
})
