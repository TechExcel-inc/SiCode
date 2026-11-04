import { describe, expect, test } from "bun:test"
import { home, readCases, readKnowledge, readTests } from "./links"

describe("p1 link pickers", () => {
  test("starts each picker at its space", () => {
    const space = {
      project: 1,
      folder: 9,
      name: "DevSuite",
      test: { project: 2, space: 3, name: "Tests" },
      knowledge: { project: 4, space: 5, name: "KB" },
    }
    expect(home(space, "spec")).toEqual({ project: 1, space: 9, name: "DevSuite" })
    expect(home(space, "test")).toEqual({ project: 2, space: 3, name: "Tests" })
    expect(home({ project: 1, folder: 9, name: "" }, "knowledge")).toBeUndefined()
  })

  test("reads the test library tree, keeping each branch's first-level folder", () => {
    const first = readTests({ id: 3, name: "Tests", childTree: [{ id: 10, name: "2026", hasChild: true }] }, 3)
    expect(first).toEqual([{ id: 10, name: "2026", more: true, type: 0, closed: false, top: 10 }])
    // The space opened lists itself first, with its folders under it: those are its children, never itself.
    expect(
      readTests({ id: 3, name: "DevSuite", childTree: [{ id: 3, name: "DevSuite", child: [{ id: 21, name: "2023", hasChild: true }] }] }, 3),
    ).toEqual([{ id: 21, name: "2023", more: true, type: 0, closed: false, top: 3 }])
    expect(readTests({ Data: { child: [{ id: 11, name: "Nov", subtype: 2 }] } }, 10, 10)).toEqual([
      { id: 11, name: "Nov", more: false, type: 2, closed: false, top: 10 },
    ])
  })

  test("reads test cases, negative ids included", () => {
    expect(
      readCases({ Count: 7764, Values: [{ 1001: -1100005818, 1101: "管理员删除报表验证", 1010: "Draft", 1008: "" }, { 1101: "x" }] }, 9),
    ).toEqual({
      items: [{ id: -1100005818, project: 9, title: "管理员删除报表验证", state: "Draft", owner: "", icon: "" }],
      total: 7764,
    })
  })

  test("reads knowledge items", () => {
    expect(readKnowledge({ TotalCount: 1, ListItems: [{ 1112: 5, 1101: "Setup", 1114: "Published", 1113: "Ann" }] }, 4)).toEqual({
      items: [{ id: 5, project: 4, title: "Setup", state: "Published", owner: "Ann", icon: "" }],
      total: 1,
    })
  })
})
