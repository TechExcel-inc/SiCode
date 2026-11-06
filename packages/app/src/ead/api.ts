import { STACK_LABELS } from "./stack-types"
import { eadHttp } from "./http"
import { applyTopLevel, VIRTUAL_MOVED, type Raw } from "./top-level"
import { eadApi } from "./urls"

export type Product = {
  productId: number
  name: string
  baseId?: number
  siblings?: boolean
}

export type Group = {
  id: string
  name: string
  products: Product[]
}

export type PfmNode = {
  nodeId: number
  name: string
  children: PfmNode[]
  isDynamicTopLevel?: boolean
  subSchemaId?: number | null
  workType?: string
  /** 1 common, 0 specific. Only meaningful under a Dynamic schema. */
  ifCommonStatus?: 0 | 1
  underDynamic?: boolean
  isHub?: boolean
  supportEadWorkflow?: boolean
}

export type ActiveContext = {
  nodeId: number
  nodeName: string
  eadScript: string
  aiPrompt: string
  markdown: string
}

type AuthResult = {
  success?: boolean
  token?: string
  message?: string
}

type TreeNode = {
  productId?: number | string
  id?: number | string
  familyId?: number | string
  name?: string
  productName?: string
  label?: string
  type?: string
  baseProductId?: number | string
  supportsSiblingProducts?: boolean | number | string
  children?: TreeNode[]
  products?: TreeNode[]
}

type MapPayload = {
  mapId?: number | string
  rootNode?: unknown
  dynamicTopLevelNodeId?: number | string | null
  dynamicTopLevelDisplayName?: string | null
  topLevelNodesJson?: string | null
  subSchemaTypeNames?: string[] | null
  subSchemaTypes?: Array<{ id?: number | string; name?: string }> | null
}

type ContextPayload = {
  pfmNode?: {
    id?: number
    title?: string
    nodeKey?: string
    note?: string
    workType?: string
    projectId?: number
  }
  product?: {
    productId?: number
    productName?: string
    projectId?: number
    projectName?: string
  }
  eadScript?: string
  aiPrompt?: string
  aiApi?: string
  linkedSkills?: Array<{
    skillId?: number
    title?: string
    description?: string
    skillType?: string
    version?: string
  }>
  sourceContext?: {
    schema?: Record<string, unknown> | null
    repositories?: Array<Record<string, unknown>>
    legacyRepositories?: Array<Record<string, unknown>>
    nodeSourceCodeFiles?: string
  }
  warnings?: string[]
  updatedAt?: string
  eadEntityId?: number
  eadEntityName?: string
}

type Http = typeof fetch

function headers(token: string) {
  const out: Record<string, string> = { Accept: "application/json" }
  if (token) out.Authorization = `Bearer ${token}`
  return out
}

async function readJson(res: Response) {
  const text = await res.text()
  if (!text.trim()) throw new Error(`Empty response (HTTP ${res.status})`)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`Non-JSON response (HTTP ${res.status}): ${text.slice(0, 160)}`)
  }
}

async function call(http: Http, path: string, token: string, init?: RequestInit) {
  const res = await http(`${eadApi()}${path}`, {
    ...init,
    headers: {
      ...headers(token),
      ...(init?.headers ?? {}),
    },
  }).catch((err) => {
    throw new Error(err instanceof Error ? err.message : "Load failed")
  })
  if (res.status === 401 || res.status === 403) throw new Error("AUTH_EXPIRED")
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return readJson(res)
}

function asProduct(node: TreeNode): Product | undefined {
  const id = Number(node.productId ?? 0)
  const name = String(node.name ?? node.productName ?? node.label ?? "").trim()
  if (!Number.isFinite(id) || id <= 0 || !name) return
  if (node.type && node.type !== "product") return
  const base = Number(node.baseProductId ?? 0)
  const flag = node.supportsSiblingProducts
  const product: Product = { productId: id, name }
  if (Number.isFinite(base) && base > 0) product.baseId = base
  if (flag === true || flag === 1 || flag === "1") product.siblings = true
  return product
}

function walk(nodes: TreeNode[], out: Product[]) {
  for (const node of nodes) {
    const product = asProduct(node)
    if (product) out.push(product)
    if (Array.isArray(node.children)) walk(node.children, out)
    if (Array.isArray(node.products)) walk(node.products, out)
  }
}

export function collectProducts(tree: TreeNode[]): Product[] {
  const out: Product[] = []
  walk(tree, out)
  const seen = new Set<number>()
  return out.filter((item) => {
    if (seen.has(item.productId)) return false
    seen.add(item.productId)
    return true
  })
}

export function collectGroups(tree: TreeNode[]): Group[] {
  const groups: Group[] = []
  for (const family of tree) {
    const kids = Array.isArray(family.children) ? family.children : []
    const products = kids.flatMap((child) => {
      const product = asProduct(child)
      return product ? [product] : []
    })
    if (!products.length) continue
    groups.push({
      id: String(family.id ?? family.familyId ?? `family-${groups.length}`),
      name: String(family.label || family.name || "Team"),
      products,
    })
  }
  return groups
}

export function productRole(product: Product) {
  if (product.baseId && product.baseId > 0) return "sibling" as const
  if (product.siblings) return "base" as const
  return "plain" as const
}

function asNode(raw: unknown, meta?: { dynId?: number; dynName?: string }, under = false): PfmNode | undefined {
  if (!raw || typeof raw !== "object") return
  const row = raw as Record<string, unknown>
  const id = Number(row.nodeId ?? row.id ?? 0)
  if (!Number.isFinite(id) || id === 0) return
  if (id < 0 && id !== VIRTUAL_MOVED) return
  const kids = Array.isArray(row.children) ? row.children : []
  const dyn = row.isDynamicTopLevel === true || row.isDynamicTopLevel === 1 || (!!meta?.dynId && meta.dynId === id)
  const sub = Number(row.subSchemaId)
  const wt = typeof row.workType === "string" ? row.workType : undefined
  const rawCommon = Number(row.ifCommonStatus)
  const common = rawCommon === 0 || rawCommon === 1 ? (rawCommon as 0 | 1) : undefined
  const support = row.supportEadWorkflow !== false && row.supportEadWorkflow !== 0
  const hub = kids.length > 0 && !support
  const childUnder = under || dyn || (Number.isFinite(sub) && sub > 0)
  const name =
    dyn && meta?.dynName
      ? meta.dynName
      : String(row.dynamicTopLevelDisplayName || row.name || row.nodeName || `Node ${id}`)
  return {
    nodeId: id,
    name,
    isDynamicTopLevel: dyn || undefined,
    subSchemaId: Number.isFinite(sub) && sub > 0 ? sub : null,
    workType: wt,
    ifCommonStatus: common,
    underDynamic: childUnder && !dyn ? true : undefined,
    isHub: hub ? true : undefined,
    supportEadWorkflow: support ? undefined : false,
    children: kids.flatMap((child) => {
      const next = asNode(child, meta, childUnder)
      return next ? [next] : []
    }),
  }
}

function repos(list: Array<Record<string, unknown>> | undefined) {
  if (!list?.length) return "_No repositories linked._"
  return list
    .map((row) => {
      const name = String(row.name ?? row.repoName ?? row.path ?? "repo")
      const url = String(row.url ?? row.gitUrl ?? "")
      return url ? `- ${name}: ${url}` : `- ${name}`
    })
    .join("\n")
}

export function formatContextMarkdown(ctx: ContextPayload, fallback: { nodeId: number; nodeName: string }) {
  const node = ctx.pfmNode ?? {}
  const product = ctx.product ?? {}
  const source = ctx.sourceContext ?? {}
  const schema = source.schema ?? {}
  const skills = Array.isArray(ctx.linkedSkills) ? ctx.linkedSkills : []
  const warnings = Array.isArray(ctx.warnings) ? ctx.warnings : []
  const title = node.title || fallback.nodeName || "Unknown"
  const id = node.id || fallback.nodeId

  return [
    "# Active EAD PFM Context",
    "",
    "_Auto-synced by EAD SiCode EAD Map when you select a PFM node._",
    "",
    "## Node",
    `- Product: ${product.productName || "Unknown"}${product.productId ? ` (${product.productId})` : ""}`,
    `- Project: ${product.projectName || "Unknown"}${product.projectId ? ` (${product.projectId})` : ""}`,
    `- PFM Node: ${title}${id ? ` (${id})` : ""}`,
    `- Node Key: ${node.nodeKey || "-"}`,
    `- Work Type: ${node.workType || "-"}`,
    ctx.updatedAt ? `- Updated At: ${ctx.updatedAt}` : "",
    "",
    "## EAD Workflow",
    `- Entity ID: ${ctx.eadEntityId ?? node.id ?? "-"}`,
    `- Title: ${ctx.eadEntityName || node.title || title}`,
    `- Workflow key: ${node.nodeKey || "-"}`,
    node.note?.trim()
      ? ["", "### Workflow spec", node.note.trim()].join("\n")
      : "_No EAD workflow spec documented yet._",
    "",
    "## Warnings",
    warnings.length ? warnings.map((w) => `- ${w}`).join("\n") : "- None",
    "",
    "## AI Prompt Info",
    ctx.aiPrompt?.trim() || "_No saved AI Prompt Info for this node._",
    "",
    "## EAD Script",
    ctx.eadScript?.trim()
      ? ["```text", ctx.eadScript.trim(), "```"].join("\n")
      : "_No saved EAD Script for this node._",
    "",
    "## AI API Context",
    ctx.aiApi?.trim() || "_No saved AI API context for this node._",
    "",
    "## Linked EAD Skills",
    skills.length
      ? skills
          .map((skill) =>
            [
              `### ${skill.title || `Skill ${skill.skillId || ""}`}`.trim(),
              `- Type: ${skill.skillType || "-"}`,
              `- Version: ${skill.version || "-"}`,
              "",
              skill.description || "_No skill description._",
            ].join("\n"),
          )
          .join("\n\n")
      : "_No linked EAD Skills for this node._",
    "",
    "## Linked Source Code",
    `- Schema: ${String(schema.name || "Not linked")}${schema.schemaId ? ` (${String(schema.schemaId)})` : ""}`,
    `- Work Type: ${String(schema.workType || "-")}`,
    `- Node Source Files: ${source.nodeSourceCodeFiles || "-"}`,
    "",
    "### Current Repositories",
    repos(source.repositories),
    "",
    "### Legacy Repositories",
    repos(source.legacyRepositories),
  ]
    .filter((line) => line !== "")
    .join("\n")
}

export function formatSystemPrompt(input: { name: string; eadScript?: string; aiPrompt?: string; markdown?: string }) {
  const name = input?.name?.trim()
  if (!name) return
  const script = input.eadScript?.trim()
  const prompt = input.aiPrompt?.trim()
  if (!script && !prompt && !input.markdown?.trim()) {
    return [`<pfm-node-context>`, `You are currently working on the PFM node: ${name}`, `</pfm-node-context>`].join(
      "\n",
    )
  }
  return [
    `<pfm-node-context>`,
    `You are currently working on the PFM node: ${name}`,
    prompt ? `<ai-prompt>${prompt}</ai-prompt>` : "",
    script ? `<ead-script>${script}</ead-script>` : "",
    input.markdown?.trim() ? `<ead-context-markdown>\n${input.markdown.trim()}\n</ead-context-markdown>` : "",
    `</pfm-node-context>`,
  ]
    .filter(Boolean)
    .join("\n")
}

export async function login(identifier: string, password: string, http: Http = eadHttp()) {
  const body = {
    loginMethod: "password",
    identifier: identifier.trim(),
    password: btoa(password),
  }
  const res = await http(`${eadApi()}/auth/login`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch((err) => {
    throw new Error(err instanceof Error ? err.message : "Load failed")
  })
  const data = (await readJson(res)) as AuthResult
  if (!res.ok || !data.success || !data.token) {
    throw new Error(data.message || `Login failed (HTTP ${res.status})`)
  }
  return data.token
}

/** Trades a login token (even one up to 30 days expired) for a fresh one. */
export async function renew(token: string, http: Http = eadHttp()) {
  const res = await http(`${eadApi()}/auth/session/renew`, { method: "POST", headers: headers(token) }).catch((err) => {
    throw new Error(err instanceof Error ? err.message : "Load failed")
  })
  const data = (await res.json().catch(() => undefined)) as AuthResult | undefined
  if (!res.ok || !data?.success || !data.token) {
    throw new Error(data?.message || `Renew failed (HTTP ${res.status})`)
  }
  return data.token
}

export async function loadCatalog(token: string, http: Http = eadHttp()) {
  const tree = (await call(http, `/products/tree`, token)) as TreeNode[]
  const rows = Array.isArray(tree) ? tree : []
  return { products: collectProducts(rows), groups: collectGroups(rows) }
}

export async function loadProducts(token: string, http: Http = eadHttp()) {
  return (await loadCatalog(token, http)).products
}

export type SubSchema = { id: number; name: string }

export async function loadSubSchemas(token: string, mapId: number, http: Http = eadHttp()) {
  const data = (await call(http, `/pfm-map-sub/maps/${mapId}`, token).catch(() => null)) as {
    subSchemas?: Array<{ id?: number | string; name?: string }>
  } | null
  if (!data) return [] as SubSchema[]
  return (data.subSchemas ?? []).flatMap((row) => {
    const id = Number(row.id)
    if (!Number.isFinite(id) || id <= 0) return []
    return [{ id, name: String(row.name || `Schema ${id}`) }]
  })
}

export async function loadActiveMap(token: string, productId: number, http: Http = eadHttp(), subSchemaId?: number) {
  const q = subSchemaId && subSchemaId > 0 ? `?subSchemaId=${subSchemaId}` : ""
  const map = (await call(http, `/pfm-maps/product/${productId}/active${q}`, token)) as MapPayload & {
    supportSubSchemas?: boolean | number
    baseMapId?: number | string
    mapName?: string
  }
  const mapId = Number(map.mapId ?? 0)
  const base = Number(map.baseMapId ?? 0)
  const dynId = Number(map.dynamicTopLevelNodeId ?? 0)
  const support = map.supportSubSchemas === true || map.supportSubSchemas === 1
  const schemas = support && Number.isFinite(mapId) && mapId > 0 ? await loadSubSchemas(token, mapId, http) : []
  const dynFromSchema = subSchemaId && subSchemaId > 0 ? schemas.find((s) => s.id === subSchemaId)?.name : undefined
  const dynName = String(map.dynamicTopLevelDisplayName || dynFromSchema || "").trim()
  const types = (Array.isArray(map.subSchemaTypes) ? map.subSchemaTypes : [])
    .map((row) => {
      const id = Number(row?.id)
      const name = String(row?.name || "").trim()
      if (!Number.isFinite(id) || id <= 0 || !name) return null
      return { id, name }
    })
    .filter((row): row is { id: number; name: string } => row != null)
  const enforced = applyTopLevel((map.rootNode ?? null) as Raw | null, {
    topLevelNodesJson: map.topLevelNodesJson,
    supportSubSchemas: map.supportSubSchemas,
    dynamicTopLevelNodeId: map.dynamicTopLevelNodeId,
    dynamicTopLevelDisplayName: dynName || null,
    dynamicSchemaTypeNames: map.subSchemaTypeNames ?? schemas.map((s) => s.name),
    subSchemaTypes: types.length ? types : schemas,
  })
  const root = asNode(enforced, {
    dynId: Number.isFinite(dynId) && dynId > 0 ? dynId : undefined,
    dynName: dynName || undefined,
  })
  const name = String(map.mapName || "").trim()
  return {
    mapId: Number.isFinite(mapId) && mapId > 0 ? mapId : 0,
    root,
    supportSubSchemas: support,
    baseMapId: Number.isFinite(base) && base > 0 ? base : 0,
    mapName: name,
    schemas,
  }
}

export type LinkedBundle = {
  nodes: Array<Record<string, unknown>>
  eadCountByNodeId: Record<string, number>
  pendingEadByNodePath: Record<string, boolean>
  openJobCountByNodeId: Record<string, number>
  openTestCaseCountByNodeId: Record<string, number>
  expandByDefaultPaths: string[]
  linkedFilePaths: string[]
}

export async function loadLinkedBundle(
  token: string,
  productId: number,
  schemaId: number,
  http: Http = eadHttp(),
  sync = false,
): Promise<LinkedBundle> {
  const empty: LinkedBundle = {
    nodes: [],
    eadCountByNodeId: {},
    pendingEadByNodePath: {},
    openJobCountByNodeId: {},
    openTestCaseCountByNodeId: {},
    expandByDefaultPaths: [],
    linkedFilePaths: [],
  }
  if (sync) {
    await http(`${eadApi()}/source-code-pfm-node-tree/schema/${schemaId}/sync-pfm-linked-paths`, {
      method: "POST",
      headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({ productId }),
    }).catch(() => undefined)
  }
  const data = (await call(
    http,
    `/source-code-pfm-node-tree/schema/${schemaId}/linked-source-tree?productId=${productId}`,
    token,
  )) as {
    nodes?: Array<Record<string, unknown>>
    eadCountByNodePath?: Record<string, number>
    pendingEadByNodePath?: Record<string, boolean>
    expandByDefaultPaths?: string[]
    linkedFilePaths?: string[]
  }
  const nodes = Array.isArray(data.nodes) ? data.nodes : []
  const pathCounts =
    data.eadCountByNodePath && typeof data.eadCountByNodePath === "object" ? data.eadCountByNodePath : {}
  const eadCountByNodeId: Record<string, number> = {}
  for (const row of nodes) {
    const id = Number(row.nodeId)
    const path = typeof row.nodePath === "string" ? row.nodePath : ""
    const count = pathCounts[path]
    if (Number.isFinite(id) && id > 0 && typeof count === "number" && count > 0) {
      eadCountByNodeId[String(id)] = count
    }
  }
  const pending =
    data.pendingEadByNodePath && typeof data.pendingEadByNodePath === "object" ? data.pendingEadByNodePath : {}
  const pendingEadByNodePath: Record<string, boolean> = {}
  for (const [path, value] of Object.entries(pending)) {
    if (value) pendingEadByNodePath[path] = true
  }
  let openJobCountByNodeId: Record<string, number> = {}
  let openTestCaseCountByNodeId: Record<string, number> = {}
  try {
    const jobs = (await call(http, `/v1/ai-coding-jobs/source-node-open-counts?schemaId=${schemaId}`, token)) as Record<
      string,
      number
    >
    if (jobs && typeof jobs === "object") openJobCountByNodeId = jobs
  } catch {
    openJobCountByNodeId = {}
  }
  try {
    const tests = (await call(http, `/ai-test-cases/source-node-open-counts?schemaId=${schemaId}`, token)) as Record<
      string,
      number
    >
    if (tests && typeof tests === "object") openTestCaseCountByNodeId = tests
  } catch {
    openTestCaseCountByNodeId = {}
  }
  return {
    ...empty,
    nodes,
    eadCountByNodeId,
    pendingEadByNodePath,
    openJobCountByNodeId,
    openTestCaseCountByNodeId,
    expandByDefaultPaths: Array.isArray(data.expandByDefaultPaths) ? data.expandByDefaultPaths : [],
    linkedFilePaths: Array.isArray(data.linkedFilePaths)
      ? data.linkedFilePaths.filter((p) => typeof p === "string")
      : [],
  }
}

async function sourceOpenCounts(http: Http, token: string, schemaId: number) {
  let openJobCountByNodeId: Record<string, number> = {}
  let openTestCaseCountByNodeId: Record<string, number> = {}
  try {
    const jobs = (await call(http, `/v1/ai-coding-jobs/source-node-open-counts?schemaId=${schemaId}`, token)) as Record<
      string,
      number
    >
    if (jobs && typeof jobs === "object") openJobCountByNodeId = jobs
  } catch {
    openJobCountByNodeId = {}
  }
  try {
    const tests = (await call(http, `/ai-test-cases/source-node-open-counts?schemaId=${schemaId}`, token)) as Record<
      string,
      number
    >
    if (tests && typeof tests === "object") openTestCaseCountByNodeId = tests
  } catch {
    openTestCaseCountByNodeId = {}
  }
  return { openJobCountByNodeId, openTestCaseCountByNodeId }
}

export async function loadFullBundle(
  token: string,
  productId: number,
  schemaId: number,
  http: Http = eadHttp(),
  sync = false,
): Promise<LinkedBundle> {
  const empty: LinkedBundle = {
    nodes: [],
    eadCountByNodeId: {},
    pendingEadByNodePath: {},
    openJobCountByNodeId: {},
    openTestCaseCountByNodeId: {},
    expandByDefaultPaths: [],
    linkedFilePaths: [],
  }
  const read = async () => {
    const raw = await call(http, `/source-code-pfm-node-tree/schema/${schemaId}`, token).catch(() => [])
    return Array.isArray(raw) ? raw : []
  }
  let nodes = await read()
  if (!nodes.length) {
    await http(`${eadApi()}/source-code-pfm-node-tree/schema/${schemaId}/sync-pfm-linked-paths`, {
      method: "POST",
      headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({ productId }),
    }).catch(() => undefined)
    nodes = await read()
  } else if (sync) {
    await http(`${eadApi()}/source-code-pfm-node-tree/schema/${schemaId}/sync-pfm-linked-paths`, {
      method: "POST",
      headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({ productId }),
    }).catch(() => undefined)
    nodes = await read()
  }
  if (!nodes.length) return empty
  let eadCountByNodeId: Record<string, number> = {}
  try {
    const raw = (await call(
      http,
      `/source-code-pfm-node-tree/schema/${schemaId}/related-pfm-ead-counts?productId=${productId}`,
      token,
    )) as Record<string, number>
    if (raw && typeof raw === "object") eadCountByNodeId = raw
  } catch {
    eadCountByNodeId = {}
  }
  const { openJobCountByNodeId, openTestCaseCountByNodeId } = await sourceOpenCounts(http, token, schemaId)
  return {
    ...empty,
    nodes,
    eadCountByNodeId,
    openJobCountByNodeId,
    openTestCaseCountByNodeId,
  }
}

export async function loadJobsForNode(token: string, nodeId: number, http: Http = eadHttp()) {
  const data = await call(http, `/v1/ai-coding-jobs/node/${nodeId}`, token)
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : []
}

export function parseFiles(raw: string | null | undefined) {
  if (!raw?.trim()) return [] as string[]
  const trimmed = raw.trim()
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []))
    } catch {
      return []
    }
  }
  return trimmed
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

export async function loadLinkPaths(token: string, nodeId: number, http: Http = eadHttp()) {
  if (!(nodeId > 0)) return [] as string[]
  const node = (await call(http, `/nodes/${nodeId}`, token).catch(() => null)) as {
    sourceCodeFiles?: string | null
  } | null
  return parseFiles(node?.sourceCodeFiles)
}

export async function loadSubtreePaths(token: string, ids: number[], http: Http = eadHttp()) {
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))]
  if (!unique.length) return [] as string[]
  const batches = await Promise.all(unique.map((id) => loadLinkPaths(token, id, http)))
  const merged = new Set<string>()
  for (const paths of batches) {
    for (const path of paths) {
      if (path) merged.add(path)
    }
  }
  return [...merged]
}

export async function createJob(
  token: string,
  input: { pfmNodeId: number; title: string; description?: string; projectId?: number },
  http: Http = eadHttp(),
) {
  let projectId = Number(input.projectId || 0)
  if (!(projectId > 0)) {
    const jobs = await loadJobsForNode(token, input.pfmNodeId, http).catch(() => [])
    for (const job of jobs) {
      const id = Number(job.projectId)
      if (Number.isFinite(id) && id > 0) {
        projectId = id
        break
      }
    }
  }
  const body: Record<string, unknown> = {
    pfmNodeId: input.pfmNodeId,
    title: input.title,
    description: input.description?.trim() || null,
    jobStatus: 0,
  }
  if (projectId > 0) body.projectId = projectId
  const res = await http(`${eadApi()}/v1/ai-coding-jobs`, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch((err) => {
    throw new Error(err instanceof Error ? err.message : "Load failed")
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    let detail = ""
    try {
      const parsed = JSON.parse(text) as { message?: string }
      if (parsed.message) detail = parsed.message
    } catch {
      detail = text.trim().slice(0, 200)
    }
    throw new Error(detail || `Failed to create task (HTTP ${res.status}).`)
  }
  return readJson(res) as Promise<Record<string, unknown>>
}

export async function reconcileJobs(
  token: string,
  input: {
    pfmNodeId?: number | null
    sourceCodePfmNodeId?: number | null
    eadEntityId?: number | null
    parentPfmNode?: string | null
    userDescription?: string | null
    createTasks?: boolean
    dryRun?: boolean
  },
  http: Http = eadHttp(),
) {
  const res = await http(`${eadApi()}/v1/ai-coding-jobs/generate-jobs`, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "auto",
      pfmNodeId: input.pfmNodeId ?? null,
      sourceCodePfmNodeId: input.sourceCodePfmNodeId ?? null,
      eadEntityId: input.eadEntityId ?? null,
      parentPfmNode: input.parentPfmNode ?? null,
      userDescription: input.userDescription ?? null,
      createTasks: input.createTasks !== false,
      dryRun: input.dryRun === true,
    }),
  }).catch((err) => {
    throw new Error(err instanceof Error ? err.message : "Load failed")
  })
  if (!res.ok) throw new Error(`Failed to reconcile AI coding jobs (HTTP ${res.status}).`)
  const data = (await readJson(res)) as Record<string, unknown>
  const jobs = Array.isArray(data.jobs) ? data.jobs : []
  return {
    created: jobs.length,
    updated: Array.isArray(data.updatedJobIds) ? data.updatedJobIds.length : 0,
    linked: Array.isArray(data.linkJobIds) ? data.linkJobIds.length : 0,
    deleted: Array.isArray(data.deletedJobIds) ? data.deletedJobIds.length : 0,
    warnings: Array.isArray(data.warnings) ? data.warnings.length : 0,
  }
}

export async function loadRawContext(
  token: string,
  nodeId: number,
  http: Http = eadHttp(),
  kind: "pfm" | "source" = "pfm",
) {
  const path = kind === "source" ? `/v1/ai-code/context/source-node/${nodeId}` : `/v1/ai-code/context/${nodeId}`
  return (await call(http, path, token)) as ContextPayload
}

export function parseFilterIds(data: unknown) {
  if (!data) return [] as number[]
  if (Array.isArray(data)) {
    return data.flatMap((id) => {
      const n = Number(id)
      return Number.isFinite(n) && n > 0 ? [n] : []
    })
  }
  if (typeof data !== "object") return [] as number[]
  const row = data as { any?: number[]; open?: number[]; active?: number[] }
  const raw = [...(row.any ?? []), ...(row.open ?? []), ...(row.active ?? [])]
  const ids = new Set<number>()
  for (const id of raw) {
    const n = Number(id)
    if (Number.isFinite(n) && n > 0) ids.add(n)
  }
  return [...ids]
}

export async function loadFilterNodeIds(token: string, mapId: number, http: Http = eadHttp()) {
  const data = await call(http, `/v1/ai-coding-jobs/map/${mapId}/filter-node-ids`, token).catch(() => null)
  return parseFilterIds(data)
}

/** Prefer `open` ids for Jobs-filtered PFM tree (Cursor jobFilterNodeIds.open). */
export function parseOpenIds(data: unknown) {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const open = (data as { open?: number[] }).open
    if (Array.isArray(open) && open.length) return parseFilterIds(open)
  }
  return parseFilterIds(data)
}

export async function loadOpenFilterNodeIds(token: string, mapId: number, http: Http = eadHttp()) {
  const data = await call(http, `/v1/ai-coding-jobs/map/${mapId}/filter-node-ids`, token).catch(() => null)
  return parseOpenIds(data)
}

function chunk<T>(list: T[], size: number) {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

export async function loadPfmEadCounts(token: string, nodeIds: number[], http: Http = eadHttp()) {
  const ids = [...new Set(nodeIds.filter((id) => id > 0))]
  const out: Record<string, number> = {}
  for (const part of chunk(ids, 200)) {
    const data = await call(http, `/ead/nodes/ead-counts?pfmNodeIds=${part.join(",")}`, token).catch(() => null)
    if (!data || typeof data !== "object") continue
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const n = Number(value)
      if (Number.isFinite(n) && n > 0) out[String(key)] = n
    }
  }
  return out
}

export async function loadPfmJobCounts(token: string, nodeIds: number[], http: Http = eadHttp()) {
  const ids = [...new Set(nodeIds.filter((id) => id > 0))]
  if (!ids.length) return {} as Record<string, number>
  const data = await call(http, `/v1/ai-coding-jobs/node-summary?pfmNodeIds=${ids.join(",")}`, token).catch(() => null)
  const out: Record<string, number> = {}
  if (!Array.isArray(data)) return out
  for (const row of data) {
    if (!row || typeof row !== "object") continue
    const id = Number((row as { pfmNodeId?: number }).pfmNodeId)
    const open = Number((row as { openJobCount?: number }).openJobCount || 0)
    if (Number.isFinite(id) && id > 0 && open > 0) out[String(id)] = open
  }
  return out
}

export async function loadPfmTestCounts(token: string, nodeIds: number[], http: Http = eadHttp()) {
  const ids = [...new Set(nodeIds.filter((id) => id > 0))]
  const out: Record<string, number> = {}
  for (const part of chunk(ids, 200)) {
    const data = await call(http, `/ai-test-cases/pfm-node-open-counts?pfmNodeIds=${part.join(",")}`, token).catch(
      () => null,
    )
    if (!data || typeof data !== "object") continue
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const n = Number(value)
      if (Number.isFinite(n) && n > 0) out[String(key)] = n
    }
  }
  return out
}

export async function suggestProduct(token: string, products: Product[], folder: string, http: Http = eadHttp()) {
  const name = folder.trim().toLowerCase()
  if (!name || !products.length) return
  for (const product of products) {
    const res = await http(`${eadApi()}/products/${product.productId}/source-code-schema`, {
      headers: headers(token),
    }).catch(() => null)
    if (!res || !res.ok) continue
    const schema = (await readJson(res).catch(() => null)) as Record<string, unknown> | null
    if (!schema) continue
    const repos = (schema.linkedRepos ?? schema.linked_repos) as Array<Record<string, unknown>> | undefined
    if (!Array.isArray(repos)) continue
    for (const repo of repos) {
      const short = String(repo.shortName || "")
        .trim()
        .toLowerCase()
      const vcs = String(repo.vcsRepo || "")
        .trim()
        .toLowerCase()
      const base = vcs.split("/").filter(Boolean).pop() || ""
      const hitShort = short && (name === short || name.includes(short) || short.includes(name))
      const hitBase = base && (name === base || name.includes(base) || base.includes(name))
      if (hitShort || hitBase) return product
    }
  }
}

export async function selectSourcePath(token: string, schemaId: number, nodePath: string, http: Http = eadHttp()) {
  if (!nodePath.trim()) return
  await http(`${eadApi()}/source-code-pfm-node-tree/schema/${schemaId}/select`, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({ nodePath: nodePath.trim() }),
  }).catch(() => undefined)
}

export async function loadContext(
  token: string,
  nodeId: number,
  nodeName: string,
  http: Http = eadHttp(),
  kind: "pfm" | "source" = "pfm",
): Promise<ActiveContext> {
  const path = kind === "source" ? `/v1/ai-code/context/source-node/${nodeId}` : `/v1/ai-code/context/${nodeId}`
  const raw = (await call(http, path, token)) as ContextPayload
  const eadTitle = String(raw.pfmNode?.title || "").trim()
  const label = nodeName.trim() || eadTitle || `Node ${nodeId}`
  return {
    nodeId,
    nodeName: label,
    eadScript: String(raw.eadScript ?? ""),
    aiPrompt: String(raw.aiPrompt ?? ""),
    markdown: formatContextMarkdown(raw, { nodeId, nodeName: eadTitle || label }),
  }
}

export type SourceSchema = {
  schemaId: number
  name: string
  workType?: string
  candidates: number[]
}

export async function loadSourceSchema(
  token: string,
  productId: number,
  http: Http = eadHttp(),
): Promise<SourceSchema | undefined> {
  const res = await http(`${eadApi()}/products/${productId}/source-code-schema`, {
    headers: headers(token),
  }).catch((err) => {
    throw new Error(err instanceof Error ? err.message : "Load failed")
  })
  if (res.status === 404) return
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const schema = (await readJson(res)) as Record<string, unknown>
  const legacy = Number(schema.legacySourceSchemaId ?? schema.legacy_source_schema_id ?? 0)
  const schemaId = Number(schema.schemaId ?? schema.schema_id ?? schema.id ?? 0)
  const candidates: number[] = []
  if (Number.isFinite(schemaId) && schemaId > 0) candidates.push(schemaId)
  if (Number.isFinite(legacy) && legacy > 0 && !candidates.includes(legacy)) candidates.push(legacy)
  if (!candidates.length) return
  return {
    schemaId: candidates[0]!,
    name: String(schema.name ?? schema.schemaName ?? "Source schema"),
    workType: typeof schema.workType === "string" ? schema.workType : undefined,
    candidates,
  }
}

export async function loadLinkedSource(
  token: string,
  productId: number,
  schemaId: number,
  http: Http = eadHttp(),
  sync = false,
) {
  if (sync) {
    await http(`${eadApi()}/source-code-pfm-node-tree/schema/${schemaId}/sync-pfm-linked-paths`, {
      method: "POST",
      headers: { ...headers(token), "Content-Type": "application/json" },
      body: JSON.stringify({ productId }),
    }).catch(() => undefined)
  }
  const data = (await call(
    http,
    `/source-code-pfm-node-tree/schema/${schemaId}/linked-source-tree?productId=${productId}`,
    token,
  )) as { nodes?: Array<Record<string, unknown>> }
  return Array.isArray(data.nodes) ? data.nodes : []
}

export async function me(token: string, http: Http = eadHttp()) {
  const data = (await call(http, `/auth/me`, token)) as {
    id?: number | string
    tenantId?: number | string
    organizationId?: number | string
    email?: string
    name?: string
    userName?: string
    fullName?: string
    username?: string
    user?: {
      id?: number | string
      tenantId?: number | string
      organizationId?: number | string
      email?: string
      name?: string
      userName?: string
      fullName?: string
      username?: string
    }
  }
  const row = data.user ?? data
  const userId = Number(row.id ?? data.id ?? 0)
  const tenantId = Number(row.tenantId ?? row.organizationId ?? data.tenantId ?? data.organizationId ?? 0)
  return {
    email: row.email,
    name: row.fullName || row.name || row.userName || row.username,
    userName: row.username || row.userName,
    userId: Number.isFinite(userId) && userId > 0 ? userId : 0,
    tenantId: Number.isFinite(tenantId) && tenantId > 0 ? tenantId : 0,
  }
}

const PLAN = /^EAD \d+\.\d+$/

export type PlanSlots = {
  easy: string
  reasoning: string
  advanced: string
  vision: string
}

function pretty(id: string) {
  return id
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => {
      if (/^\d/.test(part)) return part
      if (/^v\d/i.test(part)) return part.charAt(0).toUpperCase() + part.slice(1)
      if (/^deepseek$/i.test(part)) return "DeepSeek"
      return part.charAt(0).toUpperCase() + part.slice(1)
    })
    .join(" ")
}

function slots(rows: Array<{ slotKey?: string; modelId?: string }> | undefined): PlanSlots {
  const out: PlanSlots = { easy: "", reasoning: "", advanced: "", vision: "" }
  if (!Array.isArray(rows)) return out
  for (const row of rows) {
    const key = String(row?.slotKey || "")
    const id = String(row?.modelId || "").trim()
    if (!id) continue
    if (key === "easy") out.easy = pretty(id)
    else if (key === "reasoning") out.reasoning = pretty(id)
    else if (key === "advanced") out.advanced = pretty(id)
    else if (key === "vision") out.vision = pretty(id)
  }
  return out
}

export type Plan = {
  /** Name the EAD gateway routes on, such as `EAD 2.1`. */
  name: string
  /** Name shown to people, such as `EAD DP2.1` (same rule as Pilot's planModelId). */
  label: string
  suffix: string
  model: string
  slots: PlanSlots
  /** Token limits of the plan's smallest model, from Pilot; absent from an older Pilot. */
  context?: number
  output?: number
  /** Set for a one-session-only plan: it runs only in a one-time session opened for it. */
  oneSession?: OneSession
}

/** How Pilot describes a one-session-only plan in the model picker. */
export type OneSession = { description?: string; price?: string; limit?: number }

/** `EAD DP2.1` and `EAD 2.1` name the same plan; the gateway's stored name is `EAD 2.1`. */
export function planName(raw: string) {
  const text = raw.trim().replace(/ Plan$/i, "")
  const hit = text.replace(/\s+/g, "").match(/^EADDP(\d+\.\d+)$/i)
  return hit ? `EAD ${hit[1]}` : text
}

export function planLabel(name: string) {
  return name.startsWith("EAD ") ? `EAD DP${name.slice(4)}` : name
}

type PlanRow = {
  name?: string
  nameSuffix?: string
  displayOrder?: number
  contextTokens?: number
  maxOutputTokens?: number
  slots?: Array<{ slotKey?: string; modelId?: string }>
  /** `one-session` marks a one-session-only plan; anything else, or nothing, is a regular plan. */
  usage?: string
  description?: string
  priceHint?: string
  policy?: { maxRequests?: number }
}

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) || undefined : undefined

function oneSession(row: PlanRow): OneSession | undefined {
  if (row.usage !== "one-session") return
  const limit = row.policy?.maxRequests
  return Object.fromEntries(
    Object.entries({
      description: text(row.description, 120),
      price: text(row.priceHint, 40),
      limit: typeof limit === "number" && limit > 0 ? Math.floor(limit) : undefined,
    }).filter(([, value]) => value !== undefined),
  )
}

/**
 * Every EAD Dynamic Plan the account holds, in the team's display order (Pilot's `assignedPlans`).
 * A Pilot from before multi-plan support sends only `effectivePlan`, which becomes a one-plan list.
 * Regular plans must be named like `EAD 3.2`; a one-session plan (`usage: "one-session"`) may have any name.
 */
export async function loadPlans(token: string, http: Http = eadHttp()): Promise<Plan[]> {
  const data = (await call(http, `/account-settings/llm-plans/assignment`, token).catch(() => undefined)) as
    | { assignedPlans?: PlanRow[]; effectivePlan?: PlanRow; oneTimeModels?: OneTimeRow[] }
    | undefined
  if (!data) return []
  const rows = (Array.isArray(data.assignedPlans) ? [...data.assignedPlans] : [data.effectivePlan]).filter(
    (row): row is PlanRow => !!row && typeof row === "object",
  )
  const order = (row: PlanRow) => (typeof row.displayOrder === "number" ? row.displayOrder : Number.MAX_SAFE_INTEGER)
  return rows
    .sort((a, b) => order(a) - order(b))
    .flatMap((row): Plan[] => {
      const name = planName(String(row.name || ""))
      const one = oneSession(row)
      if (one ? !name : !PLAN.test(name)) return []
      const suffix = String(row.nameSuffix || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 40)
      const slot = slots(row.slots)
      const tokens = (value: unknown) => (typeof value === "number" && value > 0 ? Math.floor(value) : undefined)
      return [
        {
          name,
          label: PLAN.test(name) ? planLabel(name) : name,
          suffix,
          model: slot.advanced || slot.reasoning || slot.easy,
          slots: slot,
          context: tokens(row.contextTokens),
          output: tokens(row.maxOutputTokens),
          ...(one ? { oneSession: one } : {}),
        },
      ]
    })
    .concat(oneTimeModels(data.oneTimeModels))
    .filter((plan, i, list) => list.findIndex((item) => item.name === plan.name) === i)
}

/** A One Time Only Model as Pilot's admin page offers it (`oneTimeModels` on the plan assignment). */
type OneTimeRow = {
  name?: string
  providerId?: string
  modelId?: string
  description?: string
  priceHint?: string
  maxRequests?: number | null
}

/** Pilot's One Time Only Models as plans that run only in a one-time session; the gateway routes on the name. */
function oneTimeModels(rows: OneTimeRow[] | undefined): Plan[] {
  if (!Array.isArray(rows)) return []
  return rows.flatMap((row) => {
    const name = text(row?.name, 80)
    if (!name) return []
    const one = oneSession({
      usage: "one-session",
      description: row.description,
      priceHint: row.priceHint,
      policy: { maxRequests: row.maxRequests ?? undefined },
    })
    return [
      {
        name,
        label: name,
        suffix: "",
        model: pretty(String(row.modelId || "")),
        slots: { easy: "", reasoning: "", advanced: "", vision: "" },
        ...(one ? { oneSession: one } : {}),
      },
    ]
  })
}

export type RunPref = {
  showEadCount?: boolean
  eadsOnlyFilter?: boolean
  showOpenJobs?: boolean
  showOpenTests?: boolean
}

export async function loadRunPrefs(
  token: string,
  userId: number,
  tenantId: number,
  schemaId: number,
  http: Http = eadHttp(),
) {
  if (!(userId > 0) || !(tenantId > 0) || !(schemaId > 0)) return null as RunPref | null
  const q = new URLSearchParams({
    userId: String(userId),
    tenantId: String(tenantId),
    settingKey: "ead_run_source_tree_prefs",
    contextType: "ead_run",
    contextId: String(schemaId),
  })
  const data = (await call(http, `/settings/get?${q.toString()}`, token).catch(() => null)) as {
    value?: string | RunPref
  } | null
  if (!data) return null
  const raw = typeof data.value === "string" ? (JSON.parse(data.value) as unknown) : data.value
  if (!raw || typeof raw !== "object") return null
  return raw as RunPref
}

export async function saveRunPrefs(
  token: string,
  userId: number,
  tenantId: number,
  schemaId: number,
  prefs: RunPref,
  http: Http = eadHttp(),
) {
  if (!(userId > 0) || !(tenantId > 0) || !(schemaId > 0)) return
  await http(`${eadApi()}/settings/save`, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      tenantId,
      settingKey: "ead_run_source_tree_prefs",
      settingValue: prefs,
      contextType: "ead_run",
      contextId: String(schemaId),
    }),
  }).catch(() => undefined)
}

export async function loadSourceExpanded(
  token: string,
  userId: number,
  tenantId: number,
  schemaId: number,
  http: Http = eadHttp(),
) {
  if (!(userId > 0) || !(tenantId > 0) || !(schemaId > 0)) return null as string[] | null
  const q = new URLSearchParams({
    userId: String(userId),
    tenantId: String(tenantId),
    settingKey: "ead_run_source_tree_expanded",
    contextType: "ead_run",
    contextId: String(schemaId),
  })
  const data = (await call(http, `/settings/get?${q.toString()}`, token).catch(() => null)) as {
    value?: string | string[]
  } | null
  if (!data) return null
  const raw = typeof data.value === "string" ? (JSON.parse(data.value) as unknown) : data.value
  if (!Array.isArray(raw)) return null
  return raw.flatMap((path) => (typeof path === "string" && path.trim() ? [path.trim()] : []))
}

export async function saveSourceExpanded(
  token: string,
  userId: number,
  tenantId: number,
  schemaId: number,
  paths: string[],
  http: Http = eadHttp(),
) {
  if (!(userId > 0) || !(tenantId > 0) || !(schemaId > 0)) return
  const pruned = paths.flatMap((path) => (typeof path === "string" && path.trim() ? [path.trim()] : []))
  await http(`${eadApi()}/settings/save`, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      tenantId,
      settingKey: "ead_run_source_tree_expanded",
      settingValue: pruned,
      contextType: "ead_run",
      contextId: String(schemaId),
    }),
  }).catch(() => undefined)
}

export function authKind(target: string): "email" | "phone" {
  return target.includes("@") ? "email" : "phone"
}

async function authPost(path: string, body: Record<string, unknown>, http: Http) {
  const res = await http(`${eadApi()}${path}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch((err) => {
    throw new Error(err instanceof Error ? err.message : "Load failed")
  })
  const data = (await readJson(res)) as AuthResult & {
    code?: string
    signupToken?: string
  }
  return { ok: res.ok, data }
}

export async function sendCode(target: string, intent: "signup" | "reset" = "signup", http: Http = eadHttp()) {
  const trimmed = target.trim()
  if (!trimmed) throw new Error("Please enter email or phone.")
  const kind = authKind(trimmed)
  const { ok, data } = await authPost(
    `/auth/send-code`,
    {
      type: kind === "phone" ? 1 : 2,
      target: encodeURIComponent(trimmed),
      productId: 1,
      intent,
    },
    http,
  )
  if (!ok || !data.success) throw new Error(data.message || "Failed to send code.")
  return { code: data.code, message: data.message || "Verification code sent." }
}

export async function verifyCode(target: string, code: string, http: Http = eadHttp()) {
  const trimmed = target.trim()
  const digits = code.trim()
  if (!trimmed || !digits) throw new Error("Please enter the 6-digit verification code.")
  const { ok, data } = await authPost(
    `/auth/verify-code`,
    {
      target: encodeURIComponent(trimmed),
      code: encodeURIComponent(digits),
      issueSignupToken: true,
    },
    http,
  )
  if (!ok || !data.success || !data.signupToken) {
    throw new Error(data.message || "Invalid or expired code.")
  }
  return data.signupToken
}

export async function signup(
  input: { target: string; username: string; password: string; signupToken: string },
  http: Http = eadHttp(),
) {
  const target = input.target.trim()
  const username = input.username.trim()
  if (!target || !username || !input.password || !input.signupToken) {
    throw new Error("Please complete all sign up fields.")
  }
  const kind = authKind(target)
  const { ok, data } = await authPost(
    `/auth/signup`,
    {
      email: kind === "email" ? target : undefined,
      phone: kind === "phone" ? target : undefined,
      username,
      password: btoa(input.password),
      role: "user",
      encryptOption: "0",
      signupToken: input.signupToken,
    },
    http,
  )
  if (!ok || !data.success || !data.token) throw new Error(data.message || "Sign up failed.")
  return data.token
}

export async function resetPassword(input: { target: string; code: string; password: string }, http: Http = eadHttp()) {
  const target = input.target.trim()
  const code = input.code.trim()
  if (!target || !code || !input.password) {
    throw new Error("Please complete all reset password fields.")
  }
  const kind = authKind(target)
  const { ok, data } = await authPost(
    `/auth/reset-password`,
    {
      email: kind === "email" ? target : undefined,
      mobile: kind === "phone" ? target : undefined,
      code,
      password: btoa(input.password),
    },
    http,
  )
  if (!ok || !data.success) throw new Error(data.message || "Failed to reset password.")
  return data.message || "Password reset successfully."
}

export type TeamMember = { email: string; label: string }

export async function loadTeamMembers(token: string, productId: number, http: Http = eadHttp()) {
  const data = (await call(http, `/applicable-team-members/products/${productId}/resolved-members`, token)) as {
    members?: Array<Record<string, unknown>>
  }
  return (data.members ?? []).flatMap((row) => {
    const email = String(row.email ?? row.userEmail ?? "").trim()
    if (!email) return []
    const label = String(row.label ?? row.name ?? row.fullName ?? row.username ?? email).trim()
    return [{ email, label: label || email }]
  })
}

/** A Shared Server the account Superadmin registered in EAD Pilot. */
export type SharedServer = {
  serverId: number
  name: string
  /** Short name for tags, e.g. "JB Dev". */
  shortName: string
  os: "windows" | "mac"
  sshHost: string
  sshPort: number
  sshLogin: string
  rootFolder: string
  /** This user has put their own SSH key on the server. */
  enabled: boolean
}

function tenantHeaders(tenantId?: number): Record<string, string> {
  return tenantId && tenantId > 0 ? { "X-Tenant-Id": String(tenantId) } : {}
}

function asSharedServer(row: Record<string, unknown>): SharedServer | undefined {
  const serverId = Number(row.serverId)
  if (!(serverId > 0)) return
  return {
    serverId,
    name: String(row.name ?? ""),
    shortName: String(row.shortName ?? row.name ?? "").slice(0, 12),
    os: row.os === "mac" ? "mac" : "windows",
    sshHost: String(row.sshHost ?? ""),
    sshPort: Number(row.sshPort) || 22,
    sshLogin: String(row.sshLogin ?? ""),
    rootFolder: String(row.rootFolder ?? ""),
    enabled: row.enabled === true,
  }
}

export async function loadSharedServers(token: string, tenantId?: number, http: Http = eadHttp()) {
  const data = await call(http, "/shared-ai-coding-servers", token, { headers: tenantHeaders(tenantId) })
  if (!Array.isArray(data)) return [] as SharedServer[]
  return data.flatMap((row) => {
    const item = row && typeof row === "object" ? asSharedServer(row as Record<string, unknown>) : undefined
    return item ? [item] : []
  })
}

// Enabling signs in to the server, so a refusal carries a message worth showing as it is.
async function sharedServerAction(
  http: Http,
  path: string,
  token: string,
  tenantId?: number,
  body?: unknown,
  method = "POST",
) {
  const res = await http(`${eadApi()}${path}`, {
    method,
    headers: { ...headers(token), ...tenantHeaders(tenantId), "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).catch((err) => {
    throw new Error(err instanceof Error ? err.message : "Load failed")
  })
  if (res.status === 401) throw new Error("AUTH_EXPIRED")
  const data = (await readJson(res).catch(() => null)) as Record<string, unknown> | null
  if (!res.ok) {
    const message =
      data && typeof data.message === "string" && data.message.trim() ? data.message : `HTTP ${res.status}`
    throw new Error(message)
  }
  return data ? asSharedServer(data) : undefined
}

/** Puts this user's public key on the server; EAD Pilot signs in with the saved password. */
export function enableSharedServer(
  token: string,
  serverId: number,
  publicKey: string,
  tenantId?: number,
  http: Http = eadHttp(),
) {
  return sharedServerAction(http, `/shared-ai-coding-servers/${serverId}/enable`, token, tenantId, { publicKey })
}

/** A server as an account Superadmin saves it; a blank password keeps the saved one. */
export type SharedServerInput = {
  name: string
  shortName: string
  os: "windows" | "mac"
  sshHost: string
  sshPort: number
  sshLogin: string
  password: string
  rootFolder: string
}

/** Whether this user may add, edit and delete the account's servers (an account admin); only an explicit no says no. */
export async function sharedServerAccess(token: string, tenantId?: number, http: Http = eadHttp()) {
  const data = (await call(http, "/shared-ai-coding-servers/access", token, {
    headers: tenantHeaders(tenantId),
  })) as Record<string, unknown> | null
  return data?.canManage !== false
}

export function saveSharedServer(
  token: string,
  input: SharedServerInput,
  serverId?: number,
  tenantId?: number,
  http: Http = eadHttp(),
) {
  return serverId
    ? sharedServerAction(http, `/shared-ai-coding-servers/${serverId}`, token, tenantId, input, "PUT")
    : sharedServerAction(http, "/shared-ai-coding-servers", token, tenantId, input)
}

export async function deleteSharedServer(token: string, serverId: number, tenantId?: number, http: Http = eadHttp()) {
  await sharedServerAction(http, `/shared-ai-coding-servers/${serverId}`, token, tenantId, undefined, "DELETE")
}

/** Takes this user's key off the server. */
export function disableSharedServer(token: string, serverId: number, tenantId?: number, http: Http = eadHttp()) {
  return sharedServerAction(http, `/shared-ai-coding-servers/${serverId}/disable`, token, tenantId)
}

/** A repo of a product's Source Code Schema, and the Shared Server it is developed and built on, if any. */
export type ServerRepo = {
  definitionId: number
  name: string
  role: string
  /** The repo definition's source code type, and its server-end type when it holds both ends; "" when unset. */
  sourceCodeType: string
  serverSourceCodeType: string
  /** owner/repo, as Pilot spells it; compare with repoKey. */
  repository: string
  branch: string
  section: "LEGACY" | "CURRENT"
  /** Undefined when the repo is on the Local Server. */
  serverId?: number
  /** The repo's folder on its Shared Server. */
  folder: string
}

/** Which ends of the product a repo holds, from its role (FRONT_END_ONLY, SERVER_END_ONLY, FRONT_AND_SERVER_END). */
export function repoEnd(role: string) {
  const value = role.toUpperCase()
  if (value.includes("AND") || (value.includes("FRONT") && value.includes("SERVER"))) return "both"
  if (value.startsWith("SERVER")) return "server"
  if (value.startsWith("FRONT")) return "front"
  return "both"
}

// The schema editor's label for a stack code, e.g. "Vue 3 + TypeScript"; codes without one show as they are.
const stack = (code: string) => (code ? (STACK_LABELS[code] ?? code) : "")

/** The repo's source code type: the front end's, the server end's, or "front / server" for a repo with both. */
export function repoSourceType(repo: Pick<ServerRepo, "role" | "sourceCodeType" | "serverSourceCodeType">) {
  const end = repoEnd(repo.role)
  const front = stack(repo.sourceCodeType)
  const server = stack(repo.serverSourceCodeType)
  if (end === "both") return [front, server].filter(Boolean).join(" / ")
  if (end === "server") return server || front
  return front
}

/** A product with a Source Code Schema, and where each of its repos is developed. */
export type ServerProduct = { productId: number; name: string; repos: ServerRepo[] }

/** owner/repo in lower case, from a GitHub URL or owner/repo. */
export function repoKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^(https?:\/\/|git@)[^/:]+[/:]/, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
}

function asServerProducts(data: unknown): ServerProduct[] {
  if (!Array.isArray(data)) return []
  return data.flatMap((row) => {
    const item = row && typeof row === "object" ? (row as Record<string, unknown>) : undefined
    const productId = Number(item?.productId)
    if (!item || !(productId > 0)) return []
    const repos = (Array.isArray(item.repos) ? item.repos : []).flatMap((raw) => {
      const repo = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined
      const definitionId = Number(repo?.definitionId)
      if (!repo || !(definitionId > 0)) return []
      const serverId = Number(repo.serverId)
      return [
        {
          definitionId,
          name: String(repo.name ?? ""),
          role: String(repo.role ?? ""),
          sourceCodeType: String(repo.sourceCodeType ?? ""),
          serverSourceCodeType: String(repo.serverSourceCodeType ?? ""),
          repository: String(repo.repository ?? "").trim(),
          branch: String(repo.branch ?? ""),
          section: repo.section === "LEGACY" ? "LEGACY" : "CURRENT",
          serverId: serverId > 0 ? serverId : undefined,
          folder: String(repo.folder ?? ""),
        } satisfies ServerRepo,
      ]
    })
    return [{ productId, name: String(item.name ?? ""), repos }]
  })
}

/** The account's products with their repos and the Shared Server each repo is on. */
export async function loadServerProducts(token: string, tenantId?: number, http: Http = eadHttp()) {
  return asServerProducts(
    await call(http, "/shared-ai-coding-servers/products", token, { headers: tenantHeaders(tenantId) }),
  )
}

/** This person's view of the Shared Coding Servers dialog: which servers are expanded, and its size. */
export type ServerView = { open: Record<string, boolean>; width: number; height: number }

const serverView = "sicode_shared_servers_view"

/** The saved view, or null when this person has none yet. Throws when EAD Pilot can't say, unlike a missing one. */
export async function loadServerView(token: string, userId: number, tenantId: number, http: Http = eadHttp()) {
  const q = new URLSearchParams({
    userId: String(userId),
    tenantId: String(tenantId),
    settingKey: serverView,
    contextType: "sicode",
    contextId: "shared_servers",
  })
  const data = (await call(http, `/settings/get?${q.toString()}`, token).catch((err) => {
    if (err instanceof Error && err.message === "HTTP 404") return null
    throw err
  })) as { value?: string } | null
  if (!data?.value) return null
  return JSON.parse(data.value) as Partial<ServerView>
}

export async function saveServerView(
  token: string,
  userId: number,
  tenantId: number,
  view: ServerView,
  http: Http = eadHttp(),
) {
  await call(http, "/settings/save", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      tenantId,
      settingKey: serverView,
      settingValue: view,
      contextType: "sicode",
      contextId: "shared_servers",
    }),
  })
}

/** Sets the repos a Shared Server develops and builds (admins only); returns the products again. */
export async function saveServerRepos(
  token: string,
  serverId: number,
  repos: { productId: number; definitionId: number; folder: string }[],
  tenantId?: number,
  http: Http = eadHttp(),
) {
  const res = await http(`${eadApi()}/shared-ai-coding-servers/${serverId}/repos`, {
    method: "PUT",
    headers: { ...headers(token), ...tenantHeaders(tenantId), "Content-Type": "application/json" },
    body: JSON.stringify({ repos }),
  })
  if (res.status === 401) throw new Error("AUTH_EXPIRED")
  const data = await readJson(res).catch(() => null)
  if (!res.ok) {
    const message = data && typeof data === "object" && typeof (data as Record<string, unknown>).message === "string"
    throw new Error(message ? String((data as Record<string, unknown>).message) : `HTTP ${res.status}`)
  }
  return asServerProducts(data)
}

/** Where a session's repo is developed: its product, the repo, and its Shared Server when it has one. */
export type RepoPlace = {
  product: ServerProduct
  repo: ServerRepo
  /** Set when the repo is on a Shared Server this account still has. */
  server?: SharedServer
  /** Every server of the account, to name where the product's other repos are. */
  servers: SharedServer[]
}

/** Where SiCode keeps the private key it made when the user enabled the server (desktop shared_server_key). */
export function sharedServerKeyPath(serverId: number) {
  return `~/.ssh/sicode_ead_s${serverId}_ed25519`
}

// The words here stay clear of EadTools' trigger words in opencode/src/session/ead-tools.ts, so this block alone does
// not load the EAD Pilot tools.
/**
 * The block a chat message carries when the session's repo belongs to a product that develops repos on a Shared
 * Server: where this repo is worked on (`remote` false = the user chose the Local Server) and where the others are.
 */
export function formatSharedServerPrompt(place: RepoPlace | undefined, remote: boolean, here: string) {
  if (!place) return
  const others = place.product.repos.filter((repo) => repo !== place.repo)
  if (!place.repo.serverId && !others.some((repo) => repo.serverId)) return
  const where = (repo: ServerRepo) => {
    const server = place.servers.find((item) => item.serverId === repo.serverId)
    return server
      ? `on the Shared Server ${server.shortName}, in ${repo.folder}`
      : "on the Local Server (its own project)"
  }
  const kind = (repo: ServerRepo) =>
    [
      { front: "front end", server: "server end", both: "front and server end" }[repoEnd(repo.role)],
      repoSourceType(repo),
    ]
      .filter(Boolean)
      .join(", ")
  const list = others.map(
    (repo) =>
      `- ${repo.name || repo.repository} (${repo.repository}, ${repo.section === "LEGACY" ? "legacy" : "current"}, ${kind(repo)}): ${where(repo)}`,
  )
  const intro = `This project is the repo ${place.repo.repository} ("${place.repo.name}", ${kind(place.repo)}) of the product "${place.product.name}".`
  const rest = list.length ? [`The product's other repos:`, ...list] : []
  const server = place.server
  if (!place.repo.serverId || !remote) {
    return [
      `<shared-ai-coding-server>`,
      `${intro} Work on it here, on the Local Server, in ${here}.`,
      ...rest,
      `</shared-ai-coding-server>`,
    ].join("\n")
  }
  if (!server) {
    return [
      `<shared-ai-coding-server>`,
      `${intro} It is set to be developed on a Shared Server that no longer exists in EAD Pilot. Tell the user to ask an account admin to check Shared Servers before work that needs it.`,
      ...rest,
      `</shared-ai-coding-server>`,
    ].join("\n")
  }
  if (!server.enabled) {
    return [
      `<shared-ai-coding-server>`,
      `${intro} It is developed on the Shared Server "${server.name}" (${server.sshHost}), but this user's SSH key isn't on it yet, so there is no way to reach it.`,
      `SiCode adds the key by itself. Before work that needs that computer, tell the user it couldn't be set up, or to ask an account admin to check "${server.name}" in Shared Servers.`,
      ...rest,
      `</shared-ai-coding-server>`,
    ].join("\n")
  }
  const windows = server.os === "windows"
  const key = sharedServerKeyPath(server.serverId)
  const ssh = `ssh -i ${key} -p ${server.sshPort} -o BatchMode=yes -o StrictHostKeyChecking=accept-new ${server.sshLogin}@${server.sshHost}`
  const folder = place.repo.folder || server.rootFolder
  return [
    `<shared-ai-coding-server>`,
    `${intro} It is developed and built on the Shared Server ${server.shortName}, the remote ${windows ? "Windows" : "Mac"} computer "${server.name}", in ${folder}. Work there, not in the local folder; do not change anything outside ${server.rootFolder}.`,
    `Run every command there through ssh with the user's own key, one command per call:`,
    `  ${ssh} "<command>"`,
    windows
      ? `The remote shell is cmd.exe. For PowerShell, run: powershell -NoProfile -Command "<script>". Paths use backslashes.`
      : `The remote shell is the login shell (zsh on a Mac).`,
    `Read files with ssh (${windows ? "type, or Get-Content" : "cat"}); to edit, copy the file here, change it, and copy it back with scp -i ${key} -P ${server.sshPort}. Build, run and test on that computer.`,
    `Other people use the same computer and the same login; leave their files and running programs alone.`,
    ...rest,
    `</shared-ai-coding-server>`,
  ].join("\n")
}
