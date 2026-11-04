import { describe, expect, test } from "bun:test"
import type { PermissionRequest, QuestionRequest, Session } from "@opencode-ai/sdk/v2/client"
import { continueRequest, todoState } from "./session-composer-state"
import { sessionPermissionRequest, sessionQuestionRequest, typedAnswers } from "./session-request-tree"

const session = (input: { id: string; parentID?: string }) =>
  ({
    id: input.id,
    parentID: input.parentID,
  }) as Session

const permission = (id: string, sessionID: string) =>
  ({
    id,
    sessionID,
  }) as PermissionRequest

const question = (id: string, sessionID: string) =>
  ({
    id,
    sessionID,
    questions: [],
  }) as QuestionRequest

describe("sessionPermissionRequest", () => {
  test("prefers the current session permission", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const permissions = {
      root: [permission("perm-root", "root")],
      child: [permission("perm-child", "child")],
    }

    expect(sessionPermissionRequest(sessions, permissions, "root")?.id).toBe("perm-root")
  })

  test("returns a nested child permission", () => {
    const sessions = [
      session({ id: "root" }),
      session({ id: "child", parentID: "root" }),
      session({ id: "grand", parentID: "child" }),
      session({ id: "other" }),
    ]
    const permissions = {
      grand: [permission("perm-grand", "grand")],
      other: [permission("perm-other", "other")],
    }

    expect(sessionPermissionRequest(sessions, permissions, "root")?.id).toBe("perm-grand")
  })

  test("returns undefined without a matching tree permission", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const permissions = {
      other: [permission("perm-other", "other")],
    }

    expect(sessionPermissionRequest(sessions, permissions, "root")).toBeUndefined()
  })

  test("skips filtered permissions in the current tree", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const permissions = {
      root: [permission("perm-root", "root")],
      child: [permission("perm-child", "child")],
    }

    expect(sessionPermissionRequest(sessions, permissions, "root", (item) => item.id !== "perm-root"))?.toMatchObject({
      id: "perm-child",
    })
  })

  test("returns undefined when all tree permissions are filtered out", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const permissions = {
      root: [permission("perm-root", "root")],
      child: [permission("perm-child", "child")],
    }

    expect(sessionPermissionRequest(sessions, permissions, "root", () => false)).toBeUndefined()
  })
})

describe("sessionQuestionRequest", () => {
  test("prefers the current session question", () => {
    const sessions = [session({ id: "root" }), session({ id: "child", parentID: "root" })]
    const questions = {
      root: [question("q-root", "root")],
      child: [question("q-child", "child")],
    }

    expect(sessionQuestionRequest(sessions, questions, "root")?.id).toBe("q-root")
  })

  test("returns a nested child question", () => {
    const sessions = [
      session({ id: "root" }),
      session({ id: "child", parentID: "root" }),
      session({ id: "grand", parentID: "child" }),
    ]
    const questions = {
      grand: [question("q-grand", "grand")],
    }

    expect(sessionQuestionRequest(sessions, questions, "root")?.id).toBe("q-grand")
  })
})

describe("todoState", () => {
  test("hides when there are no todos", () => {
    expect(todoState({ count: 0, done: false, live: true })).toBe("hide")
  })

  test("opens while the session is still working", () => {
    expect(todoState({ count: 2, done: false, live: true })).toBe("open")
  })

  test("closes completed todos after a running turn", () => {
    expect(todoState({ count: 2, done: true, live: true })).toBe("close")
  })

  test("keeps unfinished steps open after the turn ends, so the session waits on the person", () => {
    expect(todoState({ count: 2, done: false, live: false })).toBe("open")
  })

  test("clears completed todos when the session is no longer live", () => {
    expect(todoState({ count: 2, done: true, live: false })).toBe("clear")
  })
})

describe("continueRequest", () => {
  const user = (id: string, modelID: string, variant?: string) =>
    ({ id, role: "user", agent: "build", model: { providerID: "ead", modelID, variant } }) as never
  const assistant = (id: string) => ({ id, role: "assistant" }) as never

  test("asks the session to continue its steps with the agent and model of the person's last message", () => {
    expect(continueRequest("ses_1", [user("m1", "EAD 2.1"), assistant("m2"), user("m3", "EAD 3.2", "high"), assistant("m4")])).toEqual({
      sessionID: "ses_1",
      agent: "build",
      model: { providerID: "ead", modelID: "EAD 3.2" },
      variant: "high",
      system: undefined,
      parts: [{ type: "text", text: "Continue with the remaining steps." }],
    })
  })

  test("carries the context of the person's last message, such as the shared server", () => {
    const withSystem = { id: "m1", role: "user", agent: "build", model: { providerID: "ead", modelID: "EAD 3.2" }, system: "<shared-ai-coding-server>x</shared-ai-coding-server>" } as never
    expect(continueRequest("ses_1", [withSystem]).system).toBe("<shared-ai-coding-server>x</shared-ai-coding-server>")
  })

  test("leaves agent and model to the session's defaults when it has no message from the person", () => {
    expect(continueRequest("ses_1", [])).toEqual({
      sessionID: "ses_1",
      agent: undefined,
      model: undefined,
      variant: undefined,
      system: undefined,
      parts: [{ type: "text", text: "Continue with the remaining steps." }],
    })
  })
})

describe("typedAnswers", () => {
  test("a typed message answers every question in the request in the person's words", () => {
    const request = {
      id: "q1",
      sessionID: "s",
      questions: [
        { question: "Which fix?", header: "Fix", options: [] },
        { question: "Which file?", header: "File", options: [] },
      ],
    } as unknown as QuestionRequest
    expect(typedAnswers(request, "  Only the auth skip, please  ")).toEqual([
      ["Only the auth skip, please"],
      ["Only the auth skip, please"],
    ])
    expect(typedAnswers(request, "   ")).toEqual([[], []])
  })
})
