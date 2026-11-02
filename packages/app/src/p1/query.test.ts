import { describe, expect, test } from "bun:test"
import { condition, editor, readFields, readQueries, readQuery, row } from "./query"

const field = (id: number, type: number) => ({ id, name: `F${id}`, type })

describe("p1 query", () => {
  test("picks P1's editor for each field", () => {
    expect(editor(field(1110, 7))).toBe("pick")
    expect(editor(field(1112, 1))).toBe("text")
    expect(editor(field(1131, 2))).toBe("number")
    expect(editor(field(1130, 3))).toBe("date")
    expect(editor(field(1114, 4))).toBe("pick")
    expect(editor(field(1600, 9))).toBe("one")
    expect(editor(field(1601, 14))).toBe("yes")
    expect(editor(field(1102, 5))).toBe("text")
  })

  test("builds each condition as P1 stores it, and none while a row is empty", () => {
    expect(condition({ field: field(1102, 5), words: " login " })).toEqual({
      FieldId: 1102,
      FieldType: 5,
      Words: "login",
      OnlyEmpty: false,
    })
    expect(condition({ field: field(1114, 4), picks: ["3", "5"] })).toEqual({
      FieldId: 1114,
      FieldType: 4,
      ChoiceIds: ["3", "5"],
      NotInclude: false,
    })
    expect(condition({ field: field(1600, 9), picks: ["2"] }, [{ id: 2, name: "High" }])).toEqual({
      FieldId: 1600,
      FieldType: 9,
      Words: "High",
      NotInclude: false,
    })
    expect(condition({ field: field(1131, 2), from: "2", to: "" })).toEqual({
      FieldId: 1131,
      FieldType: 2,
      OnlyEmpty: false,
      From: 2,
      To: 0,
    })
    expect(condition({ field: field(1130, 3), from: "2026-01-01" })).toEqual({
      FieldId: 1130,
      FieldType: 3,
      From: "2026-01-01",
      To: "",
      Mode: 0,
      AroundDays: 0,
      OffsetDays: 0,
    })
    expect(condition({ field: field(1601, 14), yes: "no" })).toEqual({ FieldId: 1601, FieldType: 14, No: true })
    expect(condition({ field: field(1102, 5), words: "  " })).toBeUndefined()
    expect(condition({ field: field(1114, 4), picks: [] })).toBeUndefined()
    expect(condition({ field: field(1601, 14), yes: "" })).toBeUndefined()
  })

  test("reads a stored condition back into its row", () => {
    expect(row(field(1114, 4), { ChoiceIds: [3, "5"] })).toEqual({ field: field(1114, 4), picks: ["3", "5"] })
    expect(row(field(1130, 3), { From: "2026-01-01T00:00:00", To: "" })).toEqual({
      field: field(1130, 3),
      from: "2026-01-01",
      to: "",
    })
    expect(row(field(1600, 9), { Words: "High" }, [{ id: 2, name: "High" }])).toEqual({ field: field(1600, 9), picks: ["2"] })
    expect(row(field(1601, 14), { No: true })).toEqual({ field: field(1601, 14), yes: "no" })
  })

  test("reads saved searches, fields and a search's conditions", () => {
    expect(
      readQueries({
        QueryItemList: [
          { GeneralInfo: { QueryId: 9, Name: "Search 2", QueryType: 2 } },
          { GeneralInfo: { QueryId: 4, Name: "Search 1", QueryType: 1 } },
          { GeneralInfo: { QueryId: -10, Name: "", QueryType: 0 } },
        ],
      }),
    ).toEqual([
      { id: 4, name: "Search 1", open: false },
      { id: 9, name: "Search 2", open: true },
    ])
    expect(readFields({ FieldList: [{ FieldID: 1102, FieldName: "Description", FieldControlType: 5 }, { FieldID: 0 }] })).toEqual([
      { id: 1102, name: "Description", type: 5 },
    ])
    expect(readQuery({ GeneralInfo: { Formula: "A AND B" }, Conditions: [{ FieldId: 1102 }] })).toEqual({
      formula: "A AND B",
      conditions: [{ FieldId: 1102 }],
    })
  })
})
