import { describe, expect, test } from "bun:test"
import { plain, readPrefs } from "./prefs"

describe("p1 prefs", () => {
  test("reads P1's view settings and keeps the rest of its note", () => {
    const got = readPrefs({
      Data: [
        {
          PrefId: 3000104,
          PreferenceMemo: JSON.stringify({
            showClosedFolder: false,
            ShowItemsofCurrentFolderOnly: true,
            ShowEventOption: 1,
            EventOwnerFilterOption: 2,
            sortID: 1112,
          }),
        },
      ],
    })
    expect(got.prefs).toEqual({ closed: false, current: true, events: 1, owners: 2 })
    expect(got.memo.sortID).toBe(1112)
  })

  test("shows closed folders until told otherwise", () => {
    expect(readPrefs({ Data: [{ PrefId: 3000104, PreferenceMemo: "{}" }] }).prefs).toEqual(plain)
    expect(readPrefs({ Data: [] }).prefs).toEqual(plain)
    expect(readPrefs({ Data: [{ PrefId: 3000104, PreferenceMemo: "not json" }] }).prefs).toEqual(plain)
  })
})
