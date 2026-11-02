import { describe, expect, test } from "bun:test"
import { card, fit, mine, range, rank, spread, width } from "./board"

describe("spread", () => {
  test("gives the tallest column more cards across while the board has room", () => {
    expect(spread([7, 1], 1600)).toEqual([4, 1])
    expect(spread([7, 3], 1000)).toEqual([2, 1])
  })

  test("keeps one card across when the board is full and empty columns at none", () => {
    expect(spread([5, 4, 3], 800)).toEqual([1, 1, 1])
    expect(spread([6, 0], 1200)).toEqual([3, 0])
  })

  test("stops once every column is one row tall", () => {
    expect(spread([2, 1], 5000)).toEqual([2, 1])
    expect(spread([], 1000)).toEqual([])
  })

  test("a column's width grows with its cards across", () => {
    expect(width(1)).toBe(card + 16)
    expect(width(2)).toBe(card * 2 + 8 + 16)
    expect(width(0)).toBeLessThan(card)
  })
})

describe("range", () => {
  test("reads the priority # range from P1's group name", () => {
    expect(range("Priority Order:0 - 9")).toEqual({ lo: 0, hi: 9 })
    expect(range("Priority Order: 30 - 39")).toEqual({ lo: 30, hi: 39 })
    expect(range("Others")).toBeUndefined()
  })
})

describe("rank", () => {
  const week = { lo: 30, hi: 39 }
  test("lands between its neighbours", () => {
    expect(rank(31, 35, week)).toBe(33)
    expect(rank(31, 32, week)).toBe(32)
    expect(rank(33, 33, week)).toBe(33)
  })

  test("goes one past a neighbour at either end, inside the group's range", () => {
    expect(rank(34, undefined, week)).toBe(35)
    expect(rank(39, undefined, week)).toBe(39)
    expect(rank(undefined, 34, week)).toBe(33)
    expect(rank(undefined, 30, week)).toBe(30)
  })

  test("takes the range's start in an empty group, or keeps its own without a range", () => {
    expect(rank(undefined, undefined, week)).toBe(30)
    expect(rank(undefined, undefined, undefined, 64)).toBe(64)
    expect(rank(undefined, 0)).toBe(0)
  })
})

describe("fit", () => {
  test("keeps the usual card width when narrower cards gain nothing", () => {
    expect(fit([7, 1], 1600)).toEqual({ size: card, across: [4, 1] })
    expect(fit([], 1000)).toEqual({ size: card, across: [] })
  })

  test("narrows the cards when that fits another card across the tallest column", () => {
    const got = fit([12, 3, 1, 0, 0, 0], 1512)
    expect(got.across).toEqual([2, 1, 1, 0, 0, 0])
    expect(got.size).toBeLessThan(card)
  })

  test("gives the busiest column two cards across even when the board must scroll for it", () => {
    expect(fit([11, 1, 1, 6], 900)).toEqual({ size: card, across: [2, 1, 1, 1] })
    expect(fit([3, 1], 300).across).toEqual([1, 1])
  })
})

describe("mine", () => {
  test("keeps a person's own stories, or all when they own none", () => {
    const list = [{ owner: 1 }, { owner: 2 }, { owner: 1 }]
    expect(mine(list, 1)).toEqual([{ owner: 1 }, { owner: 1 }])
    expect(mine(list, 3)).toEqual(list)
    expect(mine(list)).toEqual(list)
  })
})
