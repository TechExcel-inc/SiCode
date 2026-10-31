import { client } from "./http"
import { decode64, htmlOf } from "./doc"
import { blank, condition, readOwners, readStates, type Filter } from "./filter"

type Http = typeof fetch

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = "HttpError"
    this.status = status
  }
}

export function denied(err: unknown) {
  return err instanceof HttpError && err.status === 401
}

export function origin(value: string) {
  const text = value.trim().replace(/\/+$/, "")
  if (!text) return
  if (/^https?:\/\//i.test(text)) return text
  return `https://${text}`
}

/** P1 `languageid`: 2 for Chinese, 1 otherwise. */
export function lang(locale: string) {
  return locale === "zh" || locale === "zht" ? 2 : 1
}

/** A positive integer id typed by the user. */
export function num(value: string) {
  const text = value.trim()
  if (!/^[1-9]\d*$/.test(text)) return
  const n = Number(text)
  if (!Number.isSafeInteger(n)) return
  return n
}

export type Session = { token: string; user: string; name: string }

export function session(data: unknown, user: string): Session | undefined {
  if (!data || typeof data !== "object" || !("access_token" in data)) return
  const token = data.access_token
  if (typeof token !== "string" || !token) return
  const id = "userId" in data ? data.userId : ""
  const uid = typeof id === "number" || typeof id === "string" ? String(id) : ""
  const first = "firstName" in data && typeof data.firstName === "string" ? data.firstName : ""
  const last = "lastName" in data && typeof data.lastName === "string" ? data.lastName : ""
  const name = [first, last].filter(Boolean).join(" ") || user
  return { token, user: uid, name }
}

type Field = { ID?: unknown; Value?: unknown; ValueHTML?: unknown }

export function detail(data: unknown) {
  const values = fields(data)
  if (!values) return
  const title = text(values, 1101)
  const html = htmlOf(rich(values, 1102) || text(values, 1102))
  return { title, html }
}

/** Signs in at `base`, or at its server root when `base` has a path the API isn't under (e.g. the web page's `/p1`). */
export async function login(base: string, user: string, pass: string, http: Http = client()) {
  const root = new URL(base).origin
  const first = await token(base, user, pass, http)
  if (first.status !== 404 || root === base) return done(first, base, user)
  return done(await token(root, user, pass, http), root, user)
}

async function done(res: Response, server: string, user: string) {
  const data = await res.json().catch(() => undefined)
  const found = session(data, user)
  if (!res.ok || !found) throw new HttpError(res.status, reason(data, `Login failed (HTTP ${res.status})`))
  return { ...found, server }
}

function token(base: string, user: string, pass: string, http: Http) {
  return http(`${base}/DevTrackApi/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      TimeZoneOffset: String(new Date().getTimezoneOffset()),
    },
    body: JSON.stringify({
      Grant_type: "password",
      UserName: user,
      Password: pass,
      LDAPServerId: null,
      IsInSessionAuth: 0,
    }),
  }).catch((err: unknown) => {
    throw new Error(err instanceof Error ? err.message : "Load failed")
  })
}

export type Project = { id: number; base: number; name: string; group?: string }
/** A requirement folder; `count` is how many subfolders P1 says it has, loaded when it opens. */
export type Folder = {
  id: number
  name: string
  count: number
  // P1's folder type (0 regular, 36 release, 30 roadmap month…) and whether the folder is closed, for its icon.
  type: number
  closed: boolean
  // The roadmap months a folder spans ("202610"), for grouping by weekly committed work.
  months?: { start: string; end: string }
}
/** Where a P1 project keeps its requirements: a requirement project and the folder its tree starts at. */
export type Space = {
  project: number
  folder: number
  name: string
  /** The linked development project and space, where spec points' modules live. */
  dev?: { project: number; space: number }
}
export type Row = {
  id: number
  title: string
  status: string
  owner: string
  type: string
  points: string
  /** Every field the list asked for, by field id, as P1 sent it. */
  cells: Record<number, string>
  /** Points already given to tasks, shown in brackets after the spec's points. */
  tasks: number
  attachments: number
  /** P1's spec kind (SystemTypeID: 0 epic, 1 spec, 2 epic document, 3 other, 4 enhancement, 5 defect, 6 change). */
  kind: number
  closed: boolean
  shortcut: boolean
  /** Whether P1 draws its icon with a paperclip: it has files, a document of its own, or a LiveDoc Report. */
  attached: boolean
}

/** A group of the list as P1 groups it: its rows, how many requirements it holds and their totals (hours). */
export type Group = {
  key: string
  // The field grouped by, and the group's value as P1 names it.
  by: number
  name: string
  count: number
  ids: number[]
  points: number
  // What P1 adds up for its own groups: points done, task hours and % finish.
  totals?: { done: number; spent: number; remain: number; finish: number }
}

/** P1's grouped list: each group's summary and the rows it sent along. */
export function readGroups(data: unknown) {
  const infos = nest(data, "GroupByInfos").filter(record)
  const rows: Row[] = []
  const groups = infos.map((info): Group => {
    const own = readRows(info)
    rows.push(...own.filter((row) => !rows.some((item) => item.id === row.id)))
    const all = String(info.AllSpecIDs ?? "")
      .split(",")
      .filter(Boolean)
    return {
      key: `${info.GroupByID}-${info.GroupByValueID}`,
      by: Number(info.GroupByID) || 0,
      name: String(info.GroupByValue ?? ""),
      count: all.length || own.length,
      // Its rows: the ones P1 sent along, or every requirement it holds when P1 leaves the rows to be asked for.
      ids: own.length ? own.map((row) => row.id) : all.map(Number).filter(Boolean),
      points: Number(info.SpecTotalPoints) || 0,
      totals: {
        done: Number(info.SpecFinishPoints) || 0,
        spent: (Number(info.TaskTotalTimeSpent) || 0) / 60,
        remain: (Number(info.TaskTotalTimeRemain) || 0) / 60,
        finish: Number(info.SpecPercentage) || 0,
      },
    }
  })
  return { groups, rows }
}

/** Groups rows by one of their fields, for groupings P1 lists but does not group itself (such as Created by). */
export function bunch(rows: Row[], by: number): Group[] {
  const names = [...new Set(rows.map((row) => row.cells[by] ?? ""))]
  return names.map((name) => {
    const own = rows.filter((row) => (row.cells[by] ?? "") === name)
    return {
      key: `${by}-${name}`,
      by,
      name,
      count: own.length,
      ids: own.map((row) => row.id),
      points: own.reduce((sum, row) => sum + (parseFloat(row.points) || 0), 0),
    }
  })
}

export function readProjects(data: unknown): Project[] {
  return spacesOf(rowsOf(data, "P1Projects"))
}

/** The project list in P1's hierarchy order (its groups, then projects outside any group), as the web header shows it. */
export function readHierarchy(data: unknown): Project[] {
  const body = bag(data)
  if (!body || Array.isArray(body)) return []
  const walk = (nodes: unknown): Record<string, unknown>[] =>
    (Array.isArray(nodes) ? nodes : [])
      .filter(record)
      .flatMap((node) => [
        ...(Array.isArray(node.P1Projects) ? node.P1Projects.filter(record) : []),
        ...walk(node.ChildNodes),
      ])
  return spacesOf([...walk(body.Nodes), ...(Array.isArray(body.P1Projects) ? body.P1Projects.filter(record) : [])])
}

function spacesOf(list: Record<string, unknown>[]): Project[] {
  const seen = new Set<number>()
  return list.flatMap((row) => {
    const id = cellNum(row, ["SpaceId", "ProjectId"])
    const name = cellText(row, ["SpaceName", "ProjectName", "Name"])
    const base = cellNum(row, ["ProjectId"]) || id
    if (!id || !name || seen.has(id)) return []
    seen.add(id)
    return [{ id, base, name }]
  })
}

/** The folders listed under `FolderNodes`, one level. */
export function readFolders(data: unknown): Folder[] {
  return nest(data, "FolderNodes").flatMap((node) => {
    if (!record(node)) return []
    const id = cellNum(node, ["FolderID"])
    const name = cellText(node, ["FolderName"])
    if (!id || !name) return []
    const start = cellText(node, ["RoadMapMonthStart"])
    const end = cellText(node, ["RoadMapMonthEnd"])
    return [
      {
        id,
        name,
        count: cellNum(node, ["ChildNumber"]),
        type: cellNum(node, ["TypeID"]),
        closed: cellText(node, ["FolderStatus"]) === "Close" || cellNum(node, ["FolderStatusID"]) === 2,
        ...(start && end ? { months: { start, end } } : {}),
      },
    ]
  })
}

/** The folder a project's tree starts at, found anywhere in the tree; the top level when it isn't there. */
export function readRoot(data: unknown, id: number): Folder[] {
  const node = findNode(nest(data, "FolderNodes"), id)
  return node ? readFolders({ FolderNodes: [node] }) : readFolders(data)
}

/** `initProject`'s requirement space for a project: the requirement project and its root folder. */
export function readSpace(data: unknown): Space | undefined {
  const body = bag(data)
  if (!body || Array.isArray(body) || !record(body.P1ProjectDataValue)) return
  const req = body.P1ProjectDataValue.Requirement
  if (!record(req) || req.Enabled === false || !record(req.PrimarySpace)) return
  const project = cellNum(req.PrimarySpace, ["projectId"])
  if (!project) return
  const dev = record(body.P1ProjectDataValue.Development) ? body.P1ProjectDataValue.Development.PrimarySpace : undefined
  return {
    project,
    folder: cellNum(req.PrimarySpace, ["spaceId"]) || 1,
    name: cellText(req.PrimarySpace, ["spaceName", "ProjectBaseName"]),
    ...(record(dev) && cellNum(dev, ["projectId"])
      ? { dev: { project: cellNum(dev, ["projectId"]), space: cellNum(dev, ["spaceId"]) } }
      : {}),
  }
}

export function readRows(data: unknown): Row[] {
  const out: Row[] = []
  walkRows(rowsOf(data, "ListItems"), out)
  return out
}

export function readBases(data: unknown): Project[] {
  return nest(data, "Data").flatMap((row) => {
    if (!record(row) || !record(row.ProjectBase)) return []
    const id = cellNum(row.ProjectBase, ["ProjectID"])
    const name = cellText(row.ProjectBase, ["ProjectName"])
    const active = row.ProjectBase.IsActive
    // Type 32 is a common requirement base, which P1's header leaves out.
    if (!id || !name || active === false || active === 0 || row.ProjectBase.ProjectType === 32) return []
    return [{ id, base: id, name }]
  })
}

/** Spaces under each project base, the list the P1 home shows after you pick a base. */
export function collect(bases: Project[], spaces: Project[][]) {
  const list = bases.flatMap((base, index) => {
    const rows = spaces[index] ?? []
    if (!rows.length) return [{ ...base, group: base.name }]
    return rows.map((space) => ({ ...space, group: base.name, base: space.base || base.id }))
  })
  return list
}

export async function projects(base: string, token: string, locale: string, http: Http = client()) {
  const families = await get(base, token, "/DevTrackApi/api/projectone/P1ProjectBaseFamilies", locale, http).catch(
    () => undefined,
  )
  const bases = families ? readBases(families) : []
  const body = (id: number) => ({ ProjectBaseId: id, IsClosed: null, IsArchived: 0, ProjectCategory: 0 })
  if (!bases.length) {
    const data = await post(base, token, "/DevTrackApi/api/projectone/P1Projects", locale, http, body(0))
    return readProjects(data).toSorted((a, b) => a.name.localeCompare(b.name))
  }
  const spaces = await Promise.all(
    bases.map((item) =>
      post(base, token, "/DevTrackApi/api/projectone/GroupedP1ProjectsByHierarchy", locale, http, body(item.id))
        .then(readHierarchy)
        .catch(() => [] as Project[]),
    ),
  )
  return collect(bases, spaces)
}

/** Asks P1 which requirement project and folder a project uses, the way the web app does when you switch to it. */
export async function space(base: string, token: string, project: Project, locale: string, http: Http = client()) {
  const data = await post(base, token, "/DevTrackApi/api/projectone/initProject", locale, http, {
    ProjectId: project.base,
    SpaceId: project.id,
    SystemSettingIds: [],
    ProjectSettingIds: [],
    UserSettingIds: [],
    KWFieldIds: [],
  })
  return readSpace(data)
}

/** P1's per-user preference that holds the pinned spaces of a project base family, as the web header uses. */
const PIN = 3000210

export type Pins = { ids: number[]; value: unknown; text: unknown }

export function readPins(data: unknown): Pins {
  const row = nest(data, "Data")[0]
  if (!record(row)) return { ids: [], value: 0, text: 1 }
  const memo = typeof row.PreferenceMemo === "string" ? row.PreferenceMemo : ""
  const list: unknown = memo.trim().startsWith("[") ? JSON.parse(memo) : []
  const ids = Array.isArray(list) ? list.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0) : []
  return { ids, value: row.PreferenceValue ?? 0, text: row.PreferenceText ?? 1 }
}

export async function pins(
  base: string,
  token: string,
  user: string,
  family: number,
  locale: string,
  http: Http = client(),
) {
  const data = await post(base, token, "/DevTrackApi/api/UserPreference/Preferences", locale, http, {
    userId: Number(user) || user,
    ProjectId: family,
    PrefIds: [PIN],
  })
  return readPins(data)
}

/** Saves the whole pinned list, keeping the web header's other two settings as they were. */
export async function pin(
  base: string,
  token: string,
  user: string,
  family: number,
  next: Pins,
  locale: string,
  http: Http = client(),
) {
  await post(base, token, "/DevTrackApi/api/UserPreference/Save", locale, http, {
    UserId: Number(user) || user,
    ProjectId: family,
    PrefId: PIN,
    PreferenceMemo: JSON.stringify(next.ids),
    PreferenceValue: next.value,
    PreferenceText: next.text,
  })
}

/** P1's per-user memory of a requirement tree: the selected folder first, then the open folders. */
const TREE = 50013

export type Memory = { folder: number; open: number[] }

export function readMemory(data: unknown): Memory {
  const row = nest(data, "Data")[0]
  const text = record(row) && typeof row.PreferenceText === "string" ? row.PreferenceText : ""
  const ids = text
    .split(",")
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0)
  return { folder: ids[0] ?? 0, open: [...new Set(ids.slice(1))] }
}

export async function memory(
  base: string,
  token: string,
  user: string,
  found: Space,
  locale: string,
  http: Http = client(),
) {
  const data = await post(base, token, "/DevTrackApi/api/P1UserPreference/preferences", locale, http, {
    ProjectId: found.project,
    SubProjectId: found.folder,
    PrefIds: [TREE],
    UserId: Number(user) || user,
  })
  return readMemory(data)
}

/** Saves the tree the way the web tree does, so P1 and SiCode open it the same. */
export async function remember(
  base: string,
  token: string,
  user: string,
  found: Space,
  next: Memory,
  locale: string,
  http: Http = client(),
) {
  await post(base, token, "/DevTrackApi/api/P1UserPreference/save", locale, http, [
    {
      ProjectId: found.project,
      SubProjectId: found.folder,
      PrefId: TREE,
      PreferenceText: [next.folder, ...next.open].join(","),
      UserId: Number(user) || user,
    },
  ])
}

/** The folder a project's tree starts at, with its subfolder count. */
export async function root(
  base: string,
  token: string,
  found: Space,
  locale: string,
  closed = true,
  http: Http = client(),
) {
  const url = new URL(`${base}/DevSpecAPI/ReqFolderTree`)
  url.searchParams.set("languageid", String(lang(locale)))
  url.searchParams.set("ProjectID", String(found.project))
  url.searchParams.set("ShowCloseFolder", closed ? "1" : "0")
  url.searchParams.set("SettingID", "50013")
  url.searchParams.set("SpaceIds", String(found.folder))
  const data = await send(url.toString(), token, undefined, http)
  return readRoot(data, found.folder)
}

/** One level of subfolders, which P1 loads when a folder opens. */
export async function children(
  base: string,
  token: string,
  project: number,
  folder: number,
  locale: string,
  closed = true,
  http: Http = client(),
) {
  const data = await post(base, token, "/DevSpecAPI/ReqFolderChild", locale, http, {
    ProjectID: project,
    FolderID: folder,
    ShowAll: closed ? 1 : 0,
    KeyWord: "",
  })
  return readFolders(data)
}

export async function requirements(
  base: string,
  token: string,
  project: number,
  folder: number,
  query: string,
  locale: string,
  columns: number[] = [],
  filter: Filter = blank,
  // Whether the list takes in subfolders' requirements and closed folders, as P1's preference settings say.
  scope = { all: true, closed: true },
  http: Http = client(),
) {
  const body = (fields: (string | number)[], grouped = true) => ({
    ProjectID: project,
    FolderID: folder,
    ShowAll: scope.all ? 1 : 0,
    ShowCloseFolder: scope.closed ? 1 : 0,
    PageIndex: 1,
    PageSize: 200,
    Fields: fields,
    KeyWord: query,
    SupportFieldID: 1,
    SortFields: [1112],
    SortOrder: [1],
    ...condition(grouped ? filter : { ...filter, group: 0 }),
  })
  // The list's own fields by id, as P1 asks for them, plus the columns you chose.
  const basic = [...new Set([1112, 1101, 1102, 1113, 1114, 1121, 1131, ...columns])]
  // A server that refuses some column still lists the basic ones.
  const data = await post(base, token, "/DevSpecAPI/ReqItemList", locale, http, body(basic)).catch((err: unknown) => {
    if (denied(err)) throw err
    return post(
      base,
      token,
      "/DevSpecAPI/ReqItemList",
      locale,
      http,
      body(["ProjectID", "ID", "Title", "Status", "Spec Owner"]),
    )
  })
  const total = record(data) ? cellNum(data, ["TotalCount"]) : 0
  const grouped = readGroups(data)
  // Some groupings have nothing to group by in a project; the list then comes ungrouped.
  // Some groupings P1 leaves to the page: the list then comes ungrouped, and rows with a field to group by
  // are grouped here.
  if (filter.group && !grouped.groups.length) {
    const flat = await post(
      base,
      token,
      "/DevSpecAPI/ReqItemList",
      locale,
      http,
      body(local.includes(filter.group) ? [...new Set([...basic, filter.group])] : basic, false),
    )
    const rows = readRows(flat)
    const total = Math.max(record(flat) ? cellNum(flat, ["TotalCount"]) : 0, rows.length)
    return { rows, total, groups: local.includes(filter.group) ? bunch(rows, filter.group) : [] }
  }
  // Some groupings (module owner) send each group's requirement ids but not its rows; those are asked for by id.
  const ids = [...new Set(grouped.groups.flatMap((group) => group.ids))]
  const rows =
    filter.group && !grouped.rows.length && ids.length
      ? readRows(
          await post(base, token, "/DevSpecAPI/ReqItemList", locale, http, {
            ...body(basic, false),
            PageSize: 0,
            ItemIDs: ids.slice(0, 500),
          }),
        )
      : filter.group
        ? grouped.rows
        : readRows(data)
  return { rows, total: Math.max(total, rows.length), groups: grouped.groups }
}

/** Who a requirement can be owned or submitted by in a folder, for the list's filter. */
export async function owners(
  base: string,
  token: string,
  project: number,
  folder: number,
  locale: string,
  http: Http = client(),
) {
  return readOwners(
    await get(
      base,
      token,
      `/DevSpecAPI/ReqOwnerList?ProjectID=${project}&SpecialID=1&IncludeGroupFolder=1&IncludeGroup=1&FilterGroup=1&SubProjectID=${folder}`,
      locale,
      http,
    ),
  )
}

/** The states a requirement can be in, open and closed, for the list's filter. */
export async function states(base: string, token: string, project: number, locale: string, http: Http = client()) {
  return readStates(await get(base, token, `/DevSpecAPI/ReqStatusList?ProjectID=${project}&SpecialID=0`, locale, http))
}

/** The fields a list can be grouped by on the page when P1 does not group by them: Created by and the owner. */
const local = [1110, 1113]

export async function item(
  base: string,
  token: string,
  project: number,
  id: number,
  locale: string,
  http: Http = client(),
) {
  const url = new URL(`${base}/DevSpecAPI/ReqItemEx`)
  url.searchParams.set("languageid", String(lang(locale)))
  const res = await http(url.toString(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      UserToken: token,
    },
    body: JSON.stringify({ ProjectID: project, IssueID: id, FieldIDs: [1101, 1102], SupportFieldID: 1 }),
  }).catch((err: unknown) => {
    throw new Error(err instanceof Error ? err.message : "Load failed")
  })
  const data = await res.json().catch(() => undefined)
  const found = detail(data)
  if (!res.ok || !found) throw new HttpError(res.status, reason(data, `Requirement failed (HTTP ${res.status})`))
  return found
}

function fields(data: unknown): Field[] | undefined {
  const list = values(data) ?? values(data && typeof data === "object" && "Data" in data ? data.Data : undefined)
  if (!list) return
  return list.filter((row): row is Field => !!row && typeof row === "object")
}

function values(data: unknown) {
  if (!data || typeof data !== "object" || !("Values" in data)) return
  return Array.isArray(data.Values) ? data.Values : undefined
}

function text(rows: Field[], id: number) {
  const row = rows.find((item) => item.ID === id)
  return typeof row?.Value === "string" ? row.Value : ""
}

function rich(rows: Field[], id: number) {
  const row = rows.find((item) => item.ID === id)
  return typeof row?.ValueHTML === "string" ? row.ValueHTML : ""
}

async function get(base: string, token: string, path: string, locale: string, http: Http) {
  const url = new URL(`${base}${path}`)
  url.searchParams.set("languageid", String(lang(locale)))
  return send(url.toString(), token, undefined, http)
}

async function post(base: string, token: string, path: string, locale: string, http: Http, body: unknown) {
  const url = new URL(`${base}${path}`)
  url.searchParams.set("languageid", String(lang(locale)))
  return send(url.toString(), token, body, http)
}

/** One P1 request: `path` is under the server, the app language is added, and the response is JSON (or text). */
export async function call(
  base: string,
  token: string,
  path: string,
  locale: string,
  body?: unknown,
  method?: string,
  http: Http = client(),
) {
  const url = new URL(`${base}${path}`)
  url.searchParams.set("languageid", String(lang(locale)))
  return send(url.toString(), token, body, http, method)
}

async function send(url: string, token: string, body: unknown, http: Http, method?: string) {
  const res = await http(url, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      UserToken: token,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch((err: unknown) => {
    throw new Error(err instanceof Error ? err.message : "Load failed")
  })
  const text = await res.text().catch(() => "")
  const data = parse(text)
  // P1 answers some failures with 203 and the message as the body.
  if (!res.ok || res.status === 203)
    throw new HttpError(
      res.status,
      reason(data, typeof data === "string" && data ? data : `Request failed (HTTP ${res.status})`),
    )
  return data
}

function parse(text: string): unknown {
  if (!text) return undefined
  if (!/^[[{"]/.test(text.trim())) return text
  return JSON.parse(text)
}

function rowsOf(data: unknown, key: string) {
  const body = bag(data)
  if (Array.isArray(body)) return body.filter(record)
  if (body && key in body && Array.isArray(body[key])) return body[key].filter(record)
  return []
}

function nest(data: unknown, key: string): unknown[] {
  const body = bag(data)
  if (Array.isArray(body)) return body
  if (body && key in body && Array.isArray(body[key])) return body[key]
  return []
}

function bag(data: unknown): Record<string, unknown> | unknown[] | undefined {
  if (!data || typeof data !== "object") return
  if ("Data" in data && data.Data && typeof data.Data === "object")
    return data.Data as Record<string, unknown> | unknown[]
  return data as Record<string, unknown>
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object"
}

function cellText(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === "string" && value.trim()) return value.trim()
    if (typeof value === "number") return String(value)
    if (record(value)) {
      const name: string = cellText(value, ["Name", "ChoiceName", "Value"])
      if (name) return name
    }
  }
  return ""
}

function cellNum(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value
    if (typeof value === "string" && /^[1-9]\d*$/.test(value)) return Number(value)
  }
  return 0
}

function findNode(nodes: unknown[], id: number): unknown | undefined {
  for (const node of nodes) {
    if (!record(node)) continue
    if (cellNum(node, ["FolderID"]) === id) return node
    const kids = nest(node, "FolderNodes")
    const found = findNode(kids, id)
    if (found) return found
  }
}

function walkRows(list: Record<string, unknown>[], out: Row[]) {
  for (const row of list) {
    const id = cellNum(row, ["1112", "ID", "ItemID"])
    if (id) {
      out.push({
        id,
        title: cellText(row, ["1101", "Title"]) || `#${id}`,
        status: cellText(row, ["1114", "Status"]),
        owner: cellText(row, ["1113", "Spec Owner"]),
        type: cellText(row, ["1121", "Spec Type"]),
        points: cellText(row, ["1131", "Points"]),
        // The description is asked for only to see whether it holds a LiveDoc Report; it isn't kept.
        cells: Object.fromEntries(
          Object.entries(row)
            .filter(([key]) => /^\d+$/.test(key) && key !== "1102")
            .map(([key]) => [Number(key), cellText(row, [key])]),
        ),
        tasks: Number(row.TotalTaskPoints) || 0,
        attachments: Number(row.AttachmentCount) || 0,
        kind: row.SystemTypeID === undefined || row.SystemTypeID === "" ? 1 : Number(row.SystemTypeID),
        closed: !!row.IsClosed,
        shortcut: !!(row.IsShortcutItem || row.IsShortcut),
        attached:
          Number(row.AttachmentCount) > 0 || Number(row.FileID) > 0 || reported(cellText(row, ["1102"])),
      })
    }
    if ("children" in row && Array.isArray(row.children)) walkRows(row.children.filter(record), out)
  }
}

/** Whether a description holds a LiveDoc Report, as P1 tells from the list: its text, or its text in Base64. */
function reported(desc: string) {
  const mark = /Live\sImage\sID:\s\d+/
  return mark.test(desc) || mark.test(decode64(desc) ?? "")
}

function reason(data: unknown, fallback: string) {
  if (!data || typeof data !== "object") return fallback
  const row = Object.fromEntries(Object.entries(data))
  for (const key of ["error_description", "message", "Message", "error"]) {
    const value = row[key]
    if (typeof value === "string" && value) return value
  }
  return fallback
}
