import { call } from "./api"
import { decode64 } from "./doc"

/** What P1's own requirement pages show: its history, versions, events and document content. */

export type Handoff = { by: string; state: string; date: string; owner: string }
export type Log = { date: string; by: string; text: string }
export type Version = { name: string; by: string; date: string }
export type Event = { title: string; start: string; due: string; owner: string; state: string; text: string }
export type Link = {
  id: number
  project: number
  title: string
  state: string
  owner: string
  kind: number
  relation: Relation
  /** P1's reference type as sent: 5 and 6 are a spec's primary parent or child, kept on the spec itself. */
  ref: number
  /** The icon a picker showed for it, until P1's list comes back with its kind. */
  icon?: string
}
export type Relation = "parent" | "child" | "related"
export type Test = { id: number; project: number; title: string; state: string; owner: string }
export type Note = { id: number; project: number; title: string; state: string; owner: string }
export type Run = { id: number; title: string; state: string; closed: boolean; env: string }

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

/**
 * The spec's linked requirements and linked test cases, as P1's All Links reads them. P1 marks a link's direction
 * with its reference type: 3 and 5 link a parent, 4 and 6 a child, the rest are plain links.
 */
export function readLinks(data: unknown) {
  // P1 can hold the same link twice (a test case linked when created and again by hand); each shows once.
  const once = <T extends { project: number; id: number }>(list: T[]) =>
    list.filter((item, at) => list.findIndex((other) => other.project === item.project && other.id === item.id) === at)
  return {
    specs: once(
      list(data, "LinkedDevSpec").map(
        (item): Link => ({
          id: Number(item.ItemID) || 0,
          project: Number(item.ProjectID) || 0,
          title: text(item.Title),
          state: text(item.State),
          owner: text(item.Owner),
          kind: Number(item.ItemTypeID ?? 1),
          relation: [3, 5].includes(Number(item.LinkReferenceTypeID))
            ? "parent"
            : [4, 6].includes(Number(item.LinkReferenceTypeID))
              ? "child"
              : "related",
          ref: Number(item.LinkReferenceTypeID) || 0,
        }),
      ),
    ),
    knowledge: once(
      list(data, "LinkedKW").map(
        (item): Note => ({
          id: Number(item.ItemID) || 0,
          project: Number(item.ProjectID) || 0,
          title: text(item.Title),
          state: text(item.State ?? item.Status),
          owner: text(item.Owner),
        }),
      ),
    ),
    tests: once(
      list(data, "LinkedDevTestTemplate").map(
        (item): Test => ({
          id: Number(item.TemplateID) || 0,
          project: Number(item.TemplateProjectID) || 0,
          title: text(item.TemplateTitle),
          state: text(item.State),
          owner: text(item.Owner),
        }),
      ),
    ),
  }
}

export async function links(base: string, token: string, project: number, id: number, locale: string) {
  return readLinks(await call(base, token, `/DevSpecAPI/ReqAllLink?ProjectID=${project}&ItemID=${id}`, locale))
}

/**
 * The test runs under each linked test case, by test case id, from P1's per-module All Links: its lists are keyed
 * by module name ("Test Library", "Test Run"), spelled a few ways across P1 versions.
 */
export function readRuns(data: unknown) {
  const body = record(data) && record(data.Data) ? data.Data : data
  const pick = (from: unknown, names: string[]) =>
    record(from)
      ? Object.entries(from)
          .filter(([key]) => names.includes(key.replace(/\s/g, "").toLowerCase()))
          .flatMap(([, value]) => list(value))
      : []
  return Object.fromEntries(
    pick(record(body) ? body.AllLinks : undefined, ["testlibrary", "testliberary"]).map((item) => [
      Number(item.IssueId) || 0,
      pick(item.AllOtherLinks, ["testrun"]).map(
        (run): Run => ({
          id: Number(run.IssueId) || 0,
          title: text(run.Title),
          state: text(run.CurrentStatusName),
          closed: !!run.IfClosed,
          env: text(run.EnvInfo4TestRun),
        }),
      ),
    ]),
  ) as Record<number, Run[]>
}

/** Test runs under the spec's test cases; P1 needs the spec's space first, which it looks up by the spec. */
export async function runs(base: string, token: string, project: number, id: number, locale: string) {
  const found = await call(
    base,
    token,
    `/DevTrackApi/api/projectone/P1ProjectInfo4EmailLink?projectId=${project}&issueId=${id}`,
    locale,
  )
  const info = record(found) && record(found.Data) ? found.Data : record(found) ? found : {}
  return readRuns(
    await call(
      base,
      token,
      `/DevTrackApi/api/Task/allLinks4EachModule?projectId=${project}&projectTypeId=${Number(info.ModuleTypeId) || 32}&spaceId=${Number(info.ModuleSpaceId) || 0}&issueId=${id}`,
      locale,
    ),
  )
}

/**
 * Links or unlinks another spec, a test case or a knowledge item, as P1's All Links does. A child is linked from this
 * spec and a parent from the other one, both as reference type 3; a plain link is type 0; test cases are link type
 * 13 and knowledge 6. A primary parent or child (5, 6) is the spec's own parent field, so unlinking one clears it.
 */
export async function relate(
  base: string,
  token: string,
  locale: string,
  input: {
    project: number
    id: number
    other: { project: number; id: number }
    kind: Relation | "test" | "knowledge"
    add: boolean
    ref?: number
  },
) {
  if (!input.add && input.ref === 5)
    return call(
      base,
      token,
      "/DevSpecAPI/ReqItem",
      locale,
      { ProjectID: input.project, ID: input.id, ParentSpecID: 0 },
      "PUT",
    )
  if (!input.add && input.ref === 6)
    return call(
      base,
      token,
      "/DevSpecAPI/ReqItem",
      locale,
      { ProjectID: input.other.project, ID: input.other.id, ParentSpecID: 0 },
      "PUT",
    )
  const [from, to] = input.kind === "parent" ? [input.other, input] : [input, input.other]
  return call(base, token, "/DevSpecAPI/ReqAllLink", locale, {
    ProjectID: from.project,
    ItemID: from.id,
    LinkedProjectID: to.project,
    LinkedItemIDs: String(to.id),
    LinkTypeID: input.kind === "test" ? 13 : input.kind === "knowledge" ? 6 : 7,
    LinkReferenceTypeID: input.kind === "parent" || input.kind === "child" ? 3 : 0,
    ActionType: input.add ? 1 : 2,
    NotRemoveOld: 1,
  })
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
