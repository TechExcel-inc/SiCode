import { describe, expect, test } from "bun:test"
import { bunch, readGroups, readFolders } from "./api"
import { active, blank, bucket, closed, condition, expand, month, open, readOwners, readStates, weeks } from "./filter"

describe("p1 filter", () => {
  test("sends nothing for an empty filter, since P1 refuses an empty condition", () => {
    expect(condition(blank)).toEqual({})
    expect(active(blank)).toBe(false)
  })

  test("sends owners or submitters, states, module owners, grouping and link checks as P1 does", () => {
    expect(
      condition({ ...blank, owners: [3], states: [70], modules: [9], group: 1113, unlinked: true, untested: true }),
    ).toEqual({
      Condition: { OwnerIDs: [3], StateIDs: [70] },
      ModuleOwnerIDs: [9],
      GroupByID: 1113,
      SubGroupByID: 0,
      withoutReqLink: 1,
      WithoutTestTempLink: 1,
    })
    expect(condition({ ...blank, owners: [3], submitter: true })).toEqual({ Condition: { CreatedByIDs: [3] } })
    expect(active({ ...blank, group: 1604 })).toBe(false)
    // Module owner grouping needs a condition even when nothing is filtered.
    expect(condition({ ...blank, group: 1604 })).toEqual({ Condition: {}, GroupByID: 1604, SubGroupByID: 0 })
    expect(condition({ ...blank, group: 1113 })).toEqual({ GroupByID: 1113, SubGroupByID: 0 })
  })

  test("reads owners without P1's all-members entry, and states with whether they are closed", () => {
    expect(
      readOwners({
        OwnerList: [
          { UserID: -2, UserName: "{All Members}" },
          { UserID: 0, UserName: "{Unassigned}" },
          { UserID: 578, UserName: "David He" },
        ],
      }),
    ).toEqual([
      { id: 0, name: "{Unassigned}" },
      { id: 578, name: "David He" },
    ])
    expect(readStates({ StatusList: [{ StateID: 62, StateName: "Finished", IsClosed: 1 }] })).toEqual([
      { id: 62, name: "Finished", closed: true },
    ])
  })

  test("turns open only and closed only into the states they stand for", () => {
    const states = [
      { id: 70, name: "Committed", closed: false },
      { id: 62, name: "Finished", closed: true },
    ]
    expect(expand([open], states)).toEqual([70])
    expect(expand([closed, 70], states)).toEqual([62, 70])
  })

  test("reads P1's groups with their rows and totals in hours", () => {
    const got = readGroups({
      TotalCount: 3,
      GroupByInfos: [
        {
          GroupByID: 1113,
          GroupByValue: "David He",
          GroupByValueID: "578",
          AllSpecIDs: "30542,30523,30500",
          SpecTotalPoints: 9,
          SpecFinishPoints: 4,
          TaskTotalTimeSpent: 780,
          TaskTotalTimeRemain: 90,
          SpecPercentage: "44",
          ListItems: [
            { 1112: 30542, 1101: "Bulk edit" },
            { 1112: 30523, 1101: "Baseline" },
          ],
        },
      ],
    })
    expect(got.rows.map((row) => row.id)).toEqual([30542, 30523])
    // Groups P1 sends without rows (module owner) still know which requirements they hold.
    expect(
      readGroups({ GroupByInfos: [{ GroupByID: 1604, GroupByValueID: "578", GroupByValue: "David He", AllSpecIDs: "30542,30521" }] })
        .groups[0].ids,
    ).toEqual([30542, 30521])
    expect(got.groups).toEqual([
      {
        key: "1113-578",
        by: 1113,
        name: "David He",
        count: 3,
        ids: [30542, 30523],
        points: 9,
        totals: { done: 4, spent: 13, remain: 1.5, finish: 44 },
      },
    ])
  })

  test("groups rows by Created by on the page when P1 sends no groups", () => {
    const row = (id: number, by: string, points: string) => ({
      id,
      title: "",
      status: "",
      owner: "",
      type: "",
      points,
      cells: { 1110: by },
      tasks: 0,
      attachments: 0,
      kind: 1,
      closed: false,
      shortcut: false,
      attached: false,
    })
    const got = bunch([row(1, "Amy", "2"), row(2, "Bo", "1"), row(3, "Amy", "0.5")], 1110)
    expect(got.map((group) => [group.name, group.ids, group.points])).toEqual([
      ["Amy", [1, 3], 2.5],
      ["Bo", [2], 1],
    ])
    expect(got[0].totals).toBeUndefined()
  })

  test("reads a folder's roadmap months and counts its weeks and buckets as P1 does", () => {
    expect(
      readFolders({
        FolderNodes: [
          { FolderID: 17243, FolderName: "October", RoadMapMonthStart: "202610", RoadMapMonthEnd: "202610" },
        ],
      }),
    ).toEqual([
      { id: 17243, name: "October", count: 0, type: 0, closed: false, months: { start: "202610", end: "202610" } },
    ])
    // October 2026 starts on a Thursday, so its 1st week runs to Sunday the 4th.
    expect(weeks("202610").slice(0, 2)).toEqual([
      { from: "10/01", to: "10/04" },
      { from: "10/05", to: "10/11" },
    ])
    expect(weeks("202610").at(-1)).toEqual({ from: "10/26", to: "10/31" })
    expect(bucket("Priority Order:0 - 9", "202610")).toEqual({ kind: "commit" })
    expect(bucket("Priority Order: 30 - 39", "202610")).toEqual({ kind: "week", index: 2, from: "10/12", to: "10/18" })
    expect(bucket("Others", "202610")).toEqual({ kind: "later" })
    expect(month({ start: "202610", end: "202610" }, new Date(2026, 9, 29))).toBe("202610")
    expect(month({ start: "202601", end: "202603" }, new Date(2026, 9, 29))).toBe("202603")
  })
})
