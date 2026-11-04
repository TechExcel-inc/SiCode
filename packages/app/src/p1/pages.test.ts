import { describe, expect, test } from "bun:test"
import { encode64 } from "./form"
import { readEvents, readHandoffs, readLinks, readLogs, readRuns, readVersions } from "./pages"

describe("p1 pages", () => {
  test("reads hand-offs and the change log", () => {
    expect(
      readHandoffs([
        {
          AssignedByUserName: "Yue Li",
          SateName: "Design Review",
          DateAssigned: "2026-10-02T09:30:00",
          OwnerName: "Hui Zhang",
        },
      ]),
    ).toEqual([{ by: "Yue Li", state: "Design Review", date: "2026-10-02T09:30:00", owner: "Hui Zhang" }])
    expect(
      readLogs({
        ChangelogSummaryItemList: [
          {
            DateChanged: "2026-10-03",
            ChangeByPersonName: "Hui Zhang",
            ChangeLogItemDetails: [{ Log: "Title changed" }, { Log: "Owner changed" }],
          },
        ],
      }),
    ).toEqual([
      { date: "2026-10-03", by: "Hui Zhang", text: "Title changed" },
      { date: "2026-10-03", by: "Hui Zhang", text: "Owner changed" },
    ])
  })

  test("reads versions newest first and events with their description decoded", () => {
    expect(
      readVersions({
        VersionItems: [
          { VersionName: "v1", CreatedByName: "A", CreatedDate: "2026-09-01" },
          { VersionName: "v2", CreatedByName: "B", CreatedDate: "2026-10-01" },
        ],
      }).map((item) => item.name),
    ).toEqual(["v2", "v1"])
    expect(
      readEvents([
        {
          Title: "Demo",
          StartDate: "2026-10-05T00:00:00",
          FinishDate: "2026-10-06T00:00:00",
          CrntOwnerName: "Ze Tang",
          StatusName: "Open",
          Description: encode64("<p>Show it</p>"),
        },
      ]),
    ).toEqual([
      {
        title: "Demo",
        start: "2026-10-05T00:00:00",
        due: "2026-10-06T00:00:00",
        owner: "Ze Tang",
        state: "Open",
        text: "<p>Show it</p>",
      },
    ])
  })

  test("reads linked requirements with their direction and linked test cases", () => {
    expect(
      readLinks({
        LinkedDevSpec: [
          { ItemID: 30520, ProjectID: 7, Title: "Bulk edit", State: "Finished", Owner: "Ann", ItemTypeID: 0, LinkReferenceTypeID: 3 },
          { ItemID: 30522, ProjectID: 7, Title: "Audit", State: "New", Owner: "Bo", ItemTypeID: 5, LinkReferenceTypeID: 6 },
          { ItemID: 30523, ProjectID: 7, Title: "Export", State: "New", Owner: "", ItemTypeID: 1 },
        ],
        LinkedDevTestTemplate: [
          { TemplateID: 49221, TemplateProjectID: 9, TemplateTitle: "Mandatory fields", State: "Approved", Owner: "Cy" },
          { TemplateID: 49221, TemplateProjectID: 9, TemplateTitle: "Mandatory fields", State: "Approved", Owner: "Cy" },
        ],
      }),
    ).toEqual({
      specs: [
        { id: 30520, project: 7, title: "Bulk edit", state: "Finished", owner: "Ann", kind: 0, relation: "parent", ref: 3 },
        { id: 30522, project: 7, title: "Audit", state: "New", owner: "Bo", kind: 5, relation: "child", ref: 6 },
        { id: 30523, project: 7, title: "Export", state: "New", owner: "", kind: 1, relation: "related", ref: 0 },
      ],
      knowledge: [],
      tests: [{ id: 49221, project: 9, title: "Mandatory fields", state: "Approved", owner: "Cy" }],
    })
    expect(readLinks(undefined)).toEqual({ specs: [], knowledge: [], tests: [] })
  })

  test("reads the test runs under each test case", () => {
    expect(
      readRuns({
        Data: {
          AllLinks: {
            Requirement: [{ IssueId: 1 }],
            "Test Library": [
              {
                IssueId: 49221,
                AllOtherLinks: {
                  "Test Run": [
                    { IssueId: 1584319, Title: "Bulk edit", CurrentStatusName: "Pass", IfClosed: true },
                    { IssueId: 1584351, Title: "Bulk edit", CurrentStatusName: "In progress", EnvInfo4TestRun: "Chrome" },
                  ],
                },
              },
              { IssueId: 49230 },
            ],
          },
        },
      }),
    ).toEqual({
      49221: [
        { id: 1584319, title: "Bulk edit", state: "Pass", closed: true, env: "" },
        { id: 1584351, title: "Bulk edit", state: "In progress", closed: false, env: "Chrome" },
      ],
      49230: [],
    })
    expect(readRuns(undefined)).toEqual({})
  })

})
