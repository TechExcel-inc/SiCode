import { describe, expect, test } from "bun:test"
import { brief, guess } from "./estimate"
import type { Story } from "./stories"

const story = (id: number, name: string): Story => ({
  id,
  tag: "",
  project: 1,
  sub: 0,
  name,
  owner: 1,
  person: "",
  module: 0,
  area: "",
  points: 0,
  type: 0,
  target: 2,
  spent: 1,
  remain: 1,
  finish: 50,
  end: "",
  status: "",
  tasks: [],
})

describe("guess", () => {
  const list = [story(7, "Front end"), story(8, "API")]

  test("reads points and story hours to a tenth, dropping unknown stories", () => {
    const reply =
      'Here: ```json\n{"points": 6.04, "why": "Two small changes", "stories": [{"id": 7, "hours": 3.96, "why": "UI"}, {"id": 99, "hours": 1}, {"id": 8, "hours": "2"}]}\n```'
    expect(guess(reply, list)).toEqual({
      points: 6,
      why: "Two small changes",
      stories: [
        { id: 7, hours: 4, why: "UI" },
        { id: 8, hours: 2, why: "" },
      ],
    })
  })

  test("is undefined without usable points", () => {
    expect(guess("no idea", list)).toBeUndefined()
    expect(guess('{"points": "lots"}', list)).toBeUndefined()
    expect(guess('{"points": 3', list)).toBeUndefined()
  })
})

describe("brief", () => {
  test("carries the spec and its stories' ids", () => {
    const text = brief({ id: 30060, title: "Expand limit", text: "Raise to 4000", points: 3 }, [story(7, "Front end")])
    expect(text).toContain('"id":30060')
    expect(text).toContain('"id":7')
    expect(text).toContain("Raise to 4000")
  })
})
