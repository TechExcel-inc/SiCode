import { eadHttp } from "./http"
import { eadApi } from "./urls"

type Http = typeof fetch

/** A project as one person sees it in EAD Pilot: the project plus their membership. */
export type CoworkProject = {
  projectId: number
  projectName: string
  repoPlatform: string
  repoId: string
  repoOwner: string
  repoName: string
  repoDefaultBranch?: string
  repoWebUrl?: string
  memberRole: "OWNER" | "MEMBER" | "VIEWER"
  lastActiveAt?: string
  lastActiveKind?: "OPENED" | "CLOSED" | "WORKED"
  isOpen: boolean
  sortOrder: number
}

export type CoworkRelated = {
  relatedId: number
  projectId: number
  relatedProjectId: number
  projectName: string
  repoOwner: string
  repoName: string
}

export type CoworkAccount = { repoPlatform: string; platformLogin: string; status: "ACTIVE" | "REVOKED" | "EXPIRED" }

export type CoworkDevice = { deviceCode: string; userCode: string; verificationUri: string; expiresIn: number; interval: number }

export type CoworkConnect = { status: "PENDING" | "CONNECTED" | "EXPIRED" | "DENIED"; account?: CoworkAccount; interval?: number }

export type CoworkSessionState = "OPEN" | "FINISHED" | "ARCHIVED"

export type CoworkSession = {
  sessionUid: string
  projectId: number
  title: string
  state: CoworkSessionState
  archivedBy?: "USER" | "AUTO"
  finishedAt?: string
  archivedAt?: string
  messageCount: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costMicroUsd: number
  linesAdded: number
  linesDeleted: number
  filesChanged: number
  startedAt: string
  lastActiveAt: string
  rowVersion: number
  planCode?: string
  modelName?: string
  agentName?: string
}

/** What CoWork sends for one session; counts are totals. */
export type CoworkSessionBody = {
  projectId: number
  parentSessionUid?: string
  title: string
  messageCount?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  costMicroUsd?: number
  linesAdded?: number
  linesDeleted?: number
  filesChanged?: number
  startedAt?: string
  lastActiveAt?: string
  planCode?: string
  modelName?: string
  agentName?: string
  modelVariant?: string
  /** The session's use of each model per day (UTC); replaces what Pilot had for the session. */
  models?: CoworkModelUse[]
}

export type CoworkGatewayCost = {
  requests: number
  /** Time the AI was answering, from the gateway's request start and end times. */
  workingMs?: number
  /** Answers recorded before start times were kept, so their time is unknown. */
  untimedRequests?: number
  promptTokens: number
  cachedTokens?: number
  completionTokens: number
  costMicroUsd: number
  unpricedRequests: number
  /** Split by the real model and plan slot that answered, most expensive first. */
  models?: {
    providerId: string
    modelId: string
    slotKey: string
    requests: number
    durationMs?: number
    promptTokens: number
    cachedTokens?: number
    completionTokens: number
    costMicroUsd: number
    unpricedRequests: number
  }[]
  /** Every answer, in order. */
  entries?: {
    usageId: number
    providerId: string
    modelId: string
    slotKey: string
    /** The session that sent it: this session, or a helper agent's session. */
    sessionUid?: string | null
    /** The user message (request) it served and the checklist step in progress; empty for older answers. */
    messageUid?: string | null
    stepText?: string | null
    promptTokens: number
    cachedTokens: number
    completionTokens: number
    costMicroUsd: number | null
    /** Prices used, in dollars per 1M tokens, and the cost of each part in millionths of a dollar. */
    inputPerMillion?: number | null
    cachedInputPerMillion?: number | null
    outputPerMillion?: number | null
    inputCostMicroUsd?: number | null
    cachedCostMicroUsd?: number | null
    outputCostMicroUsd?: number | null
    startedAt: string | null
    endedAt: string | null
  }[]
}

export type CoworkModelUse = {
  usageDate: string
  providerId: string
  modelId: string
  messageCount: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  listCostMicroUsd: number
}

export type CoworkSettings = {
  autoArchiveDays: number
  defaultPlanCode?: string
  storeSessionHistory: boolean
  historyRetentionDays: number
  requireRepoLink: boolean
}

/** A failed CoWork call. `code` is Pilot's stable error code, e.g. GITHUB_NOT_CONNECTED. */
export class CoworkFail extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** The CoWork API in EAD Pilot (`/api/cowork/v1`), as the signed-in person in one company. */
export function cowork(token: string, tenant?: number, http: Http = eadHttp()) {
  const send = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${token}` }
    if (tenant && tenant > 0) headers["X-Tenant-Id"] = String(tenant)
    if (body !== undefined) headers["Content-Type"] = "application/json"
    const res = await http(`${eadApi()}/cowork/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch((err) => {
      throw new CoworkFail(0, "OFFLINE", err instanceof Error ? err.message : "Could not reach EAD Pilot.")
    })
    if (res.status === 204) return undefined as T
    const text = await res.text()
    const data = parse(text)
    if (!res.ok) {
      const code = typeof data?.code === "string" ? data.code : `HTTP_${res.status}`
      const message = typeof data?.message === "string" ? data.message : `EAD Pilot answered HTTP ${res.status}.`
      throw new CoworkFail(res.status, code, message)
    }
    return data as T
  }
  const id = (value: string) => encodeURIComponent(value)
  const query = (params: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") q.set(key, String(value))
    const text = q.toString()
    return text ? `?${text}` : ""
  }

  return {
    accounts: () => send<CoworkAccount[]>("GET", "/repo-accounts"),
    githubStart: () => send<CoworkDevice>("POST", "/repo-accounts/github/start"),
    githubFinish: (deviceCode: string) => send<CoworkConnect>("POST", "/repo-accounts/github/finish", { deviceCode }),
    githubDisconnect: () => send<void>("DELETE", "/repo-accounts/github"),

    resolve: (repoUrl: string) => send<CoworkProject>("POST", "/projects/resolve", { repoUrl }),
    recent: (input: { limit?: number; q?: string } = {}) => send<CoworkProject[]>("GET", `/projects/recent${query(input)}`),
    open: () => send<CoworkProject[]>("GET", "/projects/open"),
    project: (projectId: number) => send<CoworkProject>("GET", `/projects/${projectId}`),
    /** The EAD product a project codes: linked, matched from its repository, or none. */
    product: (projectId: number) => send<{ productId?: number; how: string }>("GET", `/projects/${projectId}/product`),
    linkProduct: (projectId: number, productId: number | null) =>
      send<{ productId?: number; how: string }>("PUT", `/projects/${projectId}/product`, { productId }),
    activity: (projectId: number, kind: "OPENED" | "CLOSED" | "WORKED") =>
      send<CoworkProject>("POST", `/projects/${projectId}/activity`, { kind }),
    sidebar: (projectId: number, open: boolean, sortOrder?: number) =>
      send<CoworkProject>("PUT", `/projects/${projectId}/sidebar`, { open, sortOrder }),
    related: (projectId: number) => send<CoworkRelated[]>("GET", `/projects/${projectId}/related`),
    relate: (projectId: number, relatedProjectId: number) =>
      send<CoworkRelated[]>("POST", `/projects/${projectId}/related`, { relatedProjectId }),
    unrelate: (projectId: number, relatedProjectId: number) =>
      send<void>("DELETE", `/projects/${projectId}/related/${relatedProjectId}`),

    sessions: (input: { projectIds?: number[]; state?: CoworkSessionState[]; q?: string; cursor?: string; limit?: number } = {}) =>
      send<{ sessions: CoworkSession[]; next?: string }>(
        "GET",
        `/sessions${query({
          projectIds: input.projectIds?.join(","),
          state: input.state?.join(","),
          q: input.q,
          cursor: input.cursor,
          limit: input.limit,
        })}`,
      ),
    upsert: (uid: string, body: CoworkSessionBody) => send<CoworkSession>("PUT", `/sessions/${id(uid)}`, body),
    finish: (uid: string) => send<CoworkSession>("POST", `/sessions/${id(uid)}/finish`),
    reopen: (uid: string) => send<CoworkSession>("POST", `/sessions/${id(uid)}/reopen`),
    archive: (uid: string, by: "USER" | "AUTO") => send<CoworkSession>("POST", `/sessions/${id(uid)}/archive`, { by }),
    unarchive: (uid: string) => send<CoworkSession>("POST", `/sessions/${id(uid)}/unarchive`),
    move: (uid: string, projectId: number) => send<CoworkSession>("POST", `/sessions/${id(uid)}/move`, { projectId }),
    remove: (uid: string) => send<void>("DELETE", `/sessions/${id(uid)}`),

    /** What a session's EAD plan answers cost at provider prices, as Pilot's AI gateway recorded them. */
    gatewayCost: (uid: string) => send<CoworkGatewayCost>("GET", `/sessions/${id(uid)}/gateway-cost`),
    settings: () => send<CoworkSettings>("GET", "/settings"),
    saveSettings: (input: Partial<CoworkSettings>) => send<CoworkSettings>("PUT", "/settings", input),
  }
}

export type Cowork = ReturnType<typeof cowork>

function parse(text: string): Record<string, unknown> | undefined {
  if (!text.trim()) return
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return
  }
}

/** The usage totals Pilot keeps for a session, from the session's messages. Cost is stored in millionths of a dollar. */
export function usage(
  messages: {
    role: string
    cost?: number
    tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  }[],
) {
  const out = { messageCount: messages.length, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicroUsd: 0 }
  for (const item of messages) {
    if (item.role !== "assistant" || !item.tokens) continue
    out.inputTokens += item.tokens.input
    out.outputTokens += item.tokens.output + item.tokens.reasoning
    out.cacheReadTokens += item.tokens.cache.read
    out.cacheWriteTokens += item.tokens.cache.write
    out.costMicroUsd += Math.round((item.cost ?? 0) * 1_000_000)
  }
  return out
}

/** "owner/name" in lower case for a github.com remote, in https, ssh or scp form. */
export const githubRepo = (url: string | undefined) => {
  const match = url?.trim().match(/^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/git@|git@)github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i)
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : undefined
}

/**
 * The session's use of each model per day, for Pilot's usage report: the company prices each model
 * with its own price, so tokens are kept apart by model. Days are UTC dates of each reply.
 */
export function modelUsage(
  messages: {
    role: string
    providerID?: string
    modelID?: string
    cost?: number
    time?: { created: number }
    tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  }[],
): CoworkModelUse[] {
  const out = new Map<string, CoworkModelUse>()
  for (const item of messages) {
    if (item.role !== "assistant" || !item.tokens || !item.providerID || !item.modelID || !item.time) continue
    const usageDate = new Date(item.time.created).toISOString().slice(0, 10)
    const key = `${usageDate}|${item.providerID}|${item.modelID}`
    const row =
      out.get(key) ??
      out
        .set(key, {
          usageDate,
          providerId: item.providerID,
          modelId: item.modelID,
          messageCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          listCostMicroUsd: 0,
        })
        .get(key)!
    row.messageCount += 1
    row.inputTokens += item.tokens.input
    row.outputTokens += item.tokens.output
    row.reasoningTokens += item.tokens.reasoning
    row.cacheReadTokens += item.tokens.cache.read
    row.cacheWriteTokens += item.tokens.cache.write
    row.listCostMicroUsd += Math.round((item.cost ?? 0) * 1_000_000)
  }
  return [...out.values()]
}
