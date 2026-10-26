import { describe, expect, test } from "bun:test"
import { dict as en } from "@/i18n/en"
import { dict as zh } from "@/i18n/zh"
import { dict as zht } from "@/i18n/zht"
import { ACTIONS } from "./design-actions"

describe("design actions", () => {
  test("cover the requests the Design tab offers", () => {
    expect(ACTIONS.map((action) => action.id)).toEqual(["improve", "fill", "review", "diagram", "table", "code"])
  })

  test("every label is translated", () => {
    for (const action of ACTIONS) {
      for (const locale of [en, zh, zht]) expect(locale[action.label]).toBeTruthy()
    }
  })

  test("every prompt names the open doc", () => {
    for (const action of ACTIONS) {
      const text = action.prompt("design/api plan.md")
      expect(text).toContain("`design/api plan.md`")
      expect(text.length).toBeGreaterThan(80)
    }
  })
})
