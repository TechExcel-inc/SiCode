import { describe, expect, test } from "bun:test"
import { errorText, findOpenOnce } from "./one-time"

describe("one-time helpers", () => {
  test("findOpenOnce finds the parent's open one-time session on that model", () => {
    const model = { providerID: "ead", modelID: "glm-4.7" }
    const other = { providerID: "ead", modelID: "claude-sonnet-5" }
    const sessions = [
      { id: "a", oneTime: { originSessionID: "p", status: "closed", model } },
      { id: "b", oneTime: { originSessionID: "q", status: "open", model } },
      { id: "c", oneTime: { originSessionID: "p", status: "open", model: other } },
      { id: "d", oneTime: { originSessionID: "p", status: "open", model } },
      { id: "e" },
    ]
    expect(findOpenOnce(sessions, "p", model)?.id).toBe("d")
    expect(findOpenOnce(sessions, "p", { providerID: "ead", modelID: "none" })).toBeUndefined()
  })

  test("errorText reads server errors", () => {
    expect(errorText({ name: "SessionOneTimeOnlyError", data: { message: "Use a one-time session" } })).toBe(
      "Use a one-time session",
    )
    expect(errorText({ name: "ProviderModelNotFoundError", data: {} })).toBe("ProviderModelNotFoundError")
    expect(errorText(new Error("boom"))).toBe("boom")
  })
})
