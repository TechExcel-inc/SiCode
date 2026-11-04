import { createSimpleContext } from "@opencode-ai/ui/context"
import { createEffect, createSignal, onCleanup, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { usePlatform } from "@/context/platform"
import { persisted } from "@/utils/persist"
import { formatSharedServerPrompt, loadPlans, loadProductSharedServer, renew, type ProductSharedServer } from "./api"
import { bindFilters, emptyOwner, mergeOwner, mergePfm, type OwnerFilter, type PfmFilter } from "./filters"
import { bindEadHttp } from "./http"
import type { Lang } from "./i18n"
import { renewDue, tokenExpired } from "./auth"
import { DEFAULT_MCP_ENTRY } from "./mcp"
import { apply as applyPlan, drop as dropPlan, PLAN } from "./plan"
import { applyEnv, eadApi, type Env } from "./urls"

type View = "pfm" | "source"
type Mode = "opencode" | "cursor"
type Badge = "ead" | "jobs" | "tests" | "none"

export type Chrome = {
  view: View
  badge: Badge
  eadsOnly: boolean
  jobsOnly: boolean
  subSchemaId: number
}

export type SourcePref = {
  badge: Badge
  eadsOnly: boolean
}

type State = {
  token: string
  tokenApiUrl: string
  productId: number
  productName: string
  nodeId: number
  nodeName: string
  mapId: number
  schemaId: number
  schemaName: string
  subSchemaId: number
  sourceId: number
  sourceName: string
  sourcePath: string
  view: View
  pilotMode: Mode
  language: Lang
  env: Env
  mcpEntry: string
  coding: boolean
  pilotBust: number
  eadScript: string
  aiPrompt: string
  contextMarkdown: string
  mapTick: number
  eadsOnly: boolean
  badge: Badge
  expanded: Record<string, string[]>
  pfmExpanded: Record<string, number[]>
  jobsOnly: boolean
  workContextId: number
  owners: Record<string, OwnerFilter>
  pfm: Record<string, PfmFilter>
  chrome: Record<string, Chrome>
  source: Record<string, SourcePref>
}

const empty: State = {
  token: "",
  tokenApiUrl: "",
  productId: 0,
  productName: "",
  nodeId: 0,
  nodeName: "",
  mapId: 0,
  schemaId: 0,
  schemaName: "",
  subSchemaId: 0,
  sourceId: 0,
  sourceName: "",
  sourcePath: "",
  view: "pfm",
  pilotMode: "cursor",
  language: "zh",
  env: "production",
  mcpEntry: DEFAULT_MCP_ENTRY,
  coding: true,
  pilotBust: 0,
  eadScript: "",
  aiPrompt: "",
  contextMarkdown: "",
  mapTick: 0,
  eadsOnly: true,
  badge: "ead",
  expanded: {},
  pfmExpanded: {},
  jobsOnly: false,
  workContextId: 0,
  owners: {},
  pfm: {},
  chrome: {},
  source: {},
}

export type EadNodeHit = { id: number; name: string; path: string }

export function expandKey(productId: number, mapId = 0, subSchemaId = 0) {
  const map = Number.isFinite(mapId) && mapId > 0 ? mapId : 0
  const sub = Number.isFinite(subSchemaId) && subSchemaId > 0 ? subSchemaId : 0
  return `${productId > 0 ? productId : 0}:${map}:${sub}`
}

function normalizeApi(url: string) {
  return url
    .trim()
    .replace(/\/+$/, "")
    .toLowerCase()
    .replace(/^(https?:\/\/)127\.0\.0\.1(?=:\d+|$)/, "$1localhost")
}

export const { use: useEad, provider: EadProvider } = createSimpleContext({
  name: "Ead",
  init: () => {
    bindEadHttp(usePlatform())
    const sdk = useGlobalSDK()
    const sync = useGlobalSync()
    const [store, setStore, , ready] = persisted("ead.v1", createStore<State>({ ...empty }))
    let mute = false
    const [treeTick, setTreeTick] = createSignal(0)
    // Session-only: the loaded PFM map flattened for global search, and node jump requests from it.
    const [live, setLive] = createStore({
      nodes: [] as EadNodeHit[],
      jump: undefined as { id: number; at: number } | undefined,
    })

    const flushFilters = () => {
      bindFilters(
        { owners: store.owners ?? {}, pfm: store.pfm ?? {} },
        (next) => {
          setStore("owners", next.owners)
          setStore("pfm", next.pfm)
        },
      )
    }

    // The Pilot server in use, once applied; calls that depend on it wait for this.
    const [applied, setApplied] = createSignal<Env>()
    createEffect(() => {
      if (!ready()) return
      applyEnv(store.env === "localhost" ? "localhost" : "production")
      setApplied(store.env === "localhost" ? "localhost" : "production")
      flushFilters()
      if ((store.token ?? "").trim() && !(store.tokenApiUrl ?? "").trim() && store.env === "localhost") {
        setStore("tokenApiUrl", eadApi())
      }
    })

    const drop = () => {
      setStore("token", "")
      setStore("tokenApiUrl", "")
      setStore("pilotBust", (n) => (n ?? 0) + 1)
    }

    // One renewal at a time; resolves true when the store holds a usable token afterwards.
    let renewing: Promise<boolean> | undefined
    const renewal = (token: string): Promise<boolean> => {
      const now = (store.token ?? "").trim()
      if (now !== token) return Promise.resolve(!!now)
      if (renewing) return renewing
      renewing = renew(token)
        .then((next) => {
          const now = (store.token ?? "").trim()
          if (now !== token) return !!now
          // tokenApiUrl stays: the renewal went to the same host the token is bound to.
          setStore("token", next.trim())
          return true
        })
        .catch(() => {
          const now = (store.token ?? "").trim()
          return now !== token && !!now
        })
        .finally(() => {
          renewing = undefined
        })
      return renewing
    }

    const [clock, setClock] = createSignal(0)
    const timer = setInterval(() => setClock((n) => n + 1), 30 * 60 * 1000)
    onCleanup(() => clearInterval(timer))

    createEffect(() => {
      if (!ready()) return
      clock()
      const raw = (store.token ?? "").trim()
      if (!raw) return
      const saved = normalizeApi(store.tokenApiUrl ?? "")
      const current = normalizeApi(eadApi())
      const hostMismatch = saved && saved !== current
      const unboundProduction = !saved && current.includes("eadfm.com")
      if (hostMismatch || unboundProduction) return drop()
      if (!renewDue(raw)) return
      // Renew shortly before expiry, or right away for an expired-but-renewable login.
      void renewal(raw).then((ok) => {
        if (ok || (store.token ?? "").trim() !== raw || !tokenExpired(raw)) return
        drop()
      })
    })

    let linked = ""
    let inflight = ""
    const [planTick, setPlanTick] = createSignal(0)
    // The sign-in last written for EAD plans in this run; a plan-list reload with the same one writes nothing.
    let stored: string | undefined
    createEffect(() => {
      if (!ready() || !sync.ready) return
      const key = `${(store.token ?? "").trim()}#${planTick()}`
      const token = (store.token ?? "").trim()
      const on = store.coding !== false
      const auth = sdk.client.auth
      const save = (config: Parameters<typeof sync.updateConfig>[0]) => sync.updateConfig(config)
      if (!token || !on) {
        inflight = ""
        if (!linked) return
        linked = ""
        const off = untrack(() => sync.data.config.disabled_providers)
        stored = undefined
        void dropPlan({ auth, save, disabled: off })
        return
      }
      if (linked === key || inflight === key) return
      inflight = key
      void (async () => {
        const plans = await loadPlans(token)
        if ((store.token ?? "").trim() !== token) return
        if (untrack(() => store.coding) === false) return
        if (plans.length === 0) return
        const cfg = untrack(() => sync.data.config.provider?.[PLAN])
        const off = untrack(() => sync.data.config.disabled_providers)
        await applyPlan({ token, plans, auth, save, cfg, disabled: off, stored })
        stored = token
        if ((store.token ?? "").trim() !== token) return
        if (untrack(() => store.coding) === false) return
        linked = key
      })().finally(() => {
        if (inflight === key) inflight = ""
      })
    })

    const writeChrome = () => {
      const pid = store.productId
      if (!(pid > 0)) return
      if (!store.chrome) setStore("chrome", {})
      setStore("chrome", String(pid), {
        view: store.view === "source" ? "source" : "pfm",
        badge: store.badge ?? "ead",
        eadsOnly: store.eadsOnly !== false,
        jobsOnly: store.jobsOnly === true,
        subSchemaId: store.subSchemaId ?? 0,
      })
    }

    const writeSource = () => {
      const sid = store.schemaId
      if (!(sid > 0)) return
      if (!store.source) setStore("source", {})
      setStore("source", String(sid), {
        badge: store.badge ?? "ead",
        eadsOnly: store.eadsOnly !== false,
      })
    }

    const applyChrome = (id: number) => {
      const chrome = store.chrome?.[String(id)]
      setStore("view", chrome?.view === "source" ? "source" : "pfm")
      setStore("badge", chrome?.badge ?? "ead")
      setStore("eadsOnly", chrome?.eadsOnly !== false)
      setStore("jobsOnly", chrome?.jobsOnly === true)
      setStore("subSchemaId", chrome?.subSchemaId ?? 0)
    }

    const clearSession = () => {
      setStore("productId", 0)
      setStore("productName", "")
      setStore("nodeId", 0)
      setStore("nodeName", "")
      setStore("mapId", 0)
      setStore("schemaId", 0)
      setStore("schemaName", "")
      setStore("subSchemaId", 0)
      setStore("sourceId", 0)
      setStore("sourceName", "")
      setStore("sourcePath", "")
      setStore("view", "pfm")
      setStore("eadScript", "")
      setStore("aiPrompt", "")
      setStore("contextMarkdown", "")
    }

    const token = () => {
      // Re-evaluate once the Pilot server is applied: before that, eadApi() may still be production.
      applied()
      const raw = (store.token ?? "").trim()
      if (!raw) return ""
      const saved = normalizeApi(store.tokenApiUrl ?? "")
      const current = normalizeApi(eadApi())
      if (saved && saved !== current) return ""
      // Unbound leftover tokens must not hit production (parity with Cursor authTokenApiUrl).
      if (!saved && current.includes("eadfm.com")) return ""
      return raw
    }

    // Session-only: the Shared AI Coding Server the chosen product codes on, read again when the product or the
    // sign-in changes, or when the user enables or disables a server.
    const [shared, setShared] = createSignal<ProductSharedServer>()
    const [sharedTick, setSharedTick] = createSignal(0)
    createEffect(() => {
      const t = token()
      const pid = store.productId ?? 0
      sharedTick()
      setShared(undefined)
      if (!t || !(pid > 0)) return
      const state = { live: true }
      onCleanup(() => (state.live = false))
      void loadProductSharedServer(t, pid)
        .then((info) => state.live && setShared(info))
        .catch(() => undefined)
    })

    return {
      ready,
      muted: () => mute,
      token,
      /** The chosen product's Shared AI Coding Server, or undefined when it does not use one. */
      sharedServer: shared,
      /** Read the product's Shared AI Coding Server again, e.g. after the user enabled it. */
      refreshSharedServer: () => setSharedTick((n) => n + 1),
      /** The block a chat message carries while EAD is open, telling the model about that server. */
      sharedServerPrompt: () => formatSharedServerPrompt(shared()),
      productId: () => store.productId ?? 0,
      productName: () => store.productName ?? "",
      nodeId: () => store.nodeId ?? 0,
      nodeName: () => store.nodeName ?? "",
      mapId: () => store.mapId ?? 0,
      schemaId: () => store.schemaId ?? 0,
      schemaName: () => store.schemaName ?? "",
      subSchemaId: () => store.subSchemaId ?? 0,
      sourceId: () => store.sourceId ?? 0,
      sourceName: () => store.sourceName ?? "",
      sourcePath: () => store.sourcePath ?? "",
      view: () => (store.view === "source" ? "source" : "pfm"),
      // Pilot's "cursor" mode means "embedded in a host panel" (sign-in and bridge from the host), the same as
      // before; the panel names EAD SiCode because the URL also carries host=sicode. Not a setting any more.
      pilotMode: () => "cursor" as const,
      language: (): Lang => {
        const lang = store.language
        if (lang === "en" || lang === "ja" || lang === "ko") return lang
        return "zh"
      },
      env: (): Env => (store.env === "localhost" ? "localhost" : "production"),
      /** The Pilot server actually in use; undefined until the saved settings are loaded and applied. */
      server: applied,
      mcpEntry: () => (store.mcpEntry?.trim() ? store.mcpEntry.trim() : DEFAULT_MCP_ENTRY),
      coding: () => store.coding !== false,
      pilotBust: () => store.pilotBust ?? 0,
      eadScript: () => store.eadScript ?? "",
      aiPrompt: () => store.aiPrompt ?? "",
      contextMarkdown: () => store.contextMarkdown ?? "",
      mapTick: () => store.mapTick ?? 0,
      eadsOnly: () => store.eadsOnly !== false,
      badge: () => store.badge ?? "ead",
      expanded: (schemaId: number) => store.expanded?.[String(schemaId)] ?? [],
      pfmExpanded: (key: string) => {
        if (!key) return undefined as number[] | undefined
        const hit = store.pfmExpanded?.[key]
        return Array.isArray(hit) ? hit : undefined
      },
      jobsOnly: () => store.jobsOnly === true,
      workContextId: () => store.workContextId ?? 0,
      setToken(token: string) {
        const next = token.trim()
        if (next) mute = false
        setStore("token", next)
        setStore("tokenApiUrl", next ? eadApi() : "")
      },
      clearToken() {
        mute = true
        setStore("token", "")
        setStore("tokenApiUrl", "")
        setStore("eadScript", "")
        setStore("aiPrompt", "")
        setStore("contextMarkdown", "")
      },
      signOut() {
        mute = true
        setStore("token", "")
        setStore("tokenApiUrl", "")
        clearSession()
        setStore("pilotBust", (n) => (n ?? 0) + 1)
      },
      setProduct(id: number, name: string) {
        if (store.productId === id) {
          if (name && store.productName !== name) setStore("productName", name)
          return
        }
        setStore("productId", id)
        setStore("productName", name)
        setStore("nodeId", 0)
        setStore("nodeName", "")
        setStore("mapId", 0)
        setStore("schemaId", 0)
        setStore("schemaName", "")
        setStore("sourceId", 0)
        setStore("sourceName", "")
        setStore("sourcePath", "")
        setStore("eadScript", "")
        setStore("aiPrompt", "")
        setStore("contextMarkdown", "")
        applyChrome(id)
      },
      setNode(id: number, name: string) {
        setStore("nodeId", id)
        setStore("nodeName", name)
        setStore("sourceId", 0)
        setStore("sourceName", "")
        setStore("sourcePath", "")
      },
      setSource(id: number, name: string, path = "") {
        setStore("sourceId", id)
        setStore("sourceName", name)
        setStore("sourcePath", path)
        setStore("nodeId", 0)
        setStore("nodeName", "")
      },
      setSchema(id: number, name: string) {
        setStore("schemaId", id)
        setStore("schemaName", name)
        const pref = store.source?.[String(id)]
        if (!pref || store.view !== "source") return
        setStore("badge", pref.badge ?? "ead")
        setStore("eadsOnly", pref.eadsOnly !== false)
      },
      setSubSchema(id: number) {
        setStore("subSchemaId", id)
        writeChrome()
      },
      setView(view: View) {
        setStore("view", view)
        writeChrome()
        if (view !== "source") return
        const pref = store.source?.[String(store.schemaId)]
        if (!pref) return
        setStore("badge", pref.badge ?? store.badge)
        setStore("eadsOnly", pref.eadsOnly !== false)
      },
      setEadsOnly(value: boolean) {
        setStore("eadsOnly", value)
        writeChrome()
        writeSource()
      },
      setBadge(badge: Badge) {
        setStore("badge", badge)
        writeChrome()
        writeSource()
      },
      setJobsOnly(value: boolean) {
        setStore("jobsOnly", value)
        writeChrome()
      },
      setWorkContext(id: number) {
        setStore("workContextId", Number.isFinite(id) && id > 0 ? id : 0)
      },
      setExpanded(schemaId: number, paths: string[]) {
        setStore("expanded", String(schemaId), paths)
      },
      setPfmExpanded(key: string, ids: number[]) {
        if (!key) return
        if (!store.pfmExpanded) setStore("pfmExpanded", {})
        setStore("pfmExpanded", key, ids.filter((id) => Number.isFinite(id) && id > 0))
      },
      setContext(input: { eadScript?: string; aiPrompt?: string; markdown?: string; nodeName?: string }) {
        // Keep tree selection labels; context payload may carry an EAD entity title.
        void input.nodeName
        setStore("eadScript", input.eadScript ?? "")
        setStore("aiPrompt", input.aiPrompt ?? "")
        setStore("contextMarkdown", input.markdown ?? "")
      },
      clearContext() {
        setStore("eadScript", "")
        setStore("aiPrompt", "")
        setStore("contextMarkdown", "")
      },
      setMapId(id: number) {
        setStore("mapId", id)
      },
      setLanguage(language: Lang) {
        setStore("language", language)
      },
      setEnv(next: Env) {
        const env = next === "localhost" ? "localhost" : "production"
        if (store.env === env) {
          applyEnv(env)
          return
        }
        setStore("env", env)
        applyEnv(env)
        const saved = normalizeApi(store.tokenApiUrl ?? "")
        const current = normalizeApi(eadApi())
        if (saved && saved !== current) {
          setStore("token", "")
          setStore("tokenApiUrl", "")
        }
        setStore("pilotBust", (n) => (n ?? 0) + 1)
        setStore("mapTick", (n) => (n ?? 0) + 1)
      },
      owner: () => store.owners?.[String(store.productId)] ?? { ...emptyOwner },
      pfmFilter: () => mergePfm(store.pfm?.[String(store.productId)]),
      setOwner(next: Partial<OwnerFilter>) {
        const pid = store.productId
        if (!(pid > 0)) return { ...emptyOwner }
        const merged = mergeOwner(store.owners?.[String(pid)] ?? { ...emptyOwner }, next)
        setStore("owners", String(pid), merged)
        return merged
      },
      setPfmFilter(next: Partial<PfmFilter>) {
        const pid = store.productId
        const prev = mergePfm(pid > 0 ? store.pfm?.[String(pid)] : undefined)
        const merged = mergePfm({
          ids: next.ids ?? prev.ids,
          active: next.active ?? prev.active,
          paths: next.paths ?? prev.paths,
        })
        if (pid > 0) setStore("pfm", String(pid), merged)
        return merged
      },
      sourcePref: (schemaId: number) => store.source?.[String(schemaId)],
      setSourcePref(schemaId: number, next: Partial<SourcePref>) {
        if (!(schemaId > 0)) return
        if (!store.source) setStore("source", {})
        const prev = store.source?.[String(schemaId)]
        setStore("source", String(schemaId), {
          badge: next.badge ?? prev?.badge ?? "ead",
          eadsOnly: next.eadsOnly ?? prev?.eadsOnly !== false,
        })
      },
      setMcpEntry(path: string) {
        setStore("mcpEntry", path.trim())
      },
      setCoding(on: boolean) {
        setStore("coding", on)
      },
      bumpPilot() {
        setStore("pilotBust", (n) => (n ?? 0) + 1)
      },
      /** Tries to renew this login; true when a usable token is stored afterwards. */
      renew: (token: string) => renewal(token.trim()),
      /** Re-reads the account's plans and updates the model picker. */
      refreshPlans() {
        setPlanTick((n) => n + 1)
      },
      bumpMap() {
        setStore("mapTick", (n) => (n ?? 0) + 1)
      },
      nodes: () => live.nodes,
      setNodes(nodes: EadNodeHit[]) {
        setLive("nodes", nodes)
      },
      jump: () => live.jump,
      jumpTo(id: number) {
        setLive("jump", { id, at: Date.now() })
      },
      treeTick,
      bumpTree() {
        setTreeTick((n) => n + 1)
      },
    }
  },
})
