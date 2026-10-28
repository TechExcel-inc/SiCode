import { describe, expect, test } from "bun:test"
import { readColumns } from "./columns"
import { readModules } from "./points"

describe("p1 list", () => {
  test("reads the chosen columns, keeps ID, and leaves out ones too big for a cell", () => {
    const found = readColumns({
      ListViewFieldList: [
        { FieldID: 1101, FieldName: "Title", FieldControlType: 5 },
        { FieldID: 1131, FieldName: "Points", FieldControlType: 1 },
      ],
      AvailableFieldList: [
        { FieldID: 1102, FieldName: "Description", FieldControlType: 6 },
        { FieldID: 1110, FieldName: "Created by", FieldControlType: 4 },
      ],
    })
    expect(found.chosen.map((col) => col.id)).toEqual([1112, 1101, 1131])
    expect(found.pool.map((col) => col.id)).toEqual([1101, 1131, 1110])
  })

  test("reads spec points by module, with what was done", () => {
    const rows = readModules(
      { Data: [{ ImplementationModuleId: 9, OwnerId: 578, OwnerName: "David He", EstTotalPoints: 4, ModuleInfo: { ModuleID: 9, ModuleName: "DevSuite Admin" } }, { EstTotalPoints: 1 }] },
      { Data: [{ ModuleInfo: { ModuleID: 9 }, TaskCount: 1, TimeSpent: "4h", TimeRemain: "0h", FinishPercentage: "100%", EstTotalPoints: 4 }] },
    )
    expect(rows).toEqual([
      { module: 9, name: "DevSuite Admin", owner: 578, person: "David He", points: 4, tasks: 1, time: "4h/0h", finish: "100%" },
    ])
  })
})
