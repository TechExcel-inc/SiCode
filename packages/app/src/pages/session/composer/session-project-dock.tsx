import { createMemo, createSignal } from "solid-js"
import { useNavigate } from "@solidjs/router"
import type { QuestionRequest, UserMessage } from "@opencode-ai/sdk/v2"
import { Button } from "@opencode-ai/ui/button"
import { DockPrompt } from "@opencode-ai/ui/dock-prompt"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { base64Encode } from "@opencode-ai/util/encode"
import { getFilename } from "@opencode-ai/util/path"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useCowork } from "@/context/cowork"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { useSync } from "@/context/sync"
import { carried, type ProjectSwitch } from "./session-project"

/**
 * Asked when the agent finds the work belongs to a project that is neither the current project nor one
 * of its related projects. Either choice starts a session there: switching makes it the current project,
 * adding keeps the current one and lists it under Related projects. A session that had only this
 * request is removed once the work has moved.
 */
export function SessionProjectDock(props: { request: QuestionRequest; target: ProjectSwitch; onSubmit: () => void }) {
  const sdk = useSDK()
  const sync = useSync()
  const globalSync = useGlobalSync()
  const layout = useLayout()
  const cowork = useCowork()
  const language = useLanguage()
  const navigate = useNavigate()
  const server = useServer()
  const [busy, setBusy] = createSignal(false)

  const name = createMemo(() => getFilename(props.target.project))
  const here = createMemo(() => sync.project?.name || getFilename(sync.project?.worktree ?? sdk.directory))
  const users = createMemo(() =>
    (sync.data.message[props.request.sessionID] ?? []).filter((item): item is UserMessage => item.role === "user"),
  )
  // Only the first request so far: the whole session moves, not just a summary of it.
  // A subagent's session never moves whole: it belongs to its parent.
  const fresh = createMemo(
    () => users().length <= 1 && !sync.data.session.find((item) => item.id === props.request.sessionID)?.parentID,
  )

  const move = async (to: "switch" | "relate") => {
    setBusy(true)
    props.onSubmit()
    const dir = props.target.project
    const first = users()[0]
    const last = users().at(-1)
    const client = sdk.createClient({ directory: dir, throwOnError: true })
    const session = await (async () => {
      globalSync.child(dir)
      const created = (await client.session.create()).data
      if (!created) throw new Error(language.t("common.requestFailed"))
      await client.session.promptAsync({
        sessionID: created.id,
        agent: last?.agent,
        model: last ? { providerID: last.model.providerID, modelID: last.model.modelID } : undefined,
        variant: last?.model.variant,
        parts: carried({
          fresh: fresh(),
          parts: first ? (sync.data.part[first.id] ?? []) : [],
          prompt: props.target.prompt,
          from: here(),
        }),
      })
      return created
    })().catch((err: unknown) => {
      setBusy(false)
      showToast({
        title: language.t("session.project.failed", { name: name() }),
        description: err instanceof Error ? err.message : String(err),
      })
    })
    if (!session) return

    await sdk.client.question.reply({ requestID: props.request.id, answers: [["moved", session.id]] }).catch(() => {})
    if (to === "switch") {
      layout.projects.open(dir)
      server.projects.touch(dir)
    } else {
      const root = server.projects.last() ?? sync.project?.worktree ?? sdk.directory
      void cowork.relateFolder(root, dir).catch(() => undefined)
    }
    navigate(`/${base64Encode(dir)}/session/${session.id}`)
    if (!fresh()) return
    const id = props.request.sessionID
    await sdk.client.session.abort({ sessionID: id }).catch(() => {})
    await sdk.client.session.delete({ sessionID: id }).catch(() => {})
  }

  return (
    <DockPrompt
      kind="permission"
      header={
        <div data-slot="permission-row" data-variant="header">
          <span data-slot="permission-icon">
            <Icon name="folder" size="normal" />
          </span>
          <div data-slot="permission-header-title">{language.t("session.project.title", { name: name() })}</div>
        </div>
      }
      footer={
        <>
          <div />
          <div data-slot="permission-footer-actions">
            <Button
              variant="ghost"
              size="normal"
              data-action="project-relate"
              onClick={() => move("relate")}
              disabled={busy()}
            >
              {language.t("session.project.relate", { name: name() })}
            </Button>
            <Button
              variant="primary"
              size="normal"
              data-action="project-switch"
              onClick={() => move("switch")}
              disabled={busy()}
            >
              {language.t("session.project.switch", { name: name() })}
            </Button>
          </div>
        </>
      }
    >
      <div data-slot="permission-row">
        <span data-slot="permission-spacer" aria-hidden="true" />
        <code class="text-12-regular text-text-base break-all">{props.target.project}</code>
      </div>
    </DockPrompt>
  )
}
