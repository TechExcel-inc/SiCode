import { describe, expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk/v2"
import {
  checklistFolds,
  checklistProgress,
  currentAction,
  elapsedParts,
  foldActions,
  isFoldedAction,
  latestChecklist,
  runningHelpers,
  doneActions,
  taskLine,
  taskName,
} from "./session-turn-activity"

let seq = 0
function tool(name: string, status: string, input: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  seq++
  return {
    id: `p${seq}`,
    sessionID: "s",
    messageID: "m",
    type: "tool",
    callID: `c${seq}`,
    tool: name,
    state: { status, input, ...extra },
  } as unknown as Part
}

function text(value: string) {
  seq++
  return { id: `p${seq}`, sessionID: "s", messageID: "m", type: "text", text: value } as unknown as Part
}

const todos = (...items: [string, string][]) => items.map(([content, status]) => ({ content, status }))

describe("latestChecklist", () => {
  test("takes the last todowrite call of the turn, preferring its result over its input", () => {
    const parts = [
      tool("todowrite", "completed", { todos: todos(["a", "pending"], ["b", "pending"]) }),
      tool("bash", "completed"),
      tool(
        "todowrite",
        "completed",
        { todos: todos(["a", "pending"]) },
        { metadata: { todos: todos(["a", "completed"], ["b", "in_progress"]) } },
      ),
    ]
    expect(latestChecklist(parts)).toEqual(todos(["a", "completed"], ["b", "in_progress"]))
  })

  test("uses a running call's input so the box updates while the call is in flight", () => {
    const parts = [
      tool("todowrite", "completed", { todos: todos(["a", "pending"]) }),
      tool("todowrite", "running", { todos: todos(["a", "completed"]) }),
    ]
    expect(latestChecklist(parts)).toEqual(todos(["a", "completed"]))
  })

  test("skips a call that has no steps yet and is undefined without a checklist", () => {
    const parts = [tool("todowrite", "completed", { todos: todos(["a", "pending"]) }), tool("todowrite", "pending")]
    expect(latestChecklist(parts)).toEqual(todos(["a", "pending"]))
    expect(latestChecklist([tool("bash", "completed"), text("hi")])).toBeUndefined()
  })

  test("counts completed steps", () => {
    expect(checklistProgress(todos(["a", "completed"], ["b", "cancelled"], ["c", "completed"]))).toEqual({
      done: 2,
      total: 3,
    })
  })
})

describe("foldActions", () => {
  test("folds tool calls into one entry at the first one, keeping text, edits and answered questions in order", () => {
    const parts = [
      text("intro"),
      tool("read", "completed"),
      tool("bash", "completed"),
      tool("edit", "completed"),
      text("middle"),
      tool("grep", "completed"),
      tool("question", "completed"),
      tool("todowrite", "completed"),
      text("end"),
    ]
    const result = foldActions(parts, isFoldedAction)
    expect(
      result.map((entry) =>
        entry.type === "actions"
          ? `actions:${entry.items.map((item) => (item as { tool: string }).tool).join(",")}`
          : entry.item.type === "tool"
            ? (entry.item as { tool: string }).tool
            : (entry.item as { text: string }).text,
      ),
    ).toEqual(["intro", "actions:read,bash,grep", "edit", "middle", "question", "todowrite", "end"])
  })

  test("leaves a turn without tool calls untouched", () => {
    const parts = [text("a"), text("b")]
    expect(foldActions(parts, isFoldedAction)).toEqual(parts.map((item) => ({ type: "item" as const, item })))
  })

  test("does not fold the checklist, edits or questions", () => {
    expect(["todowrite", "edit", "write", "apply_patch", "question"].some((name) => isFoldedAction(tool(name, "completed")))).toBe(false)
    expect(isFoldedAction(tool("task", "running"))).toBe(true)
    expect(isFoldedAction(tool("mcp_custom", "error"))).toBe(true)
    expect(isFoldedAction(text("x"))).toBe(false)
  })
})

describe("currentAction", () => {
  test("describes the latest running tool call", () => {
    const parts = [
      tool("bash", "running", { description: "bun test" }),
      tool("read", "running", { filePath: "/repo/src/agent-edits.tsx" }),
    ]
    expect(currentAction(parts)).toEqual({ key: "ui.sessionTurn.live.read", params: { value: "agent-edits.tsx" } })
  })

  test("names commands and searches, with a bare form when input is missing", () => {
    expect(currentAction([tool("bash", "running", { command: "bun test" })])).toEqual({
      key: "ui.sessionTurn.live.run",
      params: { value: "bun test" },
    })
    expect(currentAction([tool("grep", "pending", { pattern: "todowrite" })])).toEqual({
      key: "ui.sessionTurn.live.search",
      params: { value: "todowrite" },
    })
    expect(currentAction([tool("read", "running")])).toEqual({ key: "ui.sessionTurn.live.read.bare", params: {} })
  })

  test("prefers other work over a running helper, falls back to the helper, else is thinking", () => {
    const helper = tool("task", "running", { description: "Review the diff" })
    expect(currentAction([tool("glob", "running", { pattern: "*.ts" }), helper])?.key).toBe("ui.sessionTurn.live.search")
    expect(currentAction([helper])).toEqual({ key: "ui.sessionTurn.live.delegate", params: { value: "Review the diff" } })
    expect(currentAction([tool("bash", "completed"), text("done")])).toBeUndefined()
  })

  test("labels unknown tools by their running title or name", () => {
    expect(currentAction([tool("mcp_lookup", "running", {}, { title: "Looking up issue" })])).toEqual({
      key: "ui.sessionTurn.live.tool",
      params: { value: "Looking up issue" },
    })
  })
})

describe("live status", () => {
  test("counts only running helper agents", () => {
    expect(runningHelpers([tool("task", "running"), tool("task", "pending"), tool("task", "completed"), tool("bash", "running")])).toBe(2)
  })

  test("splits elapsed time into seconds, minutes or hours", () => {
    expect(elapsedParts(45_400)).toEqual({ key: "ui.sessionTurn.live.elapsed.seconds", params: { seconds: 45 } })
    expect(elapsedParts(130_000)).toEqual({ key: "ui.sessionTurn.live.elapsed.minutes", params: { minutes: 2, seconds: 10 } })
    expect(elapsedParts(3_780_000)).toEqual({ key: "ui.sessionTurn.live.elapsed.hours", params: { hours: 1, minutes: 3 } })
    expect(elapsedParts(-5)).toEqual({ key: "ui.sessionTurn.live.elapsed.seconds", params: { seconds: 0 } })
  })
})

describe("checklistFolds", () => {
  const done = { content: "a", status: "completed" }
  const dropped = { content: "b", status: "cancelled" }
  test("folds a finished turn whose steps are all completed or cancelled", () => {
    expect(checklistFolds([done, dropped], false)).toBe(true)
  })
  test("stays open while working, with a step left, or with no steps", () => {
    expect(checklistFolds([done], true)).toBe(false)
    expect(checklistFolds([done, { content: "c", status: "pending" }], false)).toBe(false)
    expect(checklistFolds([done, { content: "c", status: "in_progress" }], false)).toBe(false)
    expect(checklistFolds([], false)).toBe(false)
  })
})

describe("doneActions", () => {
  test("counts finished tool calls only", () => {
    expect(doneActions([tool("read", "completed", {}), tool("grep", "completed", {}), tool("bash", "running", {})])).toBe(2)
  })
})

describe("task name", () => {
  const text = (value: string, synthetic?: boolean) =>
    ({ id: "t", sessionID: "s", messageID: "m", type: "text", text: value, synthetic }) as Part

  test("uses the name the title model gave the request", () => {
    expect(taskName({ summary: { title: "Restore Play tag", diffs: [] } }, [text("anything")])).toBe("Restore Play tag")
  })

  test("falls back to the request's first line, skipping text the app added", () => {
    expect(taskName({}, [text("added by the app", true), text("\nFix the pager\nand the tags")])).toBe("Fix the pager")
    expect(taskName(undefined, [])).toBeUndefined()
  })

  test("cuts a long first line", () => {
    expect(taskLine("x".repeat(80))).toBe("x".repeat(57) + "...")
    expect(taskLine("  ")).toBeUndefined()
  })
})
