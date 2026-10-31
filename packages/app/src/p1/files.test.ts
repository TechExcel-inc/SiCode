import { describe, expect, test } from "bun:test"
import { encode64 } from "./form"
import { icon, picture, readFiles, readNotes, reports, specIcon } from "./files"

describe("p1 files", () => {
  test("reads attachments in file order, meetings among them, and leaves out other issue types", () => {
    const list = readFiles({
      AttachmentInfoList: [
        {
          FileID: 9,
          VersionID: 1,
          DisplayFileName: "LogoffIssue.docx",
          AttachmentTypeID: 0,
          LastCheckInDate: "2026-10-01",
        },
        {
          FileID: 3,
          VersionID: 2,
          DisplayFileName: "WebServiceError.png",
          LastCheckOutBy: 7,
          LastCheckOutByName: "Ze Tang",
        },
        {
          FileID: 5,
          FileName: "m1",
          AttachmentTypeID: 6,
          HistorySet: [{ DateChanged: "2026-04-24T12:02:00", ChangedBy: "Mark Sun" }],
        },
        { FileID: 4, DisplayFileName: "x", IssueTypeID: 405 },
      ],
    })
    expect(list.map((file) => [file.id, file.kind, file.lock])).toEqual([
      [3, 0, "Ze Tang"],
      [5, 6, ""],
      [9, 0, ""],
    ])
    expect(list[1].changed).toEqual({ date: "2026-04-24T12:02:00", by: "Mark Sun" })
  })

  test("picks P1's icon for a file", () => {
    expect(icon({ name: "a.DOCX", kind: 0 })).toBe("word")
    expect(icon({ name: "a.csv", kind: 0 })).toBe("xlsx")
    expect(icon({ name: "a.pdf", kind: 0 })).toBe("pdf")
    expect(icon({ name: "a.weird", kind: 0 })).toBe("default")
    expect(icon({ name: "pen", kind: 5 })).toBe("note")
    expect(picture("shot.PNG")).toBe(true)
  })

  test("reads comments with their replies", () => {
    expect(
      readNotes({
        NoteItems: [
          {
            NoteID: 1,
            "Created By": "Hui Zhang",
            DateLag: "2 days ago",
            Description: encode64("<p>Looks good</p>"),
            ChildNoteItems: [
              { NoteID: 2, "Created By": "Yue Li", DateLag: "1 day ago", Description: encode64("<p>Thanks</p>") },
            ],
          },
        ],
      }),
    ).toEqual([
      {
        id: 1,
        by: "Hui Zhang",
        lag: "2 days ago",
        html: "<p>Looks good</p>",
        replies: [{ id: 2, by: "Yue Li", lag: "1 day ago", html: "<p>Thanks</p>", replies: [] }],
      },
    ])
  })

  test("draws each requirement with P1's icon: its kind, a paperclip with attachments, gray once closed", () => {
    const row = { kind: 1, closed: false, shortcut: false, attached: false }
    expect(specIcon(row)).toBe("spec")
    expect(specIcon({ ...row, attached: true })).toBe("spec-attach")
    expect(specIcon({ ...row, attached: true, closed: true })).toBe("spec-attach-closed")
    expect(specIcon({ ...row, kind: 5, attached: true })).toBe("defect-attach")
    expect(specIcon({ ...row, kind: 5, closed: true })).toBe("spec-closed")
    expect(specIcon({ ...row, kind: 2, attached: true })).toBe("epic-attach")
    expect(specIcon({ ...row, kind: 3 })).toBe("spec")
    expect(specIcon({ ...row, kind: 3, attached: true })).toBe("other-attach")
    expect(specIcon({ ...row, shortcut: true, attached: true })).toBe("icon-spec-shortcut")
  })

  test("finds a description's LiveDoc Reports once each", () => {
    const img = (id: number, item: number) =>
      `<img src="https://kloud.cn/data/live.png?kloudAttachmentID=${id}&amp;imageItemid=${item}">`
    const html = `<p>${img(77, 1)}${img(77, 2)}${img(78, 3)}<img src="https://x.cn/a.png"></p>`
    expect(reports(html).map((item) => [item.id, item.item])).toEqual([
      ["77", "1"],
      ["78", "3"],
    ])
  })
})
