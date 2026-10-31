import { describe, expect, test } from "bun:test"
import { arrange } from "./layout"

const field = (id: number, type: number, ll: number, lr: number, cl: number, cr: number, ct: number, cb: number) => ({
  id,
  name: String(id),
  type,
  at: { ll, lr, lt: ct, lb: cb, cl, cr, ct, cb },
})

describe("p1 layout", () => {
  test("puts fields side by side in a row and full-width ones on their own", () => {
    const rows = arrange(
      [
        field(1102, 6, 10, 100, 110, 1000, 100, 400),
        field(1143, 4, 10, 100, 110, 500, 50, 80),
        field(1144, 4, 510, 600, 610, 1000, 50, 80),
      ],
      1010,
    )
    expect(rows.length).toBe(2)
    expect(rows[0].columns.length).toBe(1)
    expect(
      rows[0].columns[0].items.map((item) => [item.field.id, item.left, item.width, item.label, item.split, item.line]),
    ).toEqual([
      [1143, 0, 490, 90, 10, 0],
      [1144, 500, 490, 90, 10, 0],
    ])
    expect(rows[1].columns[0].items[0]).toMatchObject({ width: 990, label: 90, top: 0 })
  })

  test("stacks fields that sit lower in a column, and scales to the form's width", () => {
    const rows = arrange(
      [
        field(1101, 4, 10, 100, 110, 500, 10, 40),
        field(1113, 7, 10, 100, 110, 500, 20, 60),
        field(1114, 7, 600, 700, 710, 1000, 10, 40),
      ],
      505,
    )
    const column = rows[0].columns[0]
    expect(column.items.map((item) => [item.field.id, item.line, item.top])).toEqual([
      [1101, 0, 0],
      [1113, 1, -10],
    ])
    expect(rows[0].columns[1]).toMatchObject({ left: 50, width: 200 })
  })

  test("leaves the label out when the designer drew none", () => {
    const rows = arrange(
      [{ id: 1, name: "x", type: 14, at: { ll: 10, lr: 100, lt: 0, lb: 30, cl: 110, cr: 300, ct: 0, cb: 30 } }],
      1010,
    )
    expect(rows[0].columns[0].items[0]).toMatchObject({ bare: true, label: 0, split: 0, width: 190 })
  })
})
