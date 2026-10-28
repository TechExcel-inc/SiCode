import { call } from "./api"

/** The requirement list's columns, chosen per user and requirement project the way P1's Customize dialog keeps them. */

export type Column = { id: number; name: string; type: number }

/** What a list shows before anyone customizes it. */
export const fallback: Column[] = [
  { id: 1112, name: "ID", type: 4 },
  { id: 1101, name: "Title", type: 5 },
  { id: 1121, name: "Spec Type", type: 7 },
  { id: 1114, name: "Status", type: 7 },
  { id: 1113, name: "Spec Owner", type: 7 },
  { id: 1131, name: "Points", type: 1 },
]

/** ID always shows; P1 doesn't let it leave the list. */
export const pinned = 1112

/** Columns that hold too much to show in a list cell. */
const hidden = [1102, 1135, 1138, 1149, 1605]

export function readColumns(data: unknown) {
  const list = (key: string) =>
    (record(data) && Array.isArray(data[key]) ? data[key] : [])
      .filter(record)
      .map((item) => ({ id: Number(item.FieldID), name: String(item.FieldName ?? ""), type: Number(item.FieldControlType) }))
      .filter((item) => item.id && !hidden.includes(item.id))
  const chosen = list("ListViewFieldList")
  const all = [...chosen, ...list("AvailableFieldList")]
  const pool = all.filter((item, index) => all.findIndex((other) => other.id === item.id) === index)
  return { chosen: chosen.length ? withId(chosen) : fallback.filter((item) => pool.some((p) => p.id === item.id) || item.id === pinned), pool }
}

function withId(list: Column[]) {
  return list.some((item) => item.id === pinned) ? list : [fallback[0], ...list]
}

export async function columns(base: string, token: string, project: number, locale: string) {
  const data = await call(
    base,
    token,
    `/DevSpecAPI/ReqItemList/GetCustomizeFields?ProjectID=${project}&isStandard=0&isTaskTracking=0&isNoDev=0`,
    locale,
  )
  return readColumns(data)
}

/** P1's default columns for the project, for Reset. */
export async function defaults(base: string, token: string, project: number, locale: string) {
  const data = await call(base, token, `/DevSpecAPI/ReqListViewDefault?ProjectID=${project}&isStandard=0`, locale)
  const body = record(data) && Array.isArray(data.ListViewFieldList) ? data : { ListViewFieldList: Array.isArray(data) ? data : [] }
  return readColumns(body).chosen
}

/** Saves the chosen columns to the same setting P1's Customize dialog writes. */
export async function keep(base: string, token: string, project: number, user: string, list: Column[], locale: string) {
  await call(base, token, "/DevSpecAPI/UserSetting", locale, {
    ProjectID: project,
    UserID: Number(user) || user,
    UserSettings: [
      { SettingItemID: 5601, SettingItemName: "show close folder", SettingValue: 0, SettingText: list.map((item) => item.id).join(",") },
    ],
  })
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
