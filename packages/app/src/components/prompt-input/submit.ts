import type { Message, Session, SessionRoute } from "@opencode-ai/sdk/v2/client"
import { showToast } from "@opencode-ai/ui/toast"
import { base64Encode } from "@opencode-ai/util/encode"
import { getFilename } from "@opencode-ai/util/path"
import { Binary } from "@opencode-ai/util/binary"
import { useNavigate, useParams } from "@solidjs/router"
import type { Accessor } from "solid-js"
import type { FileSelection } from "@/context/file"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useLocal } from "@/context/local"
import { usePermission } from "@/context/permission"
import { useServer } from "@/context/server"
import { type ContextItem, type ImageAttachmentPart, type Prompt, usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { promptProbe } from "@/testing/prompt"
import { Identifier } from "@/utils/id"
import { Worktree as WorktreeState } from "@/utils/worktree"
import { buildRequestParts } from "./build-request-parts"
import { setCursorPosition } from "./editor-dom"
import { routable, routeFolder, routeTitle } from "./route"
import { formatServerError } from "@/utils/server-errors"
import { sessionQuestionRequest, typedAnswers } from "@/pages/session/composer/session-request-tree"
import { formatSystemPrompt } from "@/ead/api"

type PendingPrompt = {
  abort: AbortController
  cleanup: VoidFunction
}

const pending = new Map<string, PendingPrompt>()

export type FollowupDraft = {
  sessionID: string
  sessionDirectory: string
  prompt: Prompt
  context: (ContextItem & { key: string })[]
  agent: string
  model: { providerID: string; modelID: string }
  variant?: string
  system?: string
}

export type NodeContext = {
  name: string
  eadScript?: string
  aiPrompt?: string
  markdown?: string
}

function formatNodeSystemPrompt(ctx: NodeContext | string | undefined): string | undefined {
  if (!ctx) return
  if (typeof ctx === "string") return formatSystemPrompt({ name: ctx })
  return formatSystemPrompt(ctx)
}

type FollowupSendInput = {
  client: ReturnType<typeof useSDK>["client"]
  globalSync: ReturnType<typeof useGlobalSync>
  /** The project's sync, when sending from its page: the request shows at once. Without it, it shows when the server has it. */
  sync?: ReturnType<typeof useSync>
  draft: FollowupDraft
  messageID?: string
  optimisticBusy?: boolean
  before?: () => Promise<boolean> | boolean
}

const draftText = (prompt: Prompt) => prompt.map((part) => ("content" in part ? part.content : "")).join("")

const draftImages = (prompt: Prompt) => prompt.filter((part): part is ImageAttachmentPart => part.type === "image")

export async function sendFollowupDraft(input: FollowupSendInput) {
  const text = draftText(input.draft.prompt)
  const images = draftImages(input.draft.prompt)
  const [, setStore] = input.globalSync.child(input.draft.sessionDirectory)

  const setBusy = () => {
    if (!input.optimisticBusy) return
    setStore("session_status", input.draft.sessionID, { type: "busy" })
  }

  const setIdle = () => {
    if (!input.optimisticBusy) return
    setStore("session_status", input.draft.sessionID, { type: "idle" })
  }

  const wait = async () => {
    const ok = await input.before?.()
    if (ok === false) return false
    return true
  }

  const [head, ...tail] = text.split(" ")
  const cmd = head?.startsWith("/") ? head.slice(1) : undefined
  const commands = input.sync?.data.command ?? input.globalSync.child(input.draft.sessionDirectory, { bootstrap: false })[0].command ?? []
  if (cmd && commands.find((item) => item.name === cmd)) {
    setBusy()
    try {
      if (!(await wait())) {
        setIdle()
        return false
      }

      await input.client.session.command({
        sessionID: input.draft.sessionID,
        command: cmd,
        arguments: tail.join(" "),
        agent: input.draft.agent,
        model: `${input.draft.model.providerID}/${input.draft.model.modelID}`,
        variant: input.draft.variant,
        parts: images.map((attachment) => ({
          id: Identifier.ascending("part"),
          type: "file" as const,
          mime: attachment.mime,
          url: attachment.dataUrl,
          filename: attachment.filename,
        })),
      })
      return true
    } catch (err) {
      setIdle()
      throw err
    }
  }

  const messageID = input.messageID ?? Identifier.ascending("message")
  const { requestParts, optimisticParts } = buildRequestParts({
    prompt: input.draft.prompt,
    context: input.draft.context,
    images,
    text,
    sessionID: input.draft.sessionID,
    messageID,
    sessionDirectory: input.draft.sessionDirectory,
  })

  const message: Message = {
    id: messageID,
    sessionID: input.draft.sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: input.draft.agent,
    model: { ...input.draft.model, variant: input.draft.variant },
  }

  const add = () =>
    input.sync?.session.optimistic.add({
      directory: input.draft.sessionDirectory,
      sessionID: input.draft.sessionID,
      message,
      parts: optimisticParts,
    })

  const remove = () =>
    input.sync?.session.optimistic.remove({
      directory: input.draft.sessionDirectory,
      sessionID: input.draft.sessionID,
      messageID,
    })

  setBusy()
  add()

  try {
    if (!(await wait())) {
      setIdle()
      remove()
      return false
    }

    await input.client.session.promptAsync({
      sessionID: input.draft.sessionID,
      agent: input.draft.agent,
      model: input.draft.model,
      messageID,
      parts: requestParts,
      variant: input.draft.variant,
      system: input.draft.system,
    })
    return true
  } catch (err) {
    setIdle()
    remove()
    throw err
  }
}

type PromptSubmitInput = {
  info: Accessor<{ id: string } | undefined>
  imageAttachments: Accessor<ImageAttachmentPart[]>
  commentCount: Accessor<number>
  autoAccept: Accessor<boolean>
  mode: Accessor<"normal" | "shell">
  working: Accessor<boolean>
  editor: () => HTMLDivElement | undefined
  queueScroll: () => void
  promptLength: (prompt: Prompt) => number
  addToHistory: (prompt: Prompt, mode: "normal" | "shell") => void
  resetHistoryNavigation: () => void
  setMode: (mode: "normal" | "shell") => void
  setPopover: (popover: "at" | "slash" | null) => void
  currentNode: Accessor<NodeContext | string>
  newSessionWorktree?: Accessor<string | undefined>
  onNewSessionWorktreeReset?: () => void
  shouldQueue?: Accessor<boolean>
  onQueue?: (draft: FollowupDraft) => void
  onAbort?: () => void
  onSubmit?: () => void
}

type CommentItem = {
  path: string
  selection?: FileSelection
  comment?: string
  commentID?: string
  commentOrigin?: "review" | "file"
  preview?: string
}

export function createPromptSubmit(input: PromptSubmitInput) {
  const navigate = useNavigate()
  const sdk = useSDK()
  const sync = useSync()
  const globalSync = useGlobalSync()
  const local = useLocal()
  const permission = usePermission()
  const prompt = usePrompt()
  const layout = useLayout()
  const language = useLanguage()
  const params = useParams()
  const server = useServer()

  const errorMessage = (err: unknown) => {
    if (err && typeof err === "object" && "data" in err) {
      const data = (err as { data?: { message?: string } }).data
      if (data?.message) return data.message
    }
    if (err instanceof Error) return err.message
    return language.t("common.requestFailed")
  }

  const abort = async () => {
    const sessionID = params.id
    if (!sessionID) return Promise.resolve()

    globalSync.todo.set(sessionID, [])
    const [, setStore] = globalSync.child(sdk.directory)
    setStore("todo", sessionID, [])

    input.onAbort?.()

    const queued = pending.get(sessionID)
    if (queued) {
      queued.abort.abort()
      queued.cleanup()
      pending.delete(sessionID)
      return Promise.resolve()
    }
    return sdk.client.session
      .abort({
        sessionID,
      })
      .catch(() => {})
  }

  const restoreCommentItems = (items: CommentItem[]) => {
    for (const item of items) {
      prompt.context.add({
        type: "file",
        path: item.path,
        selection: item.selection,
        comment: item.comment,
        commentID: item.commentID,
        commentOrigin: item.commentOrigin,
        preview: item.preview,
      })
    }
  }

  const removeCommentItems = (items: { key: string }[]) => {
    for (const item of items) {
      prompt.context.remove(item.key)
    }
  }

  const clearContext = () => {
    for (const item of prompt.context.items()) {
      prompt.context.remove(item.key)
    }
  }

  const seed = (dir: string, info: Session) => {
    const [, setStore] = globalSync.child(dir)
    setStore("session", (list: Session[]) => {
      const result = Binary.search(list, info.id, (item) => item.id)
      const next = [...list]
      if (result.found) {
        next[result.index] = info
        return next
      }
      next.splice(result.index, 0, info)
      return next
    })
  }

  /** Where the server says a request belongs. Any failure keeps it here. */
  const route = (draft: FollowupDraft, text: string, images: ImageAttachmentPart[]) =>
    sdk.client.session
      .route({ sessionID: draft.sessionID, text, files: images.map((item) => item.filename) })
      .then((x): SessionRoute => x.data ?? { where: "here" })
      .catch((): SessionRoute => ({ where: "here" }))

  /**
   * Starts a request the server judged a new task in a session of its own (in this project or the one it
   * names) and opens it. Keep it here removes that session and sends the request where it was typed
   * (queued, when it was queued). If the new session can't start, the request goes there too.
   */
  const move = async (draft: FollowupDraft, result: SessionRoute, text: string, queued: boolean) => {
    const dir = routeFolder(result, draft.sessionDirectory)
    const same = dir === draft.sessionDirectory
    const client = sdk.createClient({ directory: dir, throwOnError: true })
    const back = async () => {
      navigate(`/${base64Encode(draft.sessionDirectory)}/session/${draft.sessionID}`)
      if (queued) return input.onQueue?.(draft)
      await sendFollowupDraft({ client: sdk.client, sync, globalSync, draft, optimisticBusy: true }).catch((err) =>
        showToast({ title: language.t("prompt.toast.promptSendFailed.title"), description: errorMessage(err) }),
      )
    }
    const session = await (async () => {
      globalSync.child(dir)
      const created = (await client.session.create()).data
      if (!created) throw new Error(language.t("common.requestFailed"))
      seed(dir, created)
      local.session.promote(dir, created.id)
      if (permission.isAutoAccepting(draft.sessionID, draft.sessionDirectory)) permission.enableAutoAccept(created.id, dir)
      if (!same) {
        layout.projects.open(dir)
        server.projects.touch(dir)
      }
      navigate(`/${base64Encode(dir)}/session/${created.id}`)
      await sendFollowupDraft({
        client,
        sync: same ? sync : undefined,
        globalSync,
        // File context points into this project, so it goes along only within it.
        draft: { ...draft, sessionID: created.id, sessionDirectory: dir, context: same ? draft.context : [] },
        optimisticBusy: true,
      })
      return created
    })().catch((err: unknown) => {
      showToast({ title: language.t("session.suggest.failed"), description: errorMessage(err) })
    })
    if (!session) return back()

    const title = routeTitle(result, text)
    showToast({
      title: same
        ? language.t("prompt.route.started", { title })
        : language.t("prompt.route.startedIn", { project: result.project ?? getFilename(dir), title }),
      duration: 10000,
      actions: [
        {
          label: language.t("prompt.route.keep"),
          onClick: () => {
            void (async () => {
              await client.session.abort({ sessionID: session.id }).catch(() => {})
              await client.session.delete({ sessionID: session.id }).catch(() => {})
              await back()
            })()
          },
        },
      ],
    })
  }

  /** `fresh` sends the request as a new session in this project, leaving the current session on screen. */
  const handleSubmit = async (event: Event, opts?: { fresh?: boolean }) => {
    event.preventDefault()
    const fresh = !!opts?.fresh && !!params.id

    const currentPrompt = prompt.current()
    const text = currentPrompt.map((part) => ("content" in part ? part.content : "")).join("")
    const images = input.imageAttachments().slice()
    const mode = input.mode()

    if (text.trim().length === 0 && images.length === 0 && input.commentCount() === 0) {
      if (input.working()) abort()
      return
    }

    // While the AI waits on a question, a typed message is the answer in the person's own words.
    const asked = params.id && !fresh ? sessionQuestionRequest(sync.data.session ?? [], sync.data.question ?? {}, params.id) : undefined
    if (asked && text.trim().length > 0) {
      input.addToHistory(currentPrompt, mode)
      input.resetHistoryNavigation()
      prompt.reset()
      await sdk.client.question
        .reply({ requestID: asked.id, answers: typedAnswers(asked, text) })
        .catch((err) => {
          prompt.set(currentPrompt, input.promptLength(currentPrompt))
          showToast({ title: language.t("common.requestFailed"), description: errorMessage(err) })
        })
      return
    }

    const currentModel = local.model.current()
    const currentAgent = local.agent.current()
    const variant = local.model.variant.current()
    if (!currentModel || !currentAgent) {
      showToast({
        title: language.t("prompt.toast.modelAgentRequired.title"),
        description: language.t("prompt.toast.modelAgentRequired.description"),
      })
      return
    }

    input.addToHistory(currentPrompt, mode)
    input.resetHistoryNavigation()
    promptProbe.start()

    const projectDirectory = sdk.directory
    const isNewSession = !params.id || fresh
    const shouldAutoAccept = isNewSession && input.autoAccept()
    const worktreeSelection = fresh ? "main" : input.newSessionWorktree?.() || "main"

    let sessionDirectory = projectDirectory
    let client = sdk.client

    if (isNewSession) {
      if (worktreeSelection === "create") {
        const createdWorktree = await client.worktree
          .create({ directory: projectDirectory })
          .then((x) => x.data)
          .catch((err) => {
            showToast({
              title: language.t("prompt.toast.worktreeCreateFailed.title"),
              description: errorMessage(err),
            })
            return undefined
          })

        if (!createdWorktree?.directory) {
          showToast({
            title: language.t("prompt.toast.worktreeCreateFailed.title"),
            description: language.t("common.requestFailed"),
          })
          return
        }
        WorktreeState.pending(createdWorktree.directory)
        sessionDirectory = createdWorktree.directory
      }

      if (worktreeSelection !== "main" && worktreeSelection !== "create") {
        sessionDirectory = worktreeSelection
      }

      if (sessionDirectory !== projectDirectory) {
        client = sdk.createClient({
          directory: sessionDirectory,
          throwOnError: true,
        })
        globalSync.child(sessionDirectory)
      }

      if (!fresh) input.onNewSessionWorktreeReset?.()
    }

    let session = fresh ? undefined : input.info()
    if (!session && isNewSession) {
      const created = await client.session
        .create()
        .then((x) => x.data ?? undefined)
        .catch((err) => {
          showToast({
            title: language.t("prompt.toast.sessionCreateFailed.title"),
            description: errorMessage(err),
          })
          return undefined
        })
      if (created) {
        seed(sessionDirectory, created)
        session = created
        if (shouldAutoAccept) permission.enableAutoAccept(session.id, sessionDirectory)
        local.session.promote(sessionDirectory, session.id)
        if (!fresh) {
          layout.handoff.setTabs(base64Encode(sessionDirectory), session.id)
          navigate(`/${base64Encode(sessionDirectory)}/session/${session.id}`)
        }
      }
    }
    if (!session) {
      showToast({
        title: language.t("prompt.toast.promptSendFailed.title"),
        description: language.t("prompt.toast.promptSendFailed.description"),
      })
      return
    }

    const model = {
      modelID: currentModel.id,
      providerID: currentModel.provider.id,
    }
    const agent = currentAgent.name
    const context = prompt.context.items().slice()
    const nodeSystem = formatNodeSystemPrompt(input.currentNode())
    const draft: FollowupDraft = {
      sessionID: session.id,
      sessionDirectory,
      prompt: currentPrompt,
      context,
      agent,
      model,
      variant,
      system: nodeSystem,
    }

    const clearInput = () => {
      prompt.reset()
      input.setMode("normal")
      input.setPopover(null)
    }

    const restoreInput = () => {
      prompt.set(currentPrompt, input.promptLength(currentPrompt))
      input.setMode(mode)
      input.setPopover(null)
      requestAnimationFrame(() => {
        const editor = input.editor()
        if (!editor) return
        editor.focus()
        setCursorPosition(editor, input.promptLength(currentPrompt))
        input.queueScroll()
      })
    }

    // A plain request in a session with earlier work is checked first: a new task moves to its own session.
    const info = (sync.data.session ?? []).find((item) => item.id === session.id)
    const check =
      !isNewSession &&
      mode === "normal" &&
      routable({
        text,
        users: (sync.data.message?.[session.id] ?? []).filter((item) => item.role === "user").length,
        parentID: info?.parentID,
        oneTime: !!info?.oneTime,
      })

    if (!isNewSession && mode === "normal" && input.shouldQueue?.()) {
      clearContext()
      clearInput()
      const result = check ? await route(draft, text, images) : undefined
      if (result && result.where !== "here") return move(draft, result, text, true)
      input.onQueue?.(draft)
      return
    }

    promptProbe.submit({ sessionID: session.id, directory: sessionDirectory })
    input.onSubmit?.()

    if (mode === "shell") {
      clearInput()
      client.session
        .shell({
          sessionID: session.id,
          agent,
          model,
          command: text,
        })
        .catch((err) => {
          showToast({
            title: language.t("prompt.toast.shellSendFailed.title"),
            description: errorMessage(err),
          })
          restoreInput()
        })
      return
    }

    if (text.startsWith("/")) {
      const [cmdName, ...args] = text.split(" ")
      const commandName = cmdName.slice(1)
      const customCommand = sync.data.command.find((c) => c.name === commandName)
      if (customCommand) {
        clearInput()
        client.session
          .command({
            sessionID: session.id,
            command: commandName,
            arguments: args.join(" "),
            agent,
            model: `${model.providerID}/${model.modelID}`,
            variant,
            parts: images.map((attachment) => ({
              id: Identifier.ascending("part"),
              type: "file" as const,
              mime: attachment.mime,
              url: attachment.dataUrl,
              filename: attachment.filename,
            })),
          })
          .catch((err) => {
            showToast({
              title: language.t("prompt.toast.commandSendFailed.title"),
              description: formatServerError(err, language.t, language.t("common.requestFailed")),
            })
            restoreInput()
          })
        return
      }
    }

    const commentItems = context.filter((item) => item.type === "file" && !!item.comment?.trim())
    const messageID = Identifier.ascending("message")

    const removeOptimisticMessage = () => {
      sync.session.optimistic.remove({
        directory: sessionDirectory,
        sessionID: session.id,
        messageID,
      })
    }

    removeCommentItems(commentItems)
    clearInput()

    const waitForWorktree = async () => {
      const worktree = WorktreeState.get(sessionDirectory)
      if (!worktree || worktree.status !== "pending") return true

      if (sessionDirectory === projectDirectory) {
        sync.set("session_status", session.id, { type: "busy" })
      }

      const controller = new AbortController()
      const cleanup = () => {
        if (sessionDirectory === projectDirectory) {
          sync.set("session_status", session.id, { type: "idle" })
        }
        removeOptimisticMessage()
        restoreCommentItems(commentItems)
        restoreInput()
      }

      pending.set(session.id, { abort: controller, cleanup })

      const abortWait = new Promise<Awaited<ReturnType<typeof WorktreeState.wait>>>((resolve) => {
        if (controller.signal.aborted) {
          resolve({ status: "failed", message: "aborted" })
          return
        }
        controller.signal.addEventListener(
          "abort",
          () => {
            resolve({ status: "failed", message: "aborted" })
          },
          { once: true },
        )
      })

      const timeoutMs = 5 * 60 * 1000
      const timer = { id: undefined as number | undefined }
      const timeout = new Promise<Awaited<ReturnType<typeof WorktreeState.wait>>>((resolve) => {
        timer.id = window.setTimeout(() => {
          resolve({
            status: "failed",
            message: language.t("workspace.error.stillPreparing"),
          })
        }, timeoutMs)
      })

      const result = await Promise.race([WorktreeState.wait(sessionDirectory), abortWait, timeout]).finally(() => {
        if (timer.id === undefined) return
        clearTimeout(timer.id)
      })
      pending.delete(session.id)
      if (controller.signal.aborted) return false
      if (result.status === "failed") throw new Error(result.message)
      return true
    }

    void sendFollowupDraft({
      client,
      sync,
      globalSync,
      draft,
      messageID,
      optimisticBusy: sessionDirectory === projectDirectory,
      before: async () => {
        if (!(await waitForWorktree())) return false
        if (!check) return true
        const result = await route(draft, text, images)
        if (result.where === "here") return true
        void move(draft, result, text, false)
        return false
      },
    }).catch((err) => {
      pending.delete(session.id)
      if (sessionDirectory === projectDirectory) {
        sync.set("session_status", session.id, { type: "idle" })
      }
      showToast({
        title: language.t("prompt.toast.promptSendFailed.title"),
        description: errorMessage(err),
      })
      removeOptimisticMessage()
      restoreCommentItems(commentItems)
      restoreInput()
    })
  }

  return {
    abort,
    handleSubmit,
  }
}
