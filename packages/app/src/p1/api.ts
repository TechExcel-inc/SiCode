import { client } from "./http"
import { htmlOf } from "./doc"

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
export type Folder = { id: number; name: string; depth: number }
export type Row = { id: number; title: string; status: string; owner: string }

export function readProjects(data: unknown): Project[] {
  const seen = new Set<number>()
  return rowsOf(data, "P1Projects").flatMap((row) => {
    const id = cellNum(row, ["SpaceId", "ProjectId"])
    const name = cellText(row, ["SpaceName", "ProjectName", "Name"])
    const base = cellNum(row, ["ProjectId"]) || id
    if (!id || !name || seen.has(id)) return []
    seen.add(id)
    return [{ id, base, name }]
  })
}

/** Folders under the selected space. A matching space node keeps its own subtree. */
export function readFolders(data: unknown, space = 0): Folder[] {
  const nodes = nest(data, "FolderNodes")
  const root = space ? findNode(nodes, space) : undefined
  const out: Folder[] = []
  walkNodes(root ? [root] : nodes, 0, out)
  return out
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
    if (!id || !name || active === false || active === 0) return []
    return [{ id, base: id, name }]
  })
}

/** Spaces under each project base, the list the P1 home shows after you pick a base. */
export function collect(bases: Project[], spaces: Project[][]) {
  const list = bases.flatMap((base, index) => {
    const rows = spaces[index] ?? []
    if (!rows.length) return [base]
    return rows.map((space) => ({ ...space, group: base.name, base: space.base || base.id }))
  })
  return list.toSorted((a, b) => (a.group ?? "").localeCompare(b.group ?? "") || a.name.localeCompare(b.name))
}

export async function projects(base: string, token: string, locale: string, http: Http = client()) {
  const families = await get(base, token, "/DevTrackApi/api/projectone/P1ProjectBaseFamilies", locale, http).catch(
    () => undefined,
  )
  const bases = families ? readBases(families) : []
  if (!bases.length) {
    const data = await post(base, token, "/DevTrackApi/api/projectone/P1Projects", locale, http, {
      ProjectBaseId: 0,
      IsClosed: null,
      IsArchived: 0,
    })
    return readProjects(data).toSorted((a, b) => a.name.localeCompare(b.name))
  }
  const spaces = await Promise.all(
    bases.map((item) =>
      post(base, token, "/DevTrackApi/api/projectone/P1Projects", locale, http, {
        IncludeClosed: false,
        ProjectBaseId: item.id,
        ProjectCategory: 0,
      })
        .then(readProjects)
        .catch(() => [] as Project[]),
    ),
  )
  return collect(bases, spaces)
}

export async function folders(base: string, token: string, project: number, space: number, locale: string, http: Http = client()) {
  const url = new URL(`${base}/DevSpecAPI/ReqFolderTree`)
  url.searchParams.set("languageid", String(lang(locale)))
  url.searchParams.set("ProjectID", String(project))
  url.searchParams.set("ShowCloseFolder", "0")
  url.searchParams.set("SettingID", "50013")
  const data = await send(url.toString(), token, undefined, http)
  return readFolders(data, space)
}

export async function requirements(
  base: string,
  token: string,
  project: number,
  folder: number,
  query: string,
  locale: string,
  http: Http = client(),
) {
  const data = await post(base, token, "/DevSpecAPI/ReqItemList", locale, http, {
    ProjectID: project,
    FolderID: folder,
    ShowAll: 1,
    PageIndex: 1,
    PageSize: 200,
    Fields: ["ProjectID", "ID", "Title", "Status", "Spec Owner"],
    KeyWord: query,
    SupportFieldID: 1,
    SortFields: [1112],
    SortOrder: [1],
  })
  return readRows(data)
}

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

async function send(url: string, token: string, body: unknown, http: Http) {
  const res = await http(url, {
    method: body === undefined ? "GET" : "POST",
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
  const data = await res.json().catch(() => undefined)
  if (!res.ok) throw new HttpError(res.status, reason(data, `Request failed (HTTP ${res.status})`))
  return data
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
  if ("Data" in data && data.Data && typeof data.Data === "object") return data.Data as Record<string, unknown> | unknown[]
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

function walkNodes(nodes: unknown[], depth: number, out: Folder[]) {
  for (const node of nodes) {
    if (!record(node)) continue
    const id = cellNum(node, ["FolderID"])
    const name = cellText(node, ["FolderName"])
    if (id && name) out.push({ id, name, depth })
    walkNodes(nest(node, "FolderNodes"), id && name ? depth + 1 : depth, out)
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
      })
    }
    if ("children" in row && Array.isArray(row.children)) walkRows(row.children.filter(record), out)
  }
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
