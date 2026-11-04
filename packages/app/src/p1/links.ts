import { call, readFolders, requirements, type Space } from "./api"
import { specIcon } from "./files"

/**
 * What the All Links pickers show, as P1's Link Requirement, Link Test Case and Link Knowledge dialogs load it:
 * a folder tree on the left, opened a level at a time, and a page of items in the chosen folder and its subfolders.
 */

export type Kind = "spec" | "test" | "knowledge"
export type Node = { id: number; name: string; more: boolean; type: number; closed: boolean; top: number }
export type Item = { id: number; project: number; title: string; state: string; owner: string; icon: string }
export type Page = { items: Item[]; total: number }

export const size = 100

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)
const text = (value: unknown) =>
  value === undefined || value === null
    ? ""
    : record(value)
      ? String(value.DisplayValue ?? value.Value ?? value.Name ?? "")
      : String(value)
const unwrap = (data: unknown) => (record(data) && "Data" in data && data.Data !== undefined ? data.Data : data)
const list = (data: unknown, key?: string) => {
  const found = key && record(data) ? data[key] : data
  return (Array.isArray(found) ? found : []).filter(record)
}

/** The project and folder each picker starts at: the project's requirement, test library or knowledge space. */
export function home(space: Space | undefined, kind: Kind) {
  if (!space) return
  if (kind === "spec") return { project: space.project, space: space.folder, name: space.name }
  return kind === "test" ? space.test : space.knowledge
}

/**
 * P1's test library tree. The structure lists the space's folders as its first level, each with the subfolders
 * already open under `child`; when the space is the whole library the response is that root itself. A node never
 * lists itself: a first-level folder that is the space being opened gives its own children instead. Test cases are
 * searched with the first-level folder they sit under as their space, so each node remembers it.
 */
export function readTests(data: unknown, parent: number, top?: number): Node[] {
  const body = unwrap(data)
  const nodes = Array.isArray(body)
    ? body.filter(record)
    : list(body, "childTree").length
      ? list(body, "childTree")
      : list(body, "child")
  return nodes.flatMap((node): Node[] => {
    const id = Number(node.id)
    if (!Number.isFinite(id) || node.id === undefined || node.id === null) return []
    if (id === parent) return readTests({ child: node.child ?? node.childTree ?? [] }, parent, top ?? id)
    return [
      {
        id,
        name: text(node.name),
        more: !!node.hasChild || list(node, "child").length > 0,
        type: Number(node.subtype ?? node.type) || 0,
        closed: false,
        top: top ?? id,
      },
    ]
  })
}

/** The root of a picker's tree: the space itself. */
export function root(at: { space: number; name: string }): Node {
  return { id: at.space, name: at.name, more: true, type: 0, closed: false, top: at.space }
}

/** One level of subfolders under a node, with the folder search's keyword for requirement folders. */
export async function folders(
  base: string,
  token: string,
  kind: Kind,
  project: number,
  node: Node,
  root: boolean,
  query: string,
  locale: string,
): Promise<Node[]> {
  if (kind === "test") {
    const data = root
      ? await call(base, token, "/DevTestApi/api/TestTemplate/DynamicFolderStructureEx", locale, {
          projectId: project,
          FolderIds: [node.id],
          includeArchived: 0,
          ExpandedFolderId: node.id,
          Keyword: query,
          IsShowWholeTree: node.id ? 0 : 1,
        })
      : await call(base, token, "/DevTestApi/api/TestTemplate/DynamicSubTreeEx", locale, {
          includeArchived: 0,
          ExpandedFolderId: node.id,
          projectId: project,
        })
    return readTests(data, node.id, root ? undefined : node.top)
  }
  const data = await call(
    base,
    token,
    kind === "spec" ? "/DevSpecAPI/ReqFolderChild" : "/DevSpecAPI/KWFolderChild",
    locale,
    kind === "spec"
      ? { ProjectID: project, FolderID: node.id, KeyWord: query, ShowAll: 1 }
      : { ProjectID: project, FolderID: node.id, ShowAll: 1, ShowItem: 0 },
  )
  return readFolders(data).map((folder) => ({
    id: folder.id,
    name: folder.name,
    more: folder.count > 0,
    type: folder.type,
    closed: folder.closed,
    top: node.top,
  }))
}

/** Test cases from `TestTemplate/QueryEx`: id 1001, title 1101, state 1010 and owner 1008. */
export function readCases(data: unknown, project: number): Page {
  const body = unwrap(data)
  const items = list(body, "Values").flatMap((row) => {
    const id = Number(text(row[1001]))
    return id ? [{ id, project, title: text(row[1101]), state: text(row[1010]), owner: text(row[1008]), icon: "" }] : []
  })
  return { items, total: (record(body) ? Number(body.Count) : 0) || items.length }
}

/** Knowledge items from `KWItemList`, keyed by field id or by name. */
export function readKnowledge(data: unknown, project: number): Page {
  const body = unwrap(data)
  const items = list(body, "ListItems").flatMap((row) => {
    const id = Number(text(row[1112] ?? row.ID))
    return id
      ? [
          {
            id,
            project,
            title: text(row[1101] ?? row.Title),
            state: text(row[1114] ?? row.Status),
            owner: text(row[1113] ?? row["Spec Owner"] ?? row.Owner),
            icon: "",
          },
        ]
      : []
  })
  return { items, total: (record(body) ? Number(body.TotalCount) : 0) || items.length }
}

/** A page of items in a folder (and its subfolders) matching a keyword, 100 to a page as P1 shows them. */
export async function items(
  base: string,
  token: string,
  kind: Kind,
  project: number,
  node: Node,
  query: string,
  page: number,
  locale: string,
): Promise<Page> {
  if (kind === "spec") {
    const found = await requirements(
      base,
      token,
      project,
      node.id,
      query,
      locale,
      [],
      undefined,
      { all: true, closed: true },
      { index: page, size },
    )
    return {
      items: found.rows.map((row) => ({
        id: row.id,
        project,
        title: row.title,
        state: row.status,
        owner: row.owner,
        icon: specIcon(row),
      })),
      total: found.total,
    }
  }
  if (kind === "test")
    return readCases(
      await call(base, token, "/DevTestApi/api/TestTemplate/QueryEx", locale, {
        projectId: project,
        spaceId: node.top,
        folderPath: [String(node.id)],
        fieldIDs: [1001, 1101, 1010, 1008],
        showAll: true,
        includeArchived: false,
        pageSize: size,
        pageIndex: page - 1,
        getCount: true,
        Condition: { StateIDs: [], OwnerIDs: [], Fields: [], KeyWord: query },
      }),
      project,
    )
  return readKnowledge(
    await call(base, token, "/DevSpecAPI/KWItemList", locale, {
      ProjectID: project,
      FolderID: node.id,
      ShowAll: 1,
      PageIndex: page,
      PageSize: size,
      SupportFieldID: 1,
      Fields: [1112, 1101, 1113, 1114],
      KeyWord: query,
      Condition: {},
      SpaceId: node.top,
    }),
    project,
  )
}
