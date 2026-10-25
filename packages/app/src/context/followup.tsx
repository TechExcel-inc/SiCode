import { createSimpleContext } from "@opencode-ai/ui/context"
import { showToast } from "@opencode-ai/ui/toast"
import { createEffect, createSignal, getOwner, onCleanup, runWithOwner } from "solid-js"
import { createStore } from "solid-js/store"
import { type FollowupDraft, sendFollowupDraft } from "@/components/prompt-input/submit"
import { workspaceKey } from "@/pages/layout/helpers"
import { setQueued } from "@/pages/session/queued"
import { Persist, persisted } from "@/utils/persist"
import { formatServerError } from "@/utils/server-errors"
import { useGlobalSDK } from "./global-sdk"
import { useGlobalSync } from "./global-sync"
import { useLanguage } from "./language"
import { useLayout } from "./layout"

export type FollowupItem = FollowupDraft & { id: string }
export type FollowupEdit = Pick<FollowupItem, "id" | "prompt" | "context">

const shape = () =>
  createStore<{
    items: Record<string, FollowupItem[] | undefined>
    failed: Record<string, string | undefined>
    paused: Record<string, boolean | undefined>
    edit: Record<string, FollowupEdit | undefined>
  }>({ items: {}, failed: {}, paused: {}, edit: {} })

/** How often the server is asked whether a session with queued requests is still working. */
const POLL = 5_000

/**
 * The queued requests of every open project. A queued request starts once its session's task ends,
 * whichever session is on screen. Whether a task ended is read from this app's live updates and, while
 * requests wait, checked against the server every few seconds, so a missed update cannot hold the
 * queue up. The queue is kept per project folder on this computer.
 */
export const { use: useFollowup, provider: FollowupProvider } = createSimpleContext({
  name: "Followup",
  init: () => {
    const globalSDK = useGlobalSDK()
    const globalSync = useGlobalSync()
    const layout = useLayout()
    const language = useLanguage()
    const owner = getOwner()
    const make = (dir: string) => persisted(Persist.workspace(dir, "followup", ["followup.v1"]), shape())
    const stores = new Map<string, ReturnType<typeof make>>()
    const [dirs, setDirs] = createSignal<string[]>([])
    // Requests being sent now, by session.
    const [sending, setSending] = createStore<Record<string, string | undefined>>({})

    const store = (dir: string) => {
      const key = workspaceKey(dir)
      const known = stores.get(key)
      if (known) return known
      const next = runWithOwner(owner, () => make(dir))!
      stores.set(key, next)
      setDirs((list) => [...list, dir])
      return next
    }

    const fail = (err: unknown) =>
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: formatServerError(err, language.t),
      })

    const client = (dir: string) => globalSDK.createClient({ directory: dir, throwOnError: true })

    const send = async (dir: string, sessionID: string, id: string, manual?: boolean) => {
      const [followup, setFollowup] = store(dir)
      const item = (followup.items[sessionID] ?? []).find((entry) => entry.id === id)
      if (!item || sending[sessionID]) return
      if (manual) setFollowup("paused", sessionID, undefined)
      setFollowup("failed", sessionID, undefined)
      setSending(sessionID, id)
      const ok = await sendFollowupDraft({
        client: client(item.sessionDirectory),
        globalSync,
        draft: item,
        optimisticBusy: true,
      }).catch((err) => {
        setFollowup("failed", sessionID, id)
        fail(err)
        return false
      })
      setSending(sessionID, undefined)
      if (!ok) return
      setFollowup("items", sessionID, (items) => (items ?? []).filter((entry) => entry.id !== id))
    }

    /** What the server says each session in `dir` is doing; sessions it leaves out are idle. */
    const status = (dir: string) =>
      globalSDK.client.session
        .status({ directory: dir })
        .then((res) => (res.data ?? {}) as Record<string, { type: string } | undefined>)
        .catch(() => undefined)

    // Sends the session's first queued request once the server confirms the task ended. A project this
    // page has not loaded has no status here yet, so the server always decides.
    const trying = new Set<string>()
    const attempt = async (dir: string, sessionID: string) => {
      if (trying.has(sessionID) || sending[sessionID]) return
      trying.add(sessionID)
      const now = await status(dir)
      trying.delete(sessionID)
      if (!now || (now[sessionID]?.type ?? "idle") !== "idle") return
      const first = store(dir)[0].items[sessionID]?.[0]
      if (first && waiting(dir).includes(sessionID)) await send(dir, sessionID, first.id)
    }

    /** True while the session's task runs or waits on the person, as this app last heard it. */
    const working = (dir: string, sessionID: string) => {
      const [data] = globalSync.child(dir, { bootstrap: false })
      if (data.permission?.[sessionID]?.length || data.question?.[sessionID]?.length) return true
      if ((data.session_status?.[sessionID] ?? { type: "idle" }).type !== "idle") return true
      return (data.message?.[sessionID] ?? []).some(
        (item) => item.role === "assistant" && typeof item.time.completed !== "number",
      )
    }

    const waiting = (dir: string) => {
      const [followup] = store(dir)
      return Object.keys(followup.items).filter((sessionID) => {
        const first = followup.items[sessionID]?.[0]
        if (!first) return false
        return followup.failed[sessionID] !== first.id && !followup.paused[sessionID]
      })
    }

    // Every open project's queue is read, so requests queued before a restart still run.
    createEffect(() => {
      for (const project of layout.projects.list()) store(project.worktree)
    })

    // Start the first queued request of each session whose task has ended.
    createEffect(() => {
      for (const dir of dirs()) {
        for (const sessionID of waiting(dir)) {
          if (sending[sessionID] || working(dir, sessionID)) continue
          void attempt(dir, sessionID)
        }
      }
    })

    // The sidebar's "N queued", for every session of every open project.
    createEffect(() => {
      for (const dir of dirs()) {
        const [followup] = store(dir)
        for (const [sessionID, items] of Object.entries(followup.items)) setQueued(sessionID, items?.length || undefined)
      }
    })

    // While requests wait, ask the server which sessions still work. A session it reports idle twice in a
    // row (so not one that is only starting) has ended even if this app missed the update: the page is
    // brought up to date and the queue moves on.
    const seen = new Set<string>()
    const check = async () => {
      for (const dir of dirs()) {
        const ids = waiting(dir)
        if (!ids.length) continue
        const now = await status(dir)
        if (!now) continue
        for (const sessionID of ids) {
          if ((now[sessionID]?.type ?? "idle") !== "idle") {
            seen.delete(sessionID)
            continue
          }
          if (!seen.has(sessionID)) {
            seen.add(sessionID)
            continue
          }
          seen.delete(sessionID)
          if (working(dir, sessionID)) await catchUp(dir, sessionID)
          void attempt(dir, sessionID)
        }
      }
    }

    /** Marks a session idle here and gives replies still shown as running the server's finished copy. */
    const catchUp = async (dir: string, sessionID: string) => {
      const [data, setData] = globalSync.child(dir, { bootstrap: false })
      setData("session_status", sessionID, { type: "idle" })
      const server = await client(dir)
        .session.messages({ sessionID })
        .then((res) => res.data ?? [])
        .catch(() => [])
      for (const [index, item] of (data.message?.[sessionID] ?? []).entries()) {
        if (item.role !== "assistant" || typeof item.time.completed === "number") continue
        const done = server.find((entry) => entry.info.id === item.id)?.info
        if (done) setData("message", sessionID, index, done)
      }
    }

    const timer = setInterval(() => void check(), POLL)
    onCleanup(() => clearInterval(timer))

    return {
      /** The queue store of the project in `dir`; the session page reads and changes it. */
      store,
      send,
      sending: (sessionID: string) => sending[sessionID],
    }
  },
})
