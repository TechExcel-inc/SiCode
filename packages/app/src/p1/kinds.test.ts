import { describe, expect, test } from "bun:test"
import { guess, kind, read } from "./kinds"
import { readStories } from "./stories"

describe("story types", () => {
  test("reads module types: development from P1's flag, the rest from setting 80300", () => {
    const mods = {
      Data: [
        { ModuleID: 1, IfNonDevModule: false },
        { ModuleID: 2, IfNonDevModule: true },
        { ModuleID: 3, IfNonDevModule: true },
        { ModuleID: 4 },
      ],
    }
    const kept = { SettingNote: JSON.stringify({ implementationModuleTypes: { 2: 2, 3: 9, 4: 3 } }) }
    expect(read(mods, kept)).toEqual({ 1: 1, 2: 2, 4: 3 })
    expect(read(mods, { SettingNote: "not ours" })).toEqual({ 1: 1 })
  })

  test("suggests the type most modules have, else the first module's", () => {
    const map = { 1: 1, 2: 2, 3: 2, 4: 3 }
    expect(guess([1, 2, 3], map)).toBe(2)
    expect(guess([4, 1], map)).toBe(3)
    expect(guess([9], map)).toBe(0)
  })

  test("a story keeps its type, or none when it isn't one of the five", () => {
    expect(kind(4)).toBe("management")
    expect(kind(0)).toBeUndefined()
    const list = readStories([
      { StoryItemId: 1, StoryType: 3 },
      { StoryItemId: 2, StoryType: 8 },
      { StoryItemId: 3 },
    ])
    expect(list.map((story) => story.type)).toEqual([3, 0, 0])
  })
})
