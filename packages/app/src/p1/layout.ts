import type { Field, Spot } from "./form"

/**
 * Where P1 puts each field of a designed page, ported from P1's `getShowFieldsListCoordinate`: fields sharing a
 * band of height make a row, fields in a row sharing a band of width make a column, and every size and gap is the
 * designer's (in units about 1010 wide) scaled to the form's width. A column's fields sit on lines: fields that start
 * at the column's top share its first line side by side, and a field lower down starts a new line under the last.
 */
export type Placed = {
  field: Field
  width: number
  left: number
  top: number
  label: number
  split: number
  line: number
  bare: boolean
}
export type Column = { width: number; left: number; top: number; items: Placed[] }
export type Row = { columns: Column[] }

type Item = { field: Field; at: Spot; bare: boolean }
type Box = { left: number; right: number; top: number; bottom: number }

export function arrange(fields: Field[], width: number): Row[] {
  const scale = (value: number) => Math.trunc((value * width) / 1010)
  const list = fields.flatMap((field): Item[] => {
    if (!field.at) return []
    const at = { ...field.at }
    // No label drawn: the control alone, from its own left edge.
    const bare = (!at.lb && !at.lr) || at.ll === at.cl || field.type === 14 || field.type === 18
    if (bare) return [{ field, bare, at: { ...at, ll: at.cl, lr: at.cl, lt: at.ct, lb: at.cb } }]
    return [{ field, bare, at }]
  })
  const rows = order(group(list, across), "top", "left")
  return rows.map((row) => {
    const flat = row.list.every((item) => row.bottom - item.at.cb < 5 && row.top > item.at.ct - 5)
    const columns = flat
      ? [{ ...bounds(row.list), list: order(row.list, "ct", "cl") }]
      : order(group(row.list, down), "top", "left").map((column) => ({
          ...column,
          list: order(column.list, "ct", "cl"),
        }))
    return {
      columns: columns.map((column, index) => {
        const lines = column.list.reduce<number[]>((all, item, at) => {
          if (!at) return [0]
          return [...all, item.at.ct - column.top < 5 ? all[at - 1] : all[at - 1] + 1]
        }, [])
        return {
          width: scale(column.right - column.left),
          left: scale(index ? column.left - columns[index - 1].right : column.left),
          top: scale(column.top - row.top),
          items: column.list.map((item, at) => {
            const prev = column.list[at - 1]
            const stacked = !!prev && lines[at] !== lines[at - 1]
            return {
              field: item.field,
              width: scale(item.at.cr - item.at.ll),
              left: scale(item.at.ll - column.left),
              top: scale(stacked ? item.at.ct - prev.at.cb : item.at.ct - column.top),
              label: scale(item.at.lr - item.at.ll),
              split: scale(item.at.cl - item.at.lr),
              line: lines[at],
              bare: item.bare,
            }
          }),
        }
      }),
    }
  })
}

/** The box around some fields: from the leftmost label to the rightmost control, the top control to the bottom one. */
function bounds(list: Item[]): Box {
  return {
    left: Math.min(...list.map((item) => item.at.ll)),
    right: Math.max(...list.map((item) => item.at.cr)),
    top: Math.min(...list.map((item) => item.at.ct)),
    bottom: Math.max(...list.map((item) => item.at.cb)),
  }
}

// Whether a field overlaps a row's band of height, or a column's band of width.
function across(box: Box, item: Item) {
  return touches(box.top, box.bottom, item.at.ct, item.at.cb)
}
function down(box: Box, item: Item) {
  return touches(box.left, box.right, item.at.ll, item.at.cr)
}
function touches(start: number, end: number, from: number, to: number) {
  return (start >= from && start <= to) || (start <= from && end > from)
}

/** Groups fields that overlap, merging groups a field joins together. */
function group(list: Item[], near: (box: Box, item: Item) => boolean) {
  return list.reduce<(Box & { list: Item[] })[]>((all, item) => {
    const joined = all.filter((box) => near(box, item))
    const items = [item, ...joined.flatMap((box) => box.list)]
    return [...all.filter((box) => !near(box, item)), { ...bounds(items), list: items }]
  }, [])
}

/** Sorts by one key, then another, as P1 does. */
function order<T>(list: T[], first: string, second: string) {
  const pick = (item: T, key: string) => {
    const box = item as Record<string, unknown>
    if (key in box) return Number(box[key])
    return Number((box.at as Record<string, number>)[key])
  }
  return [...list].sort((a, b) => pick(a, first) - pick(b, first) || pick(a, second) - pick(b, second))
}
