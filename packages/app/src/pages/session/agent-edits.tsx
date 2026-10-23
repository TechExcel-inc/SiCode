import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { getFilename } from "@opencode-ai/util/path"
import type { AssistantMessage, VcsFileDiff } from "@opencode-ai/sdk/v2"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useCowork } from "@/context/cowork"
import { useEad } from "@/ead/settings"
import { useEadSignIn } from "@/components/ead-sign-in"
import { PLAN } from "@/ead/plan"
import { githubRepo, type CoworkGatewayCost } from "@/ead/cowork"
import { estimateSessionContextBreakdown } from "@/components/session/session-context-breakdown"
import { AgentCommit } from "./agent-commit"
import { costReport } from "./agent-cost"
import { AgentCostReport, costItemTitle } from "./agent-cost-report"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { contextView, formatPercent, formatTokens, type ContextRowKey } from "./agent-context"
import { OUTPUT_GROUPS, sessionOutputs, type Output, type OutputGroup } from "./agent-outputs"
import { sessionBackground, sessionTasks, type Task } from "./agent-tasks"
import { formatDuration, modelCosts, sessionSummary, waitsFor } from "./agent-summary"

export const EDITS_WIDTH = 320

const ROW_COLOR: Record<ContextRowKey, string> = {
  messages: "#4C8DF6",
  systemTools: "#D9663A",
  mcpTools: "#3FA37A",
  systemPrompt: "#C9962E",
  skills: "#A3A19A",
  memoryFiles: "#A3A19A",
  customAgents: "#A3A19A",
  autocompactBuffer: "#6B6A66",
  freeSpace: "transparent",
}

/** Rows whose name explains itself on hover, as in Claude Code. */
const EXPLAINED = new Set<ContextRowKey>(["mcpTools", "systemPrompt", "skills", "memoryFiles", "customAgents"])

const GROUP_ICON: Record<OutputGroup, "code" | "open-file" | "photo" | "window-cursor"> = {
  code: "code",
  documents: "open-file",
  images: "photo",
  pages: "window-cursor",
}

const SHOWN = 3

const tokenTotal = (msg: AssistantMessage) =>
  msg.tokens.input + msg.tokens.output + msg.tokens.reasoning + msg.tokens.cache.read + msg.tokens.cache.write

const home = (dir: string) => dir.replace(/^\/Users\/[^/]+|^\/home\/[^/]+|^[A-Za-z]:\\Users\\[^\\]+/, "~")

function Box(props: {
  name: string
  title: string
  open: boolean
  onToggle: () => void
  right?: JSX.Element
  children?: JSX.Element
}) {
  return (
    <section data-component={`agent-panel-${props.name}`} class="rounded-xl border border-border-weak-base bg-background-base">
      <button
        type="button"
        data-action={`agent-panel-${props.name}-toggle`}
        aria-expanded={props.open}
        class="w-full h-11 px-4 flex items-center gap-1.5 text-left"
        onClick={props.onToggle}
      >
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <Icon name={props.open ? "chevron-down" : "chevron-right"} size="small" class="text-icon-weak" />
        <span class="ml-auto flex items-center gap-2 text-13-regular text-text-weak">{props.right}</span>
      </button>
      <Show when={props.open && props.children}>
        <div class="px-4 pb-3 -mt-1 flex flex-col">{props.children}</div>
      </Show>
    </section>
  )
}

function Row(props: { icon: JSX.Element; children: JSX.Element; right?: JSX.Element; title?: string }) {
  return (
    <div class="h-8 flex items-center gap-2.5 min-w-0" title={props.title}>
      <span class="shrink-0 flex items-center text-icon-weak">{props.icon}</span>
      <span class="flex-1 min-w-0 truncate text-13-regular text-text-strong">{props.children}</span>
      <Show when={props.right}>
        <span class="shrink-0 text-12-regular text-text-weak">{props.right}</span>
      </Show>
    </div>
  )
}

function List(props: { name: string; label: string; items: { name: string; tokens: number }[] }) {
  const [open, setOpen] = createSignal(false)
  return (
    <div data-component={`agent-context-list-${props.name}`}>
      <button
        type="button"
        data-action={`agent-context-list-${props.name}`}
        aria-expanded={open()}
        class="w-full h-8 flex items-center gap-2 text-left rounded-md hover:bg-surface-base-hover"
        onClick={() => setOpen(!open())}
      >
        <Icon name={open() ? "chevron-down" : "chevron-right"} size="small" class="text-icon-weak" />
        <span class="flex-1 text-13-regular text-text-strong">{props.label}</span>
        <span class="text-12-regular text-text-weak">{props.items.length}</span>
      </button>
      <Show when={open()}>
        <div class="pl-6 pb-1 flex flex-col">
          <For each={props.items}>
            {(item) => (
              <div class="h-6 flex items-center gap-2 min-w-0 text-12-regular" title={item.name}>
                <span class="flex-1 min-w-0 truncate text-text-base">{getFilename(item.name) || item.name}</span>
                <span class="shrink-0 text-text-weak">{formatTokens(item.tokens)}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

const STEP_COLOR: Record<string, string> = {
  completed: "bg-icon-success-base",
  in_progress: "bg-text-interactive-base",
  pending: "bg-icon-weak-base",
  cancelled: "bg-text-diff-delete-base",
}

function TaskItem(props: {
  task: Task
  /** The task's place in the session, the first task being 1, out of `count` tasks. */
  number: number
  count: number
  open: boolean
  onToggle: () => void
  onOpenFile: (path: string) => void
  onOpenOutput: (path: string) => void
  money: (value: number) => string
}) {
  const language = useLanguage()
  const status = () => (props.task.finished ? "done" : "open")
  return (
    <div data-component="agent-task" data-status={status()} class="flex flex-col">
      <button
        type="button"
        data-action="agent-task-toggle"
        aria-expanded={props.open}
        title={props.task.title}
        class="w-full h-8 flex items-center gap-2 min-w-0 text-left rounded-md hover:bg-surface-base-hover"
        onClick={props.onToggle}
      >
        <Icon name={props.open ? "chevron-down" : "chevron-right"} size="small" class="shrink-0 text-icon-weak" />
        <span class="flex-1 min-w-0 truncate text-13-regular text-text-strong">
          {props.task.title || language.t("agent.tasks.untitled")}
        </span>
        <span data-slot="task-number" class="shrink-0 text-12-regular text-text-weak">
          {props.number}/{props.count}
        </span>
      </button>
      <Show when={props.open}>
        <div class="pl-6 pb-2 flex flex-col gap-1">
          <For each={props.task.steps}>
            {(step) => (
              <div class="flex items-start gap-2 min-w-0">
                <span class={`shrink-0 mt-1.5 size-2 rounded-full ${STEP_COLOR[step.status] ?? "bg-icon-weak-base"}`} />
                <span
                  class="text-12-regular min-w-0"
                  classList={{
                    "text-text-strong": step.status === "in_progress",
                    "text-text-base": step.status === "pending",
                    "text-text-weak": step.status === "completed",
                    "text-text-weak line-through": step.status === "cancelled",
                  }}
                >
                  {step.content}
                </span>
              </div>
            )}
          </For>
          <Show when={props.task.documents.length > 0}>
            <div class="pt-1 text-11-regular text-text-weak">{language.t("agent.tasks.documents")}</div>
            <For each={props.task.documents}>
              {(item) => (
                <button
                  type="button"
                  data-action="agent-task-document"
                  title={item.path}
                  class="h-6 flex items-center gap-2 min-w-0 text-left rounded hover:bg-surface-base-hover"
                  onClick={() => props.onOpenOutput(item.path)}
                >
                  <Icon name={GROUP_ICON[item.group]} size="small" class="shrink-0 text-icon-weak" />
                  <span class="truncate text-12-regular text-text-strong">{getFilename(item.path)}</span>
                </button>
              )}
            </For>
          </Show>
          <Show when={props.task.code.length + props.task.elsewhere.length > 0}>
            <div class="pt-1 flex items-center gap-1.5 text-11-regular text-text-weak">
              {language.t("agent.tasks.code", { count: props.task.code.length + props.task.elsewhere.length })}
              <Show when={props.task.added > 0}>
                <span class="text-12-mono text-text-diff-add-base">+{props.task.added.toLocaleString()}</span>
              </Show>
              <Show when={props.task.removed > 0}>
                <span class="text-12-mono text-text-diff-delete-base">-{props.task.removed.toLocaleString()}</span>
              </Show>
            </div>
            <For each={props.task.code}>
              {(row) => (
                <button
                  type="button"
                  data-action="agent-task-file"
                  title={row.file}
                  class="h-6 flex items-center gap-2 min-w-0 text-left rounded hover:bg-surface-base-hover"
                  onClick={() => props.onOpenFile(row.file)}
                >
                  <FileIcon node={{ path: row.file, type: "file" }} class="size-3.5 shrink-0" />
                  <span class="flex-1 min-w-0 truncate text-12-regular text-text-strong">{getFilename(row.file)}</span>
                  <span class="shrink-0 text-11-regular">
                    <Show when={row.additions}>
                      <span class="text-text-diff-add-base">+{row.additions}</span>
                    </Show>{" "}
                    <Show when={row.deletions}>
                      <span class="text-text-diff-delete-base">-{row.deletions}</span>
                    </Show>
                  </span>
                </button>
              )}
            </For>
            <For each={props.task.elsewhere}>
              {(item) => (
                <button
                  type="button"
                  data-action="agent-task-file-elsewhere"
                  title={item.path}
                  class="h-6 flex items-center gap-2 min-w-0 text-left rounded hover:bg-surface-base-hover"
                  onClick={() => props.onOpenOutput(item.path)}
                >
                  <Icon name="code" size="small" class="shrink-0 text-icon-weak" />
                  <span class="truncate text-12-regular text-text-strong">{getFilename(item.path)}</span>
                </button>
              )}
            </For>
          </Show>
          <Show when={props.task.cost > 0}>
            <div class="pt-1 text-11-regular text-text-weak">
              {language.t("agent.context.cost", { cost: props.money(props.task.cost) })}
            </div>
          </Show>
        </div>
      </Show>
    </div>
  )
}

/**
 * The Agent view's right panel, laid out like Claude Code's: where the session works (Environment),
 * what fills the model's context window (Context), the files the AI made (Outputs), and what git has
 * not committed yet in this folder (Changes, with a reviewed commit).
 */
export function AgentEdits(props: {
  session?: string
  onOpen: (path: string) => void
  onOpenOutput: (path: string) => void
  /** Set (non-zero) to open the Changes box and scroll it into view; `onChangesFocused` clears it. */
  focusChanges?: number
  onChangesFocused?: () => void
}) {
  const language = useLanguage()
  const sdk = useSDK()
  const sync = useSync()
  const cowork = useCowork()
  const ead = useEad()
  const openSignIn = useEadSignIn()
  const dialog = useDialog()
  const [open, setOpen] = createSignal({ summary: true, context: false, tasks: true, background: true, outputs: false, changes: true })
  const toggle = (key: keyof ReturnType<typeof open>) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }))
  let panel: HTMLElement | undefined
  createEffect(() => {
    if (!props.focusChanges) return
    setOpen((prev) => ({ ...prev, changes: true }))
    requestAnimationFrame(() => {
      panel
        ?.querySelector('[data-component="agent-panel-changes"]')
        ?.scrollIntoView({ block: "start", behavior: "smooth" })
    })
    props.onChangesFocused?.()
  })
  const [shown, setShown] = createSignal<Partial<Record<OutputGroup, boolean>>>({})

  const messages = createMemo(() => (props.session ? (sync.data.message[props.session] ?? []) : []))
  const lastUser = createMemo(() => messages().findLast((msg) => msg.role === "user")?.id)
  const total = createMemo(() => {
    const msg = messages().findLast((item) => item.role === "assistant" && tokenTotal(item) > 0)
    return msg?.role === "assistant" ? tokenTotal(msg) : undefined
  })

  // The fixed parts change with the agent, model, tools and files, which are chosen per message.
  const [size] = createResource(
    () => (props.session ? { session: props.session, user: lastUser() ?? "" } : undefined),
    (input) =>
      sdk.client.session
        .context({ sessionID: input.session })
        .then((res) => res.data)
        .catch(() => undefined),
  )
  const money = (value: number) =>
    value.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: value < 0.01 && value > 0 ? 4 : 2 })

  // The conversation's own size, estimated from its text; scaled with the rest to the real count.
  const conversation = createMemo(() =>
    estimateSessionContextBreakdown({ messages: messages(), parts: sync.data.part, input: Number.MAX_SAFE_INTEGER })
      .filter((item) => item.key !== "other" && item.key !== "system")
      .reduce((sum, item) => sum + item.tokens, 0),
  )
  const view = createMemo(() => {
    const value = size.latest
    return value ? contextView(value, total(), conversation()) : undefined
  })

  const outputs = createMemo(() =>
    sessionOutputs(messages().flatMap((msg) => sync.data.part[msg.id] ?? [])),
  )
  const grouped = createMemo(() => {
    const out: Partial<Record<OutputGroup, Output[]>> = {}
    for (const item of outputs()) (out[item.group] ??= []).push(item)
    return OUTPUT_GROUPS.flatMap((group) => (out[group] ? [{ group, items: out[group]! }] : []))
  })
  const time = (value: number) => new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  /** The time alone today, with the date on other days. */
  const when = (value: number) =>
    new Date(value).toDateString() === new Date().toDateString()
      ? time(value)
      : new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })

  // The conversation shows only its most recent messages until someone scrolls up; Summary, tasks and
  // costs need the whole session, so the rest is loaded here.
  createEffect(() => {
    const id = props.session
    if (!id || !sync.session.history.more(id) || sync.session.history.loading(id)) return
    void sync.session.history.loadMore(id, 500)
  })
  const tasks = createMemo(() => sessionTasks(messages(), sync.data.part))
  // Ticks once a minute so a running session's times stay current.
  const [minute, setMinute] = createSignal(Date.now())
  const tick = setInterval(() => setMinute(Date.now()), 60_000)
  onCleanup(() => clearInterval(tick))
  // EAD plan answers have no price in the app: Pilot's AI gateway knows the real model behind each
  // one and prices it, so their cost is read from Pilot after each reply.
  const lastReply = createMemo(() => {
    const msg = messages().findLast((item) => item.role === "assistant")
    return msg?.role === "assistant" ? `${msg.id}:${msg.time.completed ?? ""}` : ""
  })
  const usesPlan = createMemo(() => messages().some((msg) => msg.role === "assistant" && msg.providerID === PLAN))
  // Read in the background with plain signals, never a resource: a resource the panel reads before its
  // first answer holds the whole session page on "Loading" until EAD Pilot replies (or times out).
  // A failed read is tried again a few times and then once a minute; until it answers, Summary says
  // it is checking, never "Not priced".
  const [stored, setStored] = createSignal<{ session: string; cost: CoworkGatewayCost }>()
  const [pilotFailed, setPilotFailed] = createSignal(false)
  const [pilotTry, setPilotTry] = createSignal(0)
  const pilot = createMemo(() => {
    const value = stored()
    return value && value.session === props.session ? value.cost : undefined
  })
  createEffect(
    on(
      () =>
        usesPlan() && props.session && cowork.api()
          ? { session: props.session, reply: lastReply(), token: ead.token(), attempt: pilotTry() }
          : undefined,
      (input) => {
        if (!input) return
        const state = { live: true }
        onCleanup(() => (state.live = false))
        void (async () => {
          for (const wait of [0, 2_000, 5_000, 10_000]) {
            if (wait) await new Promise((done) => setTimeout(done, wait))
            if (!state.live) return
            const cost = await cowork
              .api()
              ?.gatewayCost(input.session)
              .catch(() => undefined)
            if (!state.live) return
            if (cost) {
              setPilotFailed(false)
              setStored({ session: input.session, cost })
              return
            }
          }
          setPilotFailed(true)
        })()
      },
    ),
  )
  createEffect(
    on(minute, () => {
      if (pilotFailed()) setPilotTry((x) => x + 1)
    }),
  )
  const pilotWaiting = createMemo(() => usesPlan() && !pilot())
  // For EAD plan replies, EAD Pilot's records are the source of truth for time, tokens and cost.
  const recorded = createMemo(() => {
    const value = pilot()
    if (!usesPlan() || !value || value.requests === 0) return undefined
    const spans = (value.entries ?? []).flatMap((entry): [number, number][] =>
      entry.startedAt && entry.endedAt ? [[Date.parse(entry.startedAt), Date.parse(entry.endedAt)]] : [],
    )
    return { provider: PLAN, spans }
  })
  const summary = createMemo(() => {
    const now = minute()
    const parts = messages().flatMap((msg) => sync.data.part[msg.id] ?? [])
    return sessionSummary(messages(), now, waitsFor(parts, now), undefined, recorded())
  })
  const [costOpen, setCostOpen] = createSignal(false)
  // Each EAD plan request, by the task, Other work or helper agent it served.
  const costItems = createMemo(() =>
    props.session
      ? costReport(
          props.session,
          messages(),
          messages().flatMap((msg) => sync.data.part[msg.id] ?? []),
          tasks(),
          pilot()?.entries ?? [],
        )
      : [],
  )
  const appCosts = createMemo(() => modelCosts(messages(), PLAN))
  // EAD plan costs are kept by EAD Pilot; signed out, the app cannot read them, so it asks to sign in.
  const signedOut = createMemo(() => usesPlan() && !ead.token().trim())
  const signIn = () => openSignIn()
  const costText = () => {
    if (signedOut()) return language.t("agent.summary.signIn")
    const value = pilot()
    if (value && value.requests > 0) return money(summary().cost + value.costMicroUsd / 1_000_000)
    if (pilotWaiting()) return language.t(pilotFailed() ? "agent.summary.costRetry" : "agent.summary.costChecking")
    return summary().priced ? money(summary().cost) : language.t("agent.summary.notPriced")
  }
  // The newest task starts open; people can open or close any of them.
  const [taskOpen, setTaskOpen] = createSignal<Record<string, boolean>>({})
  const taskIsOpen = (task: Task, index: number) => taskOpen()[task.id] ?? index === 0
  const background = createMemo(() => sessionBackground(messages().flatMap((msg) => sync.data.part[msg.id] ?? [])))
  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    if (background().running.length === 0) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })
  const elapsed = (start: number) => {
    const seconds = Math.max(0, Math.round((now() - start) / 1000))
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  }
  const stop = (sessionID?: string) => {
    if (!sessionID) return
    void sdk.client.session.abort({ sessionID }).catch(() => undefined)
  }

  // Changes are what git would commit now in this folder (staged, unstaged and untracked files), not
  // everything the session's snapshots saw; re-read when files change, when a reply ends, and after a commit.
  const [git, { refetch: refetchChanges }] = createResource(
    () => (sync.project?.vcs === "git" ? sdk.directory : undefined),
    () =>
      sdk.client.vcs
        .diff({ mode: "git" })
        .then((res) => res.data ?? [])
        .catch(() => [] as VcsFileDiff[]),
  )
  const changes = createMemo(() => (sync.project?.vcs === "git" ? (git.latest ?? []) : []))
  let changesTimer: ReturnType<typeof setTimeout> | undefined
  const refreshChanges = () => {
    if (changesTimer) clearTimeout(changesTimer)
    changesTimer = setTimeout(() => {
      changesTimer = undefined
      void refetchChanges()
    }, 300)
  }
  const stopChanges = sdk.event.listen((evt) => {
    if (evt.details.type !== "file.watcher.updated") return
    const file = (evt.details.properties as { file?: unknown } | undefined)?.file
    if (typeof file !== "string") return
    // Inside .git only the index and HEAD matter (a commit or `git add` from a terminal).
    if (/(^|[\\/])\.git[\\/]/.test(file) && !/[\\/](index|HEAD)$/.test(file)) return
    refreshChanges()
  })
  onCleanup(() => {
    stopChanges()
    if (changesTimer) clearTimeout(changesTimer)
  })
  createEffect(
    on(
      () => (props.session ? sync.data.session_status[props.session]?.type : undefined),
      (next, prev) => {
        if (next === "idle" && prev && prev !== "idle") refreshChanges()
      },
      { defer: true },
    ),
  )
  // Files this session's replies changed (each reply's own change list), to flag the others at commit time.
  const sessionFiles = createMemo(() => [
    ...new Set(messages().flatMap((msg) => (msg.role === "user" ? (msg.summary?.diffs ?? []).map((d) => d.file) : []))),
  ])

  const added = createMemo(() => changes().reduce((sum, diff) => sum + (diff.additions ?? 0), 0))
  const removed = createMemo(() => changes().reduce((sum, diff) => sum + (diff.deletions ?? 0), 0))
  const count = (value: number) => value.toLocaleString()

  const directory = () => sdk.directory
  const repo = createMemo(() => {
    const url = sync.data.vcs?.remote_url
    return url ? githubRepo(url) : undefined
  })

  return (
    <aside
      ref={panel}
      data-component="agent-edits"
      aria-label={language.t("agent.panel.title")}
      class="shrink-0 h-full min-h-0 overflow-y-auto no-scrollbar border-l border-border-weaker-base bg-background-base"
      style={{ width: `${EDITS_WIDTH}px` }}
    >
      <div class="p-3 flex flex-col gap-3">
        <Box name="summary" title={language.t("agent.summary.title")} open={open().summary} onToggle={() => toggle("summary")}>
          <Row icon={<Icon name="folder" size="small" />} title={repo() ? `${repo()} · ${directory()}` : directory()}>
            {getFilename(directory()) || directory()}
            <span class="text-text-weak"> · {home(directory())}</span>
          </Row>
          <Show when={sync.data.vcs?.branch}>
            {(branch) => <Row icon={<Icon name="branch" size="small" />}>{branch()}</Row>}
          </Show>
          <Show when={summary().started}>
            {(started) => (
              <Row
                icon={<Icon name="status" size="small" />}
                right={formatDuration(summary().sessionMs)}
                title={new Date(started()).toLocaleString()}
              >
                {language.t("agent.summary.started", { time: when(started()) })}
              </Row>
            )}
          </Show>
          <Show when={summary().started}>
            <Row icon={<Icon name="status-active" size="small" />} right={formatDuration(summary().activeMs)}>
              {language.t("agent.summary.active")}
            </Row>
          </Show>
          <Show when={summary().started}>
            <Row
              icon={<Icon name="brain" size="small" />}
              right={signedOut() || pilotWaiting() ? "—" : formatDuration(summary().workingMs)}
              title={signedOut() ? language.t("agent.summary.signInHint") : undefined}
            >
              {language.t("agent.summary.working")}
            </Row>
          </Show>
          <button
            type="button"
            data-action="agent-summary-cost"
            aria-expanded={costOpen()}
            title={language.t(signedOut() ? "agent.summary.signInHint" : usesPlan() ? "agent.summary.costPilot" : "agent.context.cost.hint")}
            class="w-full h-8 flex items-center gap-2.5 min-w-0 text-left rounded-md hover:bg-surface-base-hover"
            onClick={() => {
              if (signedOut()) return signIn()
              if (pilotWaiting() && pilotFailed()) return void setPilotTry((x) => x + 1)
              setCostOpen(!costOpen())
            }}
          >
            <span class="shrink-0 flex items-center text-icon-weak">
              <Icon name="providers" size="small" />
            </span>
            <span class="min-w-0 truncate text-13-regular text-text-strong">{language.t("agent.summary.cost")}</span>
            <Icon name={costOpen() ? "chevron-down" : "chevron-right"} size="small" class="shrink-0 text-icon-weak" />
            <span
              class="ml-auto shrink-0 text-12-regular"
              classList={{ "text-text-weak": !signedOut(), "text-text-interactive-base": signedOut() }}
            >
              {costText()}
            </span>
          </button>
          <Show when={costOpen()}>
            <div data-component="agent-cost-breakdown" class="pl-7 pb-1 flex flex-col gap-1">
              <For each={pilot()?.models ?? []}>
                {(row) => (
                  <div class="grid grid-cols-[1fr_auto] gap-x-2 text-12-regular" title={`${row.providerId} / ${row.modelId}`}>
                    <span class="min-w-0 truncate text-text-strong">
                      {row.modelId} · {row.slotKey}
                    </span>
                    <span class="row-span-2 self-center text-text-strong">
                      {row.unpricedRequests === row.requests ? language.t("agent.summary.notPriced") : money(row.costMicroUsd / 1_000_000)}
                    </span>
                    <span class="text-11-regular text-text-weak">
                      {language.t("agent.summary.breakdownPilot", {
                        count: row.requests,
                        time: formatDuration(row.durationMs ?? 0),
                        input: formatTokens(row.promptTokens),
                        cached: formatTokens(row.cachedTokens ?? 0),
                        output: formatTokens(row.completionTokens),
                      })}
                    </span>
                  </div>
                )}
              </For>
              <For each={appCosts()}>
                {(row) => (
                  <div class="grid grid-cols-[1fr_auto] gap-x-2 text-12-regular" title={`${row.providerID} / ${row.modelID}`}>
                    <span class="min-w-0 truncate text-text-strong">{row.modelID}</span>
                    <span class="row-span-2 self-center text-text-strong">
                      {row.cost > 0 ? money(row.cost) : language.t("agent.summary.notPriced")}
                    </span>
                    <span class="text-11-regular text-text-weak">
                      {language.t("agent.summary.breakdown", {
                        count: row.replies,
                        input: formatTokens(row.input),
                        output: formatTokens(row.output),
                      })}
                    </span>
                  </div>
                )}
              </For>
              <Show when={costItems().length > 0}>
                <div data-component="agent-cost-items" class="flex flex-col pt-1">
                  <For each={costItems()}>
                    {(item) => (
                      <div class="h-6 flex items-center gap-2 text-12-regular">
                        <span class="shrink-0 text-text-weak">#{item.number}</span>
                        <span class="min-w-0 truncate text-text-strong" title={costItemTitle(item, language.t)}>
                          {costItemTitle(item, language.t)}
                        </span>
                        <span class="ml-auto shrink-0 text-text-strong">{money(item.cost)}</span>
                      </div>
                    )}
                  </For>
                </div>
                <button
                  type="button"
                  data-action="agent-cost-report"
                  class="h-6 flex items-center gap-1 text-left text-12-regular text-text-interactive-base"
                  onClick={() =>
                    dialog.show(() => (
                      <AgentCostReport
                        session={sync.session.get(props.session!)?.title || props.session!}
                        items={costItems()}
                        total={(pilot()?.costMicroUsd ?? 0) / 1_000_000}
                        untimed={pilot()?.untimedRequests ?? 0}
                        money={money}
                      />
                    ))
                  }
                >
                  {language.t("agent.cost.view")}
                </button>
              </Show>
              <Show when={usesPlan()}>
                <div class="text-11-regular text-text-weak">
                  {(pilot()?.models?.length ?? 0) > 0
                    ? language.t("agent.summary.costPilot")
                    : language.t("agent.summary.noPilotCost")}
                </div>
              </Show>
            </div>
          </Show>
        </Box>

        <Box
          name="context"
          title={language.t("agent.context.title")}
          open={open().context}
          onToggle={() => toggle("context")}
          right={
            <Show when={view()}>
              {(value) => (
                  <span class="flex items-center gap-2">
                    <span>{Math.round(value().percent)}%</span>
                    <span class="w-11 h-3.5 rounded-full bg-surface-base border border-border-weak-base relative overflow-hidden">
                      <span
                        class="absolute left-0.5 top-0.5 bottom-0.5 rounded-full"
                        style={{ background: ROW_COLOR.messages, width: `max(8px, ${Math.min(100, value().percent)}%)` }}
                      />
                    </span>
                  </span>
              )}
            </Show>
          }
        >
          <Show
            when={view()}
            fallback={<div class="py-1 text-12-regular text-text-weak">{language.t("agent.context.loading")}</div>}
          >
            {(value) => (
              <>
                <div class="flex items-baseline">
                  <span class="text-14-medium text-text-strong">
                    {language.t("agent.context.used", { percent: Math.round(value().percent) })}
                  </span>
                  <span class="ml-auto text-12-regular text-text-weak">
                    {formatTokens(value().used)} / {value().limit ? formatTokens(value().limit) : "?"}
                  </span>
                </div>
                <div class="mt-2 mb-2 h-1.5 rounded-full bg-surface-base flex overflow-hidden">
                  <For each={value().rows.filter((row) => row.key !== "freeSpace")}>
                    {(row) => <span style={{ width: `${row.percent}%`, background: ROW_COLOR[row.key] }} />}
                  </For>
                </div>
                <For each={value().rows}>
                  {(row) => {
                    const label = (
                      <span
                        classList={{ "underline decoration-dotted underline-offset-4 decoration-text-weak": EXPLAINED.has(row.key) }}
                      >
                        {language.t(`agent.context.${row.key}`)}
                      </span>
                    )
                    return (
                      <div data-row={row.key} class="h-7 grid grid-cols-[12px_1fr_auto_42px] gap-x-2.5 items-center text-13-regular">
                        <span
                          class="size-3 rounded-[3px]"
                          classList={{ "border border-border-weak-base": row.key === "freeSpace" }}
                          style={{ background: ROW_COLOR[row.key] }}
                        />
                        <span class="min-w-0 truncate text-text-strong">
                          <Show when={EXPLAINED.has(row.key)} fallback={label}>
                            <Tooltip placement="left" value={language.t(`agent.context.${row.key}.hint`)}>
                              {label}
                            </Tooltip>
                          </Show>
                        </span>
                        <span class="text-right text-text-weak">{formatTokens(row.tokens)}</span>
                        <span class="text-right text-text-strong">{value().limit ? formatPercent(row.percent) : "—"}</span>
                      </div>
                    )
                  }}
                </For>
                <div class="mt-2">
                  <List name="mcp" label={language.t("agent.context.mcpTools")} items={size.latest?.mcpToolList ?? []} />
                  <List name="memory" label={language.t("agent.context.memoryFiles")} items={size.latest?.memoryFileList ?? []} />
                  <List name="agents" label={language.t("agent.context.customAgents")} items={size.latest?.customAgentList ?? []} />
                </div>
              </>
            )}
          </Show>
        </Box>

        <Box
          name="tasks"
          title={language.t("agent.tasks.title")}
          open={open().tasks}
          onToggle={() => toggle("tasks")}
          right={<span>{tasks().length}</span>}
        >
          <Show
            when={tasks().length > 0}
            fallback={<div class="py-1 text-12-regular text-text-weak">{language.t("agent.tasks.empty")}</div>}
          >
            <For each={tasks()}>
              {(task, index) => (
                <TaskItem
                  task={task}
                  number={tasks().length - index()}
                  count={tasks().length}
                  open={taskIsOpen(task, index())}
                  onToggle={() => setTaskOpen((prev) => ({ ...prev, [task.id]: !taskIsOpen(task, index()) }))}
                  onOpenFile={props.onOpen}
                  onOpenOutput={props.onOpenOutput}
                  money={money}
                />
              )}
            </For>
          </Show>
        </Box>

        <Box
          name="outputs"
          title={language.t("agent.outputs.title")}
          open={open().outputs}
          onToggle={() => toggle("outputs")}
          right={<span>{outputs().length}</span>}
        >
          <Show
            when={outputs().length > 0}
            fallback={<div class="py-1 text-12-regular text-text-weak">{language.t("agent.outputs.empty")}</div>}
          >
            <For each={grouped()}>
              {(entry) => {
                const more = () => entry.items.length - SHOWN
                const items = () => (shown()[entry.group] ? entry.items : entry.items.slice(0, SHOWN))
                return (
                  <div class="flex flex-col">
                    <div class="pt-2 pb-0.5 flex text-12-regular text-text-weak">
                      {language.t(`agent.outputs.${entry.group}`)}
                      <span class="ml-auto">{entry.items.length}</span>
                    </div>
                    <For each={items()}>
                      {(item) => (
                        <button
                          type="button"
                          data-action="agent-output-open"
                          title={item.path}
                          class="w-full h-8 flex items-center gap-2.5 min-w-0 text-left rounded-md hover:bg-surface-base-hover"
                          onClick={() => props.onOpenOutput(item.path)}
                        >
                          <Icon name={GROUP_ICON[item.group]} size="small" class="shrink-0 text-icon-weak" />
                          <span class="flex-1 min-w-0 truncate text-13-regular text-text-strong">{getFilename(item.path)}</span>
                          <span class="shrink-0 text-12-regular text-text-weak">{time(item.time)}</span>
                        </button>
                      )}
                    </For>
                    <Show when={more() > 0 && !shown()[entry.group]}>
                      <button
                        type="button"
                        data-action="agent-output-more"
                        class="h-7 pl-7 text-left text-12-regular text-text-weak hover:text-text-base"
                        onClick={() => setShown((prev) => ({ ...prev, [entry.group]: true }))}
                      >
                        {language.t("agent.outputs.more", { count: more() })}
                      </button>
                    </Show>
                  </div>
                )
              }}
            </For>
          </Show>
        </Box>

        <Box
          name="changes"
          title={language.t("agent.changes.title")}
          open={open().changes}
          onToggle={() => toggle("changes")}
          right={
            <Show when={!open().changes && changes().length > 0}>
              <Show when={added() > 0}>
                <span class="text-12-mono text-text-diff-add-base">+{count(added())}</span>
              </Show>
              <Show when={removed() > 0}>
                <span class="text-12-mono text-text-diff-delete-base">-{count(removed())}</span>
              </Show>
            </Show>
          }
        >
          <Show
            when={changes().length > 0}
            fallback={<div class="py-1 text-12-regular text-text-weak">{language.t("agent.changes.none")}</div>}
          >
            <div class="h-8 flex items-center gap-2 text-12-mono">
              <Icon name="review" size="small" class="text-icon-weak" />
              <Show when={added() > 0}>
                <span class="text-text-diff-add-base">+{count(added())}</span>
              </Show>
              <Show when={removed() > 0}>
                <span class="text-text-diff-delete-base">-{count(removed())}</span>
              </Show>
              <span class="ml-auto text-12-regular text-text-weak">
                {language.t("agent.edits.files", { count: changes().length })}
              </span>
            </div>
            <div class="max-h-64 overflow-y-auto no-scrollbar flex flex-col">
              <For each={changes()}>
                {(diff) => (
                  <button
                    type="button"
                    data-action="agent-edit-file"
                    title={diff.file}
                    class="w-full h-8 min-w-0 px-1 rounded-md flex items-center gap-2 text-left hover:bg-surface-base-hover"
                    onClick={() => props.onOpen(diff.file)}
                  >
                    <FileIcon node={{ path: diff.file, type: "file" }} class="size-4 shrink-0" />
                    <span class="flex-1 min-w-0 truncate text-13-regular text-text-strong">{getFilename(diff.file)}</span>
                    <span class="shrink-0 flex items-center gap-1 text-12-mono">
                      <Show when={diff.binary}>
                        <span class="text-12-regular text-text-weak">{language.t("agent.review.binary")}</span>
                      </Show>
                      <Show when={diff.additions}>
                        <span class="text-text-diff-add-base">+{diff.additions}</span>
                      </Show>
                      <Show when={diff.deletions}>
                        <span class="text-text-diff-delete-base">-{diff.deletions}</span>
                      </Show>
                    </span>
                  </button>
                )}
              </For>
            </div>
          </Show>
          <AgentCommit
            session={props.session}
            diffs={changes}
            sessionFiles={sessionFiles}
            onCommitted={() => void refetchChanges()}
            inline
          />
        </Box>

        <Show when={background().running.length + background().finished > 0}>
          <Box
            name="background"
            title={language.t("agent.background.title")}
            open={open().background}
            onToggle={() => toggle("background")}
            right={
              <Show when={background().running.length > 0}>
                <span>{background().running.length}</span>
              </Show>
            }
          >
            <For each={background().running}>
              {(job) => (
                <div data-component="agent-background-job" class="h-8 flex items-center gap-2.5 min-w-0">
                  <Icon name="task" size="small" class="shrink-0 text-icon-weak" />
                  <span class="flex-1 min-w-0 truncate text-13-regular text-text-strong" title={job.title}>
                    {job.title}
                  </span>
                  <span class="shrink-0 text-12-regular text-text-weak">{elapsed(job.started)}</span>
                  <Show when={job.sessionID}>
                    <button
                      type="button"
                      data-action="agent-background-stop"
                      aria-label={language.t("agent.background.stop")}
                      title={language.t("agent.background.stop")}
                      class="shrink-0 size-6 flex items-center justify-center rounded hover:bg-surface-base-hover"
                      onClick={() => stop(job.sessionID)}
                    >
                      <Icon name="stop" size="small" class="text-icon-weak" />
                    </button>
                  </Show>
                </div>
              )}
            </For>
            <Show when={background().finished > 0}>
              <div class="h-8 flex items-center gap-2.5 text-13-regular text-text-weak">
                <Icon name="check" size="small" class="shrink-0 text-icon-weak" />
                {language.t("agent.background.finished", { count: background().finished })}
              </div>
            </Show>
          </Box>
        </Show>
      </div>
    </aside>
  )
}
