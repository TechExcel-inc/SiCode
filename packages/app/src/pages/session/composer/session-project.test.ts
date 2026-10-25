import { describe, expect, test } from "bun:test"
import type { Part, QuestionRequest } from "@opencode-ai/sdk/v2/client"
import {
  carried,
  projectSwitch,
  sessionSuggestion,
  suggestedMessage,
  suggestedProject,
  suggestionAnswer,
  suggestionButtons,
} from "./session-project"

const request = (callID?: string) =>
  ({
    id: "que_1",
    sessionID: "ses_1",
    questions: [],
    tool: callID ? { messageID: "msg_1", callID } : undefined,
  }) as QuestionRequest

const tool = (name: string, input: Record<string, unknown>) =>
  ({
    id: "prt_1",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "tool",
    callID: "call_1",
    tool: name,
    state: { status: "running", input, time: { start: 0 } },
  }) as Part

describe("session project switch", () => {
  test("finds the project_switch call behind a question", () => {
    const parts = { msg_1: [tool("project_switch", { project: "/work/cowork", prompt: "Fix login" })] }
    expect(projectSwitch(request("call_1"), parts)).toEqual({ project: "/work/cowork", prompt: "Fix login" })
  })

  test("uses the folder the tool resolved when the agent gave only a name", () => {
    const resolved = {
      ...tool("project_switch", {}),
      state: {
        status: "running",
        input: { project: "cowork", prompt: "Fix login" },
        metadata: { project: "/work/cowork", name: "cowork" },
        time: { start: 0 },
      },
    } as Part
    expect(projectSwitch(request("call_1"), { msg_1: [resolved] })).toEqual({ project: "/work/cowork", prompt: "Fix login" })
  })

  test("leaves other questions to the question dock", () => {
    expect(projectSwitch(request(), {})).toBeUndefined()
    expect(projectSwitch(request("call_1"), { msg_1: [tool("question", { questions: [] })] })).toBeUndefined()
    expect(projectSwitch(request("call_1"), { msg_1: [tool("project_switch", {})] })).toBeUndefined()
  })

  test("a new session carries the person's own first message", () => {
    const parts = [
      { type: "text", text: "Fix the login in CoWork" },
      { type: "text", text: "context", synthetic: true },
      { type: "file", mime: "image/png", url: "data:x", filename: "a.png" },
      { type: "step-start" },
    ] as Part[]
    expect(carried({ fresh: true, parts, prompt: "brief", from: "KloudCode" })).toEqual([
      { type: "text", text: "Fix the login in CoWork" },
      { type: "file", mime: "image/png", url: "data:x", filename: "a.png" },
    ])
  })

  test("an existing session carries the agent's brief", () => {
    expect(carried({ fresh: false, parts: [], prompt: "Fix login", from: "KloudCode" })).toEqual([
      { type: "text", text: "Fix login\n\n(Continued from a session in KloudCode.)" },
    ])
  })
})

describe("session suggestion", () => {
  test("finds the suggest_session call behind a question", () => {
    const parts = { msg_1: [tool("suggest_session", { title: " Report page ", project: "KloudMeet" })] }
    expect(sessionSuggestion(request("call_1"), parts)).toEqual({
      title: "Report page",
      project: "KloudMeet",
      reason: undefined,
    })
    expect(sessionSuggestion(request("call_1"), { msg_1: [tool("project_switch", { project: "/x" })] })).toBeUndefined()
    expect(sessionSuggestion(request(), {})).toBeUndefined()
  })

  test("resolves the named project by display or folder name, ignoring case", () => {
    const projects = [
      { name: "Kloud Meet", worktree: "/work/meet" },
      { worktree: "/work/KloudMeet/" },
      { worktree: "/work/KloudCode" },
    ]
    expect(suggestedProject("kloud meet", projects, "/work/KloudCode")).toEqual({
      worktree: "/work/meet",
      name: "Kloud Meet",
    })
    expect(suggestedProject("KLOUDMEET", projects, "/work/KloudCode")).toEqual({
      worktree: "/work/KloudMeet/",
      name: "KloudMeet",
    })
  })

  test("an unknown project or the current one starts the session here", () => {
    const projects = [{ worktree: "/work/KloudCode" }]
    expect(suggestedProject("Nowhere", projects, "/work/KloudCode")).toBeUndefined()
    expect(suggestedProject("kloudcode", projects, "/work/KloudCode/")).toBeUndefined()
    expect(suggestedProject(undefined, projects, "/work/KloudCode")).toBeUndefined()
  })

  test("buttons name the other project only when there is one", () => {
    expect(suggestionButtons().map((item) => [item.action, item.key])).toEqual([
      ["new", "session.suggest.new"],
      ["close", "session.suggest.newClose"],
      ["continue", "session.suggest.continue"],
    ])
    expect(suggestionButtons("KloudMeet")).toEqual([
      { action: "new", key: "session.suggest.newIn", params: { project: "KloudMeet" } },
      { action: "close", key: "session.suggest.newInClose", params: { project: "KloudMeet" } },
      { action: "continue", key: "session.suggest.continue" },
    ])
  })

  test("answers carry the choice, and a move carries the new session and folder", () => {
    expect(suggestionAnswer({ moved: false })).toEqual([["continue"]])
    expect(suggestionAnswer({ moved: true, sessionID: "ses_2", directory: "/work/meet" })).toEqual([
      ["moved", "ses_2", "/work/meet"],
    ])
  })

  test("the carried message is the one that started the suggesting turn", () => {
    const messages = [
      { id: "msg_0", role: "user" },
      { id: "msg_a", role: "assistant", parentID: "msg_0" },
      { id: "msg_u", role: "user" },
      { id: "msg_1", role: "assistant", parentID: "msg_u" },
      { id: "msg_later", role: "user" },
    ]
    expect(suggestedMessage(request("call_1"), messages)?.id).toBe("msg_u")
    expect(suggestedMessage(request(), messages)?.id).toBe("msg_later")
  })
})
