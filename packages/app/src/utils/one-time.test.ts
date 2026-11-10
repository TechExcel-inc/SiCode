import { describe, expect, test } from "bun:test"
import { errorText } from "./one-time"

describe("one-time helpers", () => {
  test("errorText reads server errors", () => {
    expect(errorText({ name: "SessionOneTimeOnlyError", data: { message: "Use a one-time session" } })).toBe(
      "Use a one-time session",
    )
    expect(errorText({ name: "ProviderModelNotFoundError", data: {} })).toBe("ProviderModelNotFoundError")
    expect(errorText(new Error("boom"))).toBe("boom")
  })
})
