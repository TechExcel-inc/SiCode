import { describe, expect, test } from "bun:test"
import type { Story } from "./stories"
import { board, calendar, current, total, type Card } from "./weekly"

const story = (id: number, owner: number, person: string, end: string, spent = 1, remain = 2): Story => ({
  id,
  tag: `30548-${id}`,
  project: 1,
  sub: 0,
  name: `Story ${id}`,
  owner,
  person,
  module: 0,
  area: "",
  points: 4,
  type: 1,
  target: 0,
  spent,
  remain,
  finish: 0,
  end,
  status: "In Progress",
  tasks: [],
})
const card = (item: Story): Card => ({ spec: 30548, title: "Spec", story: item })

describe("weekly board", () => {
  test("covers the month with Monday to Sunday weeks", () => {
    const weeks = calendar("202611")
    // November 2026 starts on a Sunday: the first week starts Monday 26 October.
    expect(weeks[0].from).toBe("2026-10-26")
    expect(weeks[0].days.map((day) => day.inside)).toEqual([false, false, false, false, false, false, true])
    expect(weeks.at(-1)!.to).toBe("2026-12-06")
    expect(weeks.length).toBe(6)
    expect(weeks.every((week) => week.days.length === 7)).toBe(true)
  })

  test("opens on today's week, or the first week when today is in another month", () => {
    const weeks = calendar("202611")
    expect(current(weeks, "2026-11-03")).toBe(1)
    expect(current(weeks, "2026-12-01")).toBe(0)
  })

  test("places stories on their end date's day and the rest in To be planned", () => {
    const weeks = calendar("202611")
    const cards = [
      story(1, 7, "Hui Zhang", "2026-11-03"),
      story(2, 7, "Hui Zhang", "2026-11-12"),
      story(3, 7, "Hui Zhang", ""),
      story(4, 0, "", "2026-12-02"),
      story(5, 3, "David He", "2026-11-03"),
    ].map(card)
    const bands = board(cards, weeks, weeks[1])
    expect(bands.map((band) => band.person)).toEqual(["David He", "Hui Zhang", ""])
    const hui = bands[1]
    expect(Object.keys(hui.days)).toEqual(["2026-11-03"])
    expect(hui.later.map((item) => item.story.id)).toEqual([3])
    expect(hui.count).toBe(3)
    expect(hui.spent).toBe(3)
    // A day of next month shown in the last week is outside this month: its story waits to be planned.
    expect(bands[2].later.map((item) => item.story.id)).toEqual([4])
    expect(total(hui.days["2026-11-03"])).toEqual({ spent: 1, remain: 2, count: 1 })
  })
})
