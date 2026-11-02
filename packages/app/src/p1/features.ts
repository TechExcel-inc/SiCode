import { call } from "./api"
import { client } from "./http"
import { kloud, lasting, type Kloud } from "./kloud"

/**
 * P1's product feature map, kept on Kloud's meeting server: each product holds modules, and modules hold feature
 * folders. A spec links to features by its external id, "project-spec".
 */
export type Feature = { id: number; title: string; children: Feature[] }

/** The feature tree as Kloud sends it, every node with its title and children. */
export function readTree(data: unknown): Feature[] {
  const list = Array.isArray(data) ? data : record(data) && Array.isArray(data.data) ? data.data : []
  return list.filter(record).flatMap((item) => {
    const id = Number(item.id)
    if (!id) return []
    return [{ id, title: text(item.title ?? item.name), children: readTree(item.children ?? []) }]
  })
}

/** The project's own products out of the tree, as P1 keeps only the products the project is set to. */
export function own(tree: Feature[], products: number[]) {
  return tree.filter((item) => products.includes(item.id))
}

/** The spec ids out of Kloud's external ids ("project-spec"). */
export function specs(list: unknown) {
  const ids = (Array.isArray(list) ? list : []).map((item) => Number(String(item).split("-")[1]) || 0)
  return [...new Set(ids.filter((id) => id > 0))]
}

/** The ids P1 gives for every requirement in a folder (GetAllIDs), sent as one comma list. */
export function every(data: unknown) {
  const body = record(data) && "Data" in data ? data.Data : data
  if (typeof body !== "string") return []
  return body
    .split(",")
    .map(Number)
    .filter((id) => id > 0)
}

type Map = { found: Kloud; p1: string; user: string }

/** Kloud's link for this P1 server, with what its meeting server calls need; undefined when there is none. */
export async function reach(base: string, token: string, user: string, locale: string): Promise<Map | undefined> {
  const found = await kloud(base, token, locale)
  if (!found?.meet) return
  return { found, p1: token, user }
}

// A meeting server call, signed with the lasting Kloud token; a refused token is swapped for a fresh one once.
async function meet(map: Map, path: string, body?: unknown, fresh = false): Promise<unknown> {
  const token = await lasting(map.found, map.p1, map.user, fresh)
  const res = await client()(`${map.found.meet}MeetingServer/product_feature_map/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", UserToken: token },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = (await res.json().catch(() => undefined)) as unknown
  const code = record(data) ? Number(data.code ?? 0) : 0
  if ((res.status === 401 || code === 401) && !fresh) return meet(map, path, body, true)
  if (!res.ok || code) throw new Error(record(data) ? text(data.msg ?? data.message) || res.statusText : res.statusText)
  return record(data) ? data.data : data
}

/** Every feature folder of the products, as P1's All Folders shows them. */
export async function whole(map: Map, products: number[]) {
  return own(readTree(await meet(map, `folder_tree?folderIds=${products.join(",")}&level=0`)), products)
}

/** The feature folders the folder's specs link to, as P1's Relevant Folders shows them. */
export async function relevant(
  map: Map,
  base: string,
  locale: string,
  place: { project: number; space: number; folder: number },
  products: number[],
) {
  const data = await call(base, map.p1, "/DevSpecAPI/ReqItemList", locale, {
    ProjectID: place.project,
    SpaceID: place.space,
    FolderID: place.folder,
    ShowAll: 1,
    PageIndex: 1,
    PageSize: 2,
    Fields: [1112],
    SortFields: [1112],
    SortOrder: [1],
    KeyWord: "",
    SupportFieldID: 1,
    ShowCloseFolder: 0,
    Condition: {},
    ModuleOwnerIDs: [],
    QueryID: 0,
    GroupByID: 0,
    GetAllIDs: 1,
  })
  // Kloud takes up to 2000 specs at a time, as P1 sends them.
  const ids = every(data).slice(0, 2000)
  const tree = await meet(map, "get_folder_tree_by_spec", {
    companyId: map.found.company,
    externalIdList: ids.map((id) => `${place.project}-${id}`),
  })
  return own(readTree(tree), products)
}

/** The specs linked to a feature folder and the folders under it. */
export async function linked(map: Map, folder: number) {
  return specs(await meet(map, `get_spec_by_folder?folderId=${folder}&includeChildFolder=1`))
}

const text = (value: unknown) => (value === undefined || value === null ? "" : String(value))

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
