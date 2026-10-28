import { describe, expect, test } from "bun:test"
import { edited, made, readFolder } from "./folder"

const raw = {
  ProjectID: 190,
  "Folder Name": "October",
  "Folder Description": "<p>Month</p>",
  "Folder Status": "Open",
  FolderPath: ["DevSuite 11", "ProjectOne 11.5 Release ", "2026", "October"],
  TypeID: 30,
  RoadMapMonthStart: "202610",
  RoadMapMonthEnd: "202610",
  PlanStartDate: "",
  PlanEndDate: "",
  LinkedReqTemplateID: "0",
  CustomerID: "",
}

describe("p1 folder", () => {
  test("reads a folder", () => {
    expect(readFolder(raw)).toEqual({
      name: "October",
      open: true,
      type: 30,
      html: "<p>Month</p>",
      start: "",
      end: "",
      from: "202610",
      to: "202610",
      parent: "DevSuite 11 / ProjectOne 11.5 Release  / 2026",
    })
  })

  test("saves an edit with what was read underneath", () => {
    const body = edited(190, 17243, raw, { ...readFolder(raw), name: "Oct 2026", open: false })
    expect(body).toMatchObject({
      ProjectID: 190,
      FolderID: 17243,
      "Folder Name": "Oct 2026",
      "Folder Status": "Close",
      TypeID: 30,
      RoadMapMonthStart: "202610",
      EnableRoadMapMonth: 1,
      LinkedReqTemplateID: "0",
    })
  })

  test("adds a folder below another, without roadmap months for a regular one", () => {
    expect(made(190, 17243, 1, { ...readFolder(raw), name: "November", type: 0 })).toMatchObject({
      ProjectID: 190,
      ParentFolderID: 17243,
      position: 1,
      "Folder Name": "November",
      TypeID: 0,
      RoadMapMonthStart: "",
      EnableRoadMapMonth: 0,
    })
  })
})
