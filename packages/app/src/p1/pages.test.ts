import { describe, expect, test } from "bun:test"
import { encode64 } from "./form"
import { readEvents, readHandoffs, readLogs, readVersions } from "./pages"

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
})
