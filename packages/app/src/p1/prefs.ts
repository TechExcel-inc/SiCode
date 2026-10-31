import { call } from "./api"

/**
 * P1's requirement view settings, kept per user and project family in preference 3000104, as P1's settings
 * popover keeps them: closed folders shown, the folder's own items only, and which events the list shows.
 */
export type Prefs = {
  closed: boolean
  current: boolean
  // 0 no events, 1 open, 2 closed, 3 open and closed.
  events: number
  // Bits: 1 members in the owner filter, 2 members who own the parent spec.
  owners: number
}

const PREF = 3000104

export const plain: Prefs = { closed: true, current: false, events: 0, owners: 0 }

/** P1 keeps more in the same note (sorting, roadmap months…), so a save writes back everything it read. */
export function readPrefs(data: unknown): { prefs: Prefs; memo: Record<string, unknown> } {
  const list = record(data) && Array.isArray(data.Data) ? data.Data.filter(record) : []
  const row = list.find((item) => Number(item.PrefId) === PREF) ?? list[0]
  const memo = parse(row?.PreferenceMemo)
  return {
    memo,
    prefs: {
      // P1 shows closed folders until you say otherwise.
      closed: memo.showClosedFolder === undefined ? true : !!memo.showClosedFolder,
      current: !!memo.ShowItemsofCurrentFolderOnly,
      events: Number(memo.ShowEventOption) || 0,
      owners: Number(memo.EventOwnerFilterOption) || 0,
    },
  }
}

export async function prefs(base: string, token: string, user: string, family: number, locale: string) {
  return readPrefs(
    await call(base, token, "/DevTrackApi/api/UserPreference/Preferences", locale, {
      UserId: Number(user) || user,
      ProjectId: family,
      PrefIds: [PREF],
    }),
  )
}

/** Saves the settings into P1's note, and the event choice into P1's user settings the list reads it from. */
export async function keep(
  base: string,
  token: string,
  input: { user: string; family: number; project: number; memo: Record<string, unknown>; next: Prefs; events: boolean },
  locale: string,
) {
  const user = Number(input.user) || input.user
  await call(base, token, "/DevTrackApi/api/UserPreference/Save", locale, {
    ProjectId: input.family,
    UserId: user,
    PrefId: PREF,
    PreferenceValue: "",
    PreferenceText: "",
    PreferenceMemo: JSON.stringify({
      ...input.memo,
      showClosedFolder: input.next.closed,
      ShowItemsofCurrentFolderOnly: input.next.current,
      ShowEventOption: input.next.events,
      EventOwnerFilterOption: input.next.owners,
    }),
  })
  if (!input.events) return
  await call(base, token, "/DevSpecAPI/UserSetting", locale, {
    ProjectID: input.project,
    UserID: user,
    UserSettings: [
      {
        SettingItemID: 5576,
        SettingItemName: "show items of child folders",
        SettingValue: input.next.events,
        SettingText: "",
      },
      {
        SettingItemID: 5577,
        SettingItemName: "show items of child folders",
        SettingValue: input.next.owners & 1 ? 1 : 0,
        SettingText: "",
      },
      {
        SettingItemID: 5578,
        SettingItemName: "show items of child folders",
        SettingValue: input.next.owners & 2 ? 1 : 0,
        SettingText: "",
      },
    ],
  })
}

function parse(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value) return {}
  const data = (() => {
    try {
      return JSON.parse(value) as unknown
    } catch {
      return undefined
    }
  })()
  return record(data) ? data : {}
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
