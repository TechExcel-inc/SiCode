import { call } from "./api"
import { decode64 } from "./doc"

/** What P1's own requirement pages show: its history, versions, events and document content. */

export type Handoff = { by: string; state: string; date: string; owner: string }
export type Log = { date: string; by: string; text: string }
export type Version = { name: string; by: string; date: string }
export type Event = { title: string; start: string; due: string; owner: string; state: string; text: string }

const list = (data: unknown, key?: string) => {
  const found = key && record(data) ? data[key] : data
  return (Array.isArray(found) ? found : []).filter(record)
}
const text = (value: unknown) => (value === undefined || value === null ? "" : String(value))

/** Who passed the spec on, in which state, when, and to whom: the first hand-off is its submission. */
export function readHandoffs(data: unknown): Handoff[] {
  return list(data).map((item) => ({
    by: text(item.AssignedByUserName),
    state: text(item.SateName ?? item.StateName),
    date: text(item.DateAssigned),
    owner: text(item.OwnerName),
  }))
}

/** The change log, one line per change, newest as P1 sends it. */
export function readLogs(data: unknown): Log[] {
  return list(data, "ChangelogSummaryItemList").flatMap((item) =>
    list(item, "ChangeLogItemDetails").map((detail) => ({
      date: text(item.DateChanged),
      by: text(item.ChangeByPersonName),
      text: text(detail.Log),
    })),
  )
}

export function readVersions(data: unknown): Version[] {
  return list(data, "VersionItems")
    .map((item) => ({ name: text(item.VersionName), by: text(item.CreatedByName), date: text(item.CreatedDate) }))
    .reverse()
}

export function readEvents(data: unknown): Event[] {
  return list(data).map((item) => ({
    title: text(item.Title),
    start: text(item.StartDate),
    due: text(item.FinishDate),
    owner: text(item.CrntOwnerName),
    state: text(item.StatusName),
    text: decode64(text(item.Description)) ?? text(item.Description),
  }))
}

export async function history(base: string, token: string, project: number, id: number, locale: string) {
  const [handoffs, logs] = await Promise.all([
    call(base, token, "/DevSpecAPI/ReqItemStateHistory", locale, { ItemId: id, projectId: project, VersionID: 0 }),
    call(base, token, "/DevSpecAPI/ReqItemChangelogList", locale, { ItemID: id, ProjectID: project, VersionID: 0 }),
  ])
  return { handoffs: readHandoffs(handoffs), logs: readLogs(logs) }
}

export async function versions(base: string, token: string, project: number, id: number, locale: string) {
  return readVersions(
    await call(base, token, "/DevSpecAPI/ActionApi/Reqversion/GetVersionList", locale, {
      ProjectID: project,
      ItemID: id,
    }),
  )
}

export async function events(base: string, token: string, project: number, id: number, folder: number, locale: string) {
  return readEvents(
    await call(base, token, "/DevSpecAPI/ReqEventList", locale, {
      ItemIDs: [id],
      OwnerIDs: [],
      ProjectID: project,
      ShowCloseEvent: 3,
      FolderID: folder,
    }),
  )
}

/** The spec's document content, as HTML. */
export async function content(base: string, token: string, project: number, id: number, locale: string) {
  const data = await call(
    base,
    token,
    `/DevSpecAPI/ActionApi/ReqDocContent/GetReqDocContent?ProjectID=${project}&ItemID=${id}`,
    locale,
  )
  return record(data) ? (decode64(text(data.ContentHTML)) ?? "") : ""
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
