import { full, setFull } from "@/ead/full"
import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { showToast } from "@opencode-ai/ui/toast"
import { useLayout } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import type { Sizing } from "@/pages/session/helpers"
import { resizeEadPanel } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { peekPilot, queuePilot, takePilot, watchPilot, type PilotAction } from "@/ead/actions"
import { loadContext, loadSubtreePaths, loadTeamMembers, reconcileJobs } from "@/ead/api"
import {
  applyPilotAction,
  buildPilotShellUrl,
  dropAuth,
  handlePluginMessage,
  hostClipboardCommand,
  isEadOrigin,
  openPilot,
  pingHost,
  postOwnerOptions,
  postOwnerState,
  postPfmFilterApplied,
  postPfmFilterCleared,
  postPfmFilterState,
  replyClipboard,
  replyWriteClipboard,
  replyFolder,
  replyTeamMembers,
  postCue,
  postFindApplied,
  postInjectResult,
  postMapVisible,
  postStep,
  postStepBurst,
  requestSessionSync,
  selectPfmSubSchema,
  setUiLanguage,
  syncAuth,
  syncAuthStatus,
  type SourceOpts,
} from "@/ead/bridge"
import {
  matches,
  parseBody,
  parseCue,
  parseStep,
  progress,
  result,
  PROGRESS,
  RESULT,
  SIGNAL,
  watch,
} from "@/ead/step-signal"
import { precheck } from "@/ead/precheck"
import { sendChat } from "@/ead/composer"
import { clearPfmFilter, ownerSummary, readOwner, readPfmFilter, writeOwner, writePfmFilter } from "@/ead/filters"
import { formatJobCounts, postJobResult, postJobsRefresh, postLifecycle, postTestsRefresh } from "@/ead/jobs"
import { useEad } from "@/ead/settings"
import {
  EAD_MAP_ID,
  EAD_MAP_WIDTH,
  EAD_PILOT_ID,
  EAD_PILOT_MAX,
  EAD_PILOT_MIN,
  EAD_PILOT_WIDTH,
  eadServer,
  proxyOrigin,
  rewrite,
} from "@/ead/urls"

const PING_MS = 30_000
const STALE_MS = 120_000
const COOLDOWN_MS = 45_000

function reqId(msg: Record<string, unknown>, prefix: string) {
  const id = typeof msg.requestId === "string" ? msg.requestId.trim() : ""
  return id || `${prefix}-${Date.now()}`
}

function positive(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function EadPilotPanel(props: { sizing: Sizing }) {
  const layout = useLayout()
  const { view } = useSessionLayout()
  const language = useLanguage()
  const platform = usePlatform()
  const prompt = usePrompt()
  const sdk = useSDK()
  const server = useServer()
  const ead = useEad()
  const isDesktop = createMediaQuery("(min-width: 768px)")
  const [frame, setFrame] = createSignal<HTMLIFrameElement>()
  const [beat, setBeat] = createSignal(0)
  const [reloadAt, setReloadAt] = createSignal(0)
  const [action, setAction] = createSignal<PilotAction | undefined>()
  const [alive, setAlive] = createSignal(false)
  const [shell, setShell] = createSignal("")

  const opened = layout.pluginPanel.opened(EAD_PILOT_ID)
  const width = layout.pluginPanel.width(EAD_PILOT_ID)
  const panelOpen = createMemo(() => isDesktop() && opened())
  const reviewOpen = createMemo(() => isDesktop() && view().reviewPanel.opened())
  const panelWidth = createMemo(() => (panelOpen() ? `${width()}px` : "0px"))

  createEffect(() => {
    if (panelOpen()) setAlive(true)
  })

  const linkedUnder = (paths: string[], folder: string) => {
    const root = folder.replace(/\/+$/, "")
    if (!root) return []
    return paths.filter((p) => p === root || p.startsWith(`${root}/`))
  }

  const selection = (): PilotAction | undefined => {
    if (ead.view() === "source" && ead.sourceId() > 0) {
      return {
        kind: "source",
        sourceId: ead.sourceId(),
        sourcePath: ead.sourcePath() || undefined,
        sourceName: ead.sourceName() || undefined,
        linkedPaths: linkedUnder(readPfmFilter(ead.productId()).paths, ead.sourcePath()),
      }
    }
    if (ead.nodeId() > 0) {
      return {
        kind: "pfm",
        nodeId: ead.nodeId(),
        nodeName: ead.nodeName() || undefined,
      }
    }
    return undefined
  }

  createEffect(() => {
    const url = buildPilotShellUrl({
      productId: ead.productId(),
      productName: ead.productName(),
      subSchemaId: ead.subSchemaId() || undefined,
      language: ead.language(),
      mode: ead.pilotMode(),
      bust: ead.pilotBust(),
    })
    const http = server.current?.http
    const host = http?.url || sdk.url
    const target = eadServer()
    let gone = false
    void proxyOrigin(host, target, { user: http?.username, pass: http?.password }).then((origin) => {
      if (gone) return
      setShell(rewrite(url, origin))
    })
    onCleanup(() => {
      gone = true
    })
  })

  const product = () => ({
    productId: ead.productId() || undefined,
    productName: ead.productName() || undefined,
    treeViewMode: (ead.view() === "source" ? "source" : "pfm") as "pfm" | "source",
  })

  const launch = (next: PilotAction) => {
    queuePilot(next)
    setAction(next)
    openPilot(layout.pluginPanel)
    const fire = () => applyPilotAction(frame(), next, product())
    fire()
    if (next.kind === "profile") [80, 320, 900].forEach((ms) => window.setTimeout(fire, ms))
  }

  createEffect(() => {
    const stop = watchPilot((next) => {
      if (!panelOpen()) return
      setAction(next)
      applyPilotAction(frame(), next, product())
      void takePilot()
    })
    onCleanup(stop)
  })

  const chat = async (text: string) =>
    sendChat({
      text,
      set: (next) => prompt.set(next),
    })

  const push = (el: HTMLIFrameElement | undefined) => {
    if (!el) return
    if (!ead.token()) {
      if (!ead.muted()) {
        requestSessionSync(el)
        return
      }
      dropAuth(el)
      return
    }
    syncAuth(el, ead.token())
    setUiLanguage(el, ead.language())
    requestSessionSync(el)
    pingHost(el)
    const held = action()
    const pending = held?.kind === "profile" ? held : (takePilot() ?? held ?? selection())
    // Only replay a real request. Defaulting to the AI Navigator dashboard reopened it on every sync
    // (load, sign-in, language change) until a node was selected; it opens from its own button instead.
    if (pending) {
      setAction(pending)
      applyPilotAction(el, pending, product())
    }
    const pid = ead.productId()
    if (pid > 0) {
      const owner = readOwner(pid)
      postOwnerState(el, { ...owner, summary: ownerSummary(owner, ead.language()), productId: pid })
      const filter = readPfmFilter(pid)
      postPfmFilterState(el, {
        active: filter.active,
        filterIds: filter.ids,
        pfmNodeFilterIds: filter.active ? filter.ids : [],
        pfmNodeFilterSelectionIds: filter.ids,
        pfmNodeFilterActive: filter.active,
        pfmFilterLinkedPaths: filter.paths,
        productId: pid,
      })
      const sub = ead.subSchemaId()
      selectPfmSubSchema(el, { productId: pid, subSchemaId: sub > 0 ? sub : null })
    }
  }

  const runReconcile = async (msg: Record<string, unknown>, requestId: string, el: HTMLIFrameElement | undefined) => {
    const token = ead.token()
    if (!token) throw new Error("Please log in from EAD Map before creating AI coding jobs.")
    const counts = await reconcileJobs(token, {
      pfmNodeId: positive(msg.pfmNodeId),
      sourceCodePfmNodeId: positive(msg.sourceCodePfmNodeId),
      eadEntityId: positive(msg.eadEntityId),
      parentPfmNode: typeof msg.parentPfmNode === "string" ? msg.parentPfmNode : null,
      userDescription: typeof msg.userDescription === "string" ? msg.userDescription : null,
      createTasks: msg.createTasks !== false,
      dryRun: msg.dryRun === true,
    })
    const status = formatJobCounts(counts)
    postJobResult(el, requestId, true, status)
    postJobsRefresh(el, positive(msg.pfmNodeId))
    ead.bumpMap()
    return status
  }

  createEffect(() => {
    if (!alive()) return
    const queued = peekPilot()
    if (queued) setAction(queued)
    const el = frame()
    const token = ead.token()
    const lang = ead.language()
    void token
    void lang
    setBeat(Date.now())
    let stopped = false
    const run = () => {
      if (stopped) return
      push(el)
    }
    // Keep retries short: Pilot iframe dedupes identical updates; excess retries thrash on open.
    const timers = [0, 120, 500].map((ms) => window.setTimeout(run, ms))
    onCleanup(() => {
      stopped = true
      timers.forEach((t) => window.clearTimeout(t))
    })
  })

  createEffect(() => {
    if (!panelOpen()) return
    const queued = takePilot()
    if (!queued) return
    setAction(queued)
    applyPilotAction(frame(), queued, product())
  })

  createEffect(() => {
    if (!panelOpen()) return
    const pid = ead.productId()
    if (pid <= 0) return
    const sub = ead.subSchemaId()
    const el = frame()
    if (!el) return
    selectPfmSubSchema(el, { productId: pid, subSchemaId: sub > 0 ? sub : null })
  })

  createEffect(() => {
    if (!panelOpen()) return
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      const el = frame()
      if (!el) return
      const root = document.getElementById("ead-pilot-panel")
      const active = document.activeElement
      if (!root?.contains(active) && active?.tagName !== "IFRAME") return
      if (mod && event.key === "c") {
        event.preventDefault()
        hostClipboardCommand(el, "copy")
        return
      }
      if (mod && event.key === "x") {
        event.preventDefault()
        hostClipboardCommand(el, "cut")
        return
      }
      if (mod && event.key === "v") {
        event.preventDefault()
        hostClipboardCommand(el, "paste")
        return
      }
      if (mod && event.key === "a") {
        event.preventDefault()
        hostClipboardCommand(el, "selectAll")
      }
    }
    window.addEventListener("keydown", onKey, true)
    onCleanup(() => window.removeEventListener("keydown", onKey, true))
  })

  createEffect(() => {
    if (!alive()) return
    const stepSeen = watch(200)
    const progSeen = watch(150)
    const doneSeen = watch(0)
    const pull = (path: string) =>
      sdk.client.file
        .read({ path })
        .then((res) => {
          const data = res.data
          if (!data || data.type !== "text") return ""
          return data.content || ""
        })
        .catch(() => "")
    const load = async () => {
      const el = frame()
      const [stepRaw, progRaw, doneRaw] = await Promise.all([pull(SIGNAL), pull(PROGRESS), pull(RESULT)])
      const step = parseBody(stepRaw)
      if (!step) stepSeen.miss()
      else if (stepSeen.hit(step)) postStepBurst(el, step)
      const prog = parseCue(progRaw)
      if (!prog) progSeen.miss()
      else if (progSeen.hit({ at: typeof prog.at === "string" ? prog.at : "" })) postCue(el, progress(prog))
      const done = parseCue(doneRaw)
      if (!done) doneSeen.miss()
      else if (doneSeen.hit({ at: typeof done.at === "string" ? done.at : "" })) {
        postCue(el, result(done))
        postTestsRefresh(el, typeof done.pfmNodeId === "number" ? done.pfmNodeId : null)
      }
    }
    void load()
    const stop = sdk.event.listen((evt) => {
      if (evt.details.type !== "file.watcher.updated") return
      const props =
        typeof evt.details.properties === "object" && evt.details.properties
          ? (evt.details.properties as Record<string, unknown>)
          : undefined
      const file = typeof props?.file === "string" ? props.file : ""
      if (!matches(file)) return
      void load()
    })
    const timer = window.setInterval(() => void load(), 1500)
    onCleanup(() => {
      stop()
      window.clearInterval(timer)
    })
  })

  createEffect(() => {
    if (!panelOpen()) return
    const el = frame()
    if (!el) return
    postJobsRefresh(el)
    postTestsRefresh(el, ead.nodeId() || null)
  })

  createEffect(() => {
    if (!panelOpen()) return
    const timer = window.setInterval(() => {
      const el = frame()
      if (!el) return
      pingHost(el)
      const last = beat()
      if (last <= 0) return
      const now = Date.now()
      if (now - last <= STALE_MS) return
      if (now - reloadAt() < COOLDOWN_MS) return
      setReloadAt(now)
      setBeat(now)
      ead.bumpPilot()
    }, PING_MS)
    onCleanup(() => window.clearInterval(timer))
  })

  createEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isEadOrigin(event.origin)) return
      const data = event.data
      if (!data || typeof data !== "object") return
      const el = frame()
      const msg = data as Record<string, unknown>

      handlePluginMessage(msg, {
        setToken: (token) => {
          if (ead.muted()) return
          ead.setToken(token)
        },
        setNode: (id, name) => {
          ead.setView("pfm")
          ead.setNode(id, name)
          const token = ead.token()
          if (!token) return
          void loadContext(token, id, name).then((ctx) => {
            ead.setContext({
              nodeName: ctx.nodeName,
              eadScript: ctx.eadScript,
              aiPrompt: ctx.aiPrompt,
              markdown: ctx.markdown,
            })
          })
        },
        setWorkContext: (id) => {
          ead.setWorkContext(id)
        },
        setSource: (id, name, path) => {
          ead.setView("source")
          ead.setSource(id, name, path)
          const token = ead.token()
          if (!token) return
          void loadContext(token, id, name, undefined, "source").then((ctx) => {
            ead.setContext({
              nodeName: ctx.nodeName,
              eadScript: ctx.eadScript,
              aiPrompt: ctx.aiPrompt,
              markdown: ctx.markdown,
            })
          })
        },
        clearToken: () => ead.signOut(),
        bumpMap: () => ead.bumpMap(),
        bumpTree: () => ead.bumpTree(),
        bumpPilot: () => ead.bumpPilot(),
        setSchema: (id) => {
          if (id === ead.subSchemaId()) return
          ead.setSubSchema(id)
        },
        focusMap: () => layout.pluginPanel.open(EAD_MAP_ID, EAD_MAP_WIDTH),
        needAuth: () => {
          if (ead.token()) {
            syncAuth(el, ead.token())
            requestSessionSync(el)
            return
          }
          layout.pluginPanel.open(EAD_MAP_ID, EAD_MAP_WIDTH)
        },
        findApplied: () => {
          const pid = ead.productId()
          const path = ead.sourcePath()
          postFindApplied(el, {
            productId: pid > 0 ? pid : undefined,
            sourceId: ead.sourceId() > 0 ? ead.sourceId() : undefined,
            sourcePath: path || undefined,
            sourceName: ead.sourceName() || undefined,
            linkedPaths: linkedUnder(readPfmFilter(pid).paths, path),
          })
        },
        openPilot: () => launch({ kind: "dashboard" }),
        queueFind: (opts?: SourceOpts) =>
          launch({
            kind: "find",
            sourceId: opts?.sourceId,
            sourcePath: opts?.sourcePath,
            sourceName: opts?.sourceName,
          }),
        queueCreate: (opts?: SourceOpts) =>
          launch({
            kind: "create",
            sourceId: opts?.sourceId,
            sourcePath: opts?.sourcePath,
            sourceName: opts?.sourceName,
          }),
        queueSetup: () => launch({ kind: "setup" }),
        queueSetupSource: () => launch({ kind: "setupSource" }),
        queueMindmap: () => launch({ kind: "mindmap" }),
        fullWindow: (open) => setFull(open),
        queueCrawl: () => launch({ kind: "crawl" }),
        queueHelp: (tipId) => launch({ kind: "help", tipId }),
        syncAuth: () => {
          syncAuthStatus(el, ead.token())
          requestSessionSync(el)
        },
        noteHeartbeat: () => setBeat(Date.now()),
        stepComplete: (msg) => {
          const step = parseStep(msg)
          if (step) postStep(el, step)
        },
        bridgeReady: () => {
          setBeat(Date.now())
          push(el)
          postMapVisible(el, layout.pluginPanel.opened(EAD_MAP_ID)())
        },
        mapVisible: () => postMapVisible(el, layout.pluginPanel.opened(EAD_MAP_ID)()),
        injectAck: (ack) => postInjectResult(el, ack),
        openExternal: (url, name) => {
          if (name) {
            const win = window.open(url, name)
            if (win) {
              try {
                win.focus()
              } catch {
                /* cross-origin */
              }
              return
            }
          }
          platform.openLink(url)
        },
        openWebApp: (opts) => {
          if (opts?.openEditProduct && opts.productId && opts.productId > 0) {
            const url = new URL("https://eadfm.com/plugin/ai-code")
            url.searchParams.set("productId", String(opts.productId))
            if (opts.productName) url.searchParams.set("productName", opts.productName)
            url.searchParams.set("openEditProduct", "1")
            url.searchParams.set("host", "sicode")
            platform.openLink(url.toString())
            return
          }
          platform.openLink(eadServer())
        },
        clipboard: (requestId) => {
          void navigator.clipboard
            .readText()
            .then((text) => replyClipboard(el, requestId, { ok: true, text }))
            .catch((e) =>
              replyClipboard(el, requestId, {
                ok: false,
                message: e instanceof Error ? e.message : "Clipboard read failed.",
              }),
            )
        },
        writeClipboard: (requestId, text) => {
          void navigator.clipboard
            .writeText(text)
            .then(() => replyWriteClipboard(el, requestId, { ok: true }))
            .catch((e) =>
              replyWriteClipboard(el, requestId, {
                ok: false,
                message: e instanceof Error ? e.message : "Clipboard write failed.",
              }),
            )
        },
        chooseFolder: (requestId, pick) => {
          // Without a picker (the web build) there is no answer, so Pilot shows the folder without Choose.
          if (!platform.openDirectoryPickerDialog) return
          if (!pick) {
            replyFolder(el, requestId, "")
            return
          }
          void platform
            .openDirectoryPickerDialog({ title: language.t("ead.localRoot.choose") })
            .then((picked) => replyFolder(el, requestId, Array.isArray(picked) ? (picked[0] ?? "") : (picked ?? "")))
            .catch(() => replyFolder(el, requestId, ""))
        },
        sharedChanged: () => ead.refreshSharedServer(),
        teamMembers: (requestId, productId, token) => {
          const auth = token || ead.token()
          const pid = productId || ead.productId()
          if (!auth) {
            replyTeamMembers(el, requestId, { ok: false, message: "AUTH_PENDING", members: [] })
            return
          }
          if (pid <= 0) {
            replyTeamMembers(el, requestId, { ok: false, message: "Select a product first.", members: [] })
            return
          }
          void loadTeamMembers(auth, pid)
            .then((members) => replyTeamMembers(el, requestId, { ok: true, members }))
            .catch((e) =>
              replyTeamMembers(el, requestId, {
                ok: false,
                message: e instanceof Error ? e.message : String(e),
                members: [],
              }),
            )
        },
        inject: (text, label, requestId) => {
          void chat(text).then((ok) => {
            if (label === "injectExploreEadFunctions") {
              postInjectResult(el, {
                requestId: requestId || "",
                ok,
                submitted: false,
                message: ok
                  ? "Optimize EAD & PFM is in chat — press Send if it did not auto-submit, then finish the playbook."
                  : "Optimize EAD & PFM playbook is empty.",
              })
              return
            }
            if (label.includes("Test") || label.includes("test")) postTestsRefresh(el, ead.nodeId() || null)
            if (label === "injectAiFindApi") return
            showToast({
              title: "EAD Pilot",
              description: `${label} drafted in composer.`,
              variant: "success",
            })
          })
        },
        improveTests: (raw) => {
          void (async () => {
            const playbook = typeof raw.playbook === "string" ? raw.playbook.trim() : ""
            if (!playbook) {
              showToast({ title: "EAD", description: "Improve test cases playbook is empty.", variant: "error" })
              return
            }
            const fromNode = playbook.match(/pfmNodeId:\s*(\d+)/i)
            const fromEad = playbook.match(/eadEntityId:\s*(\d+)/i)
            const nid = positive(raw.pfmNodeId) ?? (fromNode ? Number(fromNode[1]) : null)
            const eid = positive(raw.eadEntityId) ?? (fromEad ? Number(fromEad[1]) : null)
            const block = await precheck(ead.token(), nid, eid)
            if (block) {
              showToast({ title: "EAD", description: block.reason, variant: "error" })
              postCue(el, {
                type: "improveTestCasesPreconditionBlocked",
                reason: block.reason,
                failures: block.failures,
                pfmNodeId: nid ?? undefined,
                eadEntityId: eid ?? undefined,
              })
              return
            }
            postCue(el, {
              type: "improveTestCasesPrerequisitePassed",
              pfmNodeId: nid ?? undefined,
              eadEntityId: eid ?? undefined,
              message: "Prerequisite passed. Starting Test Case AI Improve…",
            })
            await chat(playbook)
            showToast({
              title: "EAD Pilot",
              description: "Improve test cases playbook drafted in composer.",
              variant: "success",
            })
          })()
        },
        codingJobs: (raw) => {
          void (async () => {
            const requestId = reqId(raw, "cursor-ai-jobs")
            if (!ead.token() || !ead.mcpEntry()) {
              const warning = "EAD PFM MCP server is not configured/enabled. Set MCP entry in Settings → EAD."
              postLifecycle(el, requestId, "mcp_not_configured", warning)
              showToast({ title: "EAD", description: warning, variant: "error" })
              return
            }
            const playbook = typeof raw.playbook === "string" ? raw.playbook.trim() : ""
            if (!playbook) {
              postLifecycle(el, requestId, "request_rejected", "AI coding jobs request rejected: playbook is empty.")
              return
            }
            postLifecycle(el, requestId, "request_received", "AI coding jobs request received by plugin.")
            postLifecycle(el, requestId, "dispatching", "Drafting AI coding jobs request in chat...")
            await chat(playbook)
            postLifecycle(el, requestId, "drafted", "AI coding jobs request drafted in chat — review and submit.")
            if (raw.executeReconcile !== true) {
              postLifecycle(
                el,
                requestId,
                "execution_skipped",
                "AI coding jobs execution skipped (executeReconcile=false).",
              )
              return
            }
            postLifecycle(el, requestId, "executing", "Executing AI coding jobs planning via API...")
            try {
              const status = await runReconcile(raw, requestId, el)
              postLifecycle(el, requestId, "api_success", "AI coding jobs execution finished successfully.")
              showToast({ title: "EAD", description: status, variant: "success" })
            } catch (e) {
              const detail = e instanceof Error ? e.message : "Failed to reconcile AI coding jobs."
              postJobResult(el, requestId, false, detail)
              postLifecycle(el, requestId, "api_failed", `AI coding jobs execution failed: ${detail}`)
              showToast({ title: "EAD", description: detail, variant: "error" })
            }
          })()
        },
        reconcile: (raw) => {
          void (async () => {
            const requestId = reqId(raw, "cursor-ai-jobs")
            try {
              const status = await runReconcile(raw, requestId, el)
              showToast({ title: "EAD", description: status, variant: "success" })
            } catch (e) {
              const detail = e instanceof Error ? e.message : "Failed to reconcile AI coding jobs."
              postJobResult(el, requestId, false, detail)
              showToast({ title: "EAD", description: detail, variant: "error" })
            }
          })()
        },
        ownerOptions: (raw) => {
          const requestId = typeof raw.requestId === "string" ? raw.requestId : ""
          const pid = positive(raw.productId) || ead.productId()
          const token = ead.token()
          if (!token) {
            postOwnerOptions(el, requestId, { ok: false, message: "AUTH_PENDING", members: [] })
            return
          }
          if (pid <= 0) {
            postOwnerOptions(el, requestId, { ok: false, message: "Select a product first.", members: [] })
            return
          }
          void loadTeamMembers(token, pid)
            .then((members) => postOwnerOptions(el, requestId, { ok: true, members }))
            .catch((e) =>
              postOwnerOptions(el, requestId, {
                ok: false,
                message: e instanceof Error ? e.message : String(e),
                members: [],
              }),
            )
        },
        ownerFilter: (raw) => {
          const pid = positive(raw.productId) || ead.productId()
          if (pid <= 0) return
          const next = writeOwner(pid, {
            enabled: raw.enabled !== undefined ? raw.enabled === true : undefined,
            active: raw.active !== undefined ? raw.active === true : undefined,
            mode: raw.mode === "exclude" ? "exclude" : raw.mode === "include" ? "include" : undefined,
            memberEmail: typeof raw.memberEmail === "string" ? raw.memberEmail : undefined,
            memberLabel: typeof raw.memberLabel === "string" ? raw.memberLabel : undefined,
            memberEmails: Array.isArray(raw.memberEmails)
              ? raw.memberEmails.filter((x): x is string => typeof x === "string")
              : undefined,
            includeMe: raw.includeMe !== undefined ? raw.includeMe === true : undefined,
          } as Partial<ReturnType<typeof readOwner>>)
          postOwnerState(el, { ...next, summary: ownerSummary(next, ead.language()), productId: pid })
          ead.bumpMap()
        },
        pfmFilter: (raw) => {
          const pid = positive(raw.productId) || ead.productId()
          const type = String(raw.type || "")
          if (type === "clearPfmNodeFilter") {
            clearPfmFilter(pid)
            postPfmFilterCleared(el)
            ead.bumpMap()
            return
          }
          const ids = Array.isArray(raw.filterIds)
            ? raw.filterIds.flatMap((id) => {
                const n = Number(id)
                return Number.isFinite(n) && n > 0 ? [n] : []
              })
            : Array.isArray(raw.selectionIds)
              ? raw.selectionIds.flatMap((id) => {
                  const n = Number(id)
                  return Number.isFinite(n) && n > 0 ? [n] : []
                })
              : readPfmFilter(pid).ids
          const active =
            ids.length > 0 &&
            (raw.filterActive !== undefined
              ? raw.filterActive === true
              : raw.active !== undefined
                ? raw.active === true
                : true)
          const given = Array.isArray(raw.linkedPaths)
            ? raw.linkedPaths.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
            : []
          const filter = writePfmFilter(ids, active, given.length ? given : undefined, pid)
          const publish = (next: ReturnType<typeof writePfmFilter>, paths: string[]) => {
            postPfmFilterState(el, {
              active: next.active,
              filterIds: next.ids,
              pfmNodeFilterIds: next.active ? next.ids : [],
              pfmNodeFilterSelectionIds: next.ids,
              pfmNodeFilterActive: next.active,
              pfmFilterLinkedPaths: paths,
              productId: pid,
            })
            postPfmFilterApplied(el, {
              active: next.active,
              filterIds: next.ids,
              selectionIds: next.ids,
              linkedPaths: paths,
            })
            ead.bumpMap()
          }
          publish(filter, filter.paths)
          if (filter.active && !filter.paths.length && ead.token()) {
            void loadSubtreePaths(ead.token(), filter.ids).then((paths) => {
              publish(writePfmFilter(filter.ids, true, paths, pid), paths)
            })
          }
        },
      })
    }
    window.addEventListener("message", onMessage)
    onCleanup(() => window.removeEventListener("message", onMessage))
  })

  return (
    <Show when={isDesktop()}>
      <aside
        id="ead-pilot-panel"
        aria-label="EAD Pilot"
        aria-hidden={!panelOpen()}
        inert={!panelOpen()}
        class="relative min-w-0 h-full flex shrink-0 overflow-hidden bg-background-base"
        classList={{
          "pointer-events-none": !panelOpen(),
          "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
            !props.sizing.active(),
        }}
        style={{ width: panelWidth() }}
      >
        <div class="size-full flex flex-col border-r border-border-weaker-base">
          <div class="shrink-0 px-3 py-2 flex items-center justify-between border-b border-border-weaker-base gap-2">
            <span class="text-14-medium text-text-strong">EAD Pilot</span>
            <div class="flex items-center gap-1">
              <IconButton
                icon="link"
                variant="ghost"
                class="h-5 w-5"
                onClick={() => {
                  const url = buildPilotShellUrl({
                    productId: ead.productId(),
                    productName: ead.productName(),
                    subSchemaId: ead.subSchemaId() || undefined,
                    language: ead.language(),
                    mode: ead.pilotMode(),
                  })
                  window.open(url, "_blank", "noopener,noreferrer")
                }}
                aria-label="Open EAD Pilot web"
              />
              <IconButton
                icon="close-small"
                variant="ghost"
                class="h-5 w-5"
                onClick={() => layout.pluginPanel.close(EAD_PILOT_ID)}
                aria-label={language.t("common.close")}
              />
            </div>
          </div>
          {/* While Pilot shows the mind map, its frame covers the whole window (same frame, so nothing reloads). */}
          <div
            class="overflow-hidden"
            classList={{ "flex-1 min-h-0": !full(), "fixed inset-0 z-[60] bg-background-base": full() }}
          >
            <Show when={alive() && !!shell()}>
              <iframe
                ref={setFrame}
                src={shell()}
                class="size-full border-0"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
                allow="clipboard-read; clipboard-write; fullscreen"
                title="EAD Pilot"
                onLoad={() => push(frame())}
              />
            </Show>
          </div>
        </div>
        <Show when={panelOpen()}>
          <ResizeHandle
            direction="horizontal"
            edge="end"
            size={width()}
            min={EAD_PILOT_MIN}
            max={EAD_PILOT_MAX}
            onDragStart={() => props.sizing.begin()}
            onDragEnd={() => props.sizing.end()}
            onResize={(w) => {
              resizeEadPanel(layout, { id: EAD_PILOT_ID, width: w, review: reviewOpen() })
            }}
          />
        </Show>
      </aside>
    </Show>
  )
}

export function openEadPilot(layout: ReturnType<typeof useLayout>, bump?: () => void) {
  if (bump) {
    openPilot(layout.pluginPanel, bump)
    return
  }
  layout.pluginPanel.open(EAD_PILOT_ID, EAD_PILOT_WIDTH)
}
