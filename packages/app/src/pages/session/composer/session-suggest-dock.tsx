import { createMemo, createSignal, For, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import type { QuestionRequest, UserMessage } from "@opencode-ai/sdk/v2"
import { Button } from "@opencode-ai/ui/button"
import { DockPrompt } from "@opencode-ai/ui/dock-prompt"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { base64Encode } from "@opencode-ai/util/encode"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { runStopSteps, stopSteps } from "@/pages/layout/active-sessions"
import {
  carried,
  type SessionSuggestion,
  type SuggestionAction,
  suggestedMessage,
  suggestedProject,
  suggestionAnswer,
  suggestionButtons,
} from "./session-project"

/**
 * Asked when the AI judges the person's message to be a new, unrelated task: start it in its own session
 * (here or in the project it names), optionally closing this one, or continue here.
 */
export function SessionSuggestDock(props: { request: QuestionRequest; suggestion: SessionSuggestion; onSubmit: () => void }) {
  const sdk = useSDK()
  const sync = useSync()
  const globalSync = useGlobalSync()
  const layout = useLayout()
  const language = useLanguage()
  const navigate = useNavigate()
  const [busy, setBusy] = createSignal(false)

  const target = createMemo(() =>
    suggestedProject(
      props.suggestion.project,
      [...layout.projects.list(), ...globalSync.data.project],
      sync.project?.worktree ?? sdk.directory,
    ),
  )
  const buttons = createMemo(() => suggestionButtons(target()?.name))

  const reply = (answers: string[][]) => sdk.client.question.reply({ requestID: props.request.id, answers })

  const keep = async () => {
    setBusy(true)
    props.onSubmit()
    await reply(suggestionAnswer({ moved: false })).catch(() => setBusy(false))
  }

  const move = async (close: boolean) => {
    setBusy(true)
    props.onSubmit()
    const dir = target()?.worktree ?? sdk.directory
    const id = props.request.sessionID
    const messages = sync.data.message[id] ?? []
    const message = suggestedMessage(props.request, messages) as UserMessage | undefined
    const client = sdk.createClient({ directory: dir, throwOnError: true })
    const session = await (async () => {
      globalSync.child(dir)
      const created = (await client.session.create()).data
      if (!created) throw new Error(language.t("common.requestFailed"))
      await client.session.promptAsync({
        sessionID: created.id,
        agent: message?.agent,
        model: message ? { providerID: message.model.providerID, modelID: message.model.modelID } : undefined,
        variant: message?.model.variant,
        system: message?.system,
        parts: carried({ fresh: true, parts: message ? (sync.data.part[message.id] ?? []) : [], prompt: "", from: "" }),
      })
      return created
    })().catch((err: unknown) => {
      setBusy(false)
      showToast({
        title: language.t("session.suggest.failed"),
        description: err instanceof Error ? err.message : String(err),
      })
    })
    if (!session) return

    await reply(suggestionAnswer({ moved: true, sessionID: session.id, directory: dir })).catch(() => {})
    navigate(`/${base64Encode(dir)}/session/${session.id}`)
    if (!close) return
    // Close this one: stop the session (and anything pending in it), then archive it. A failed stop keeps it.
    const stopped = await runStopSteps(stopSteps({ ...sync.data, directory: sdk.directory }, id), {
      rejectPermission: (requestID) => sdk.client.permission.reply({ requestID, reply: "reject" }),
      rejectQuestion: (requestID) => sdk.client.question.reject({ requestID }),
      abort: (sessionID) => sdk.client.session.abort({ sessionID }),
    })
      .then(() => true)
      .catch(() => false)
    if (!stopped) return
    await sdk.client.session.update({ sessionID: id, time: { archived: Date.now() } }).catch(() => {})
  }

  const run = (action: SuggestionAction) => {
    if (action === "continue") return keep()
    return move(action === "close")
  }

  return (
    <DockPrompt
      kind="permission"
      header={
        <div data-slot="permission-row" data-variant="header">
          <span data-slot="permission-icon">
            <Icon name="new-session" size="normal" />
          </span>
          <div data-slot="permission-header-title">
            {language.t("session.suggest.title", { title: props.suggestion.title })}
          </div>
        </div>
      }
      footer={
        <>
          <div />
          <div data-slot="permission-footer-actions" class="session-suggest-actions flex-wrap">
            <For each={buttons()}>
              {(button, index) => (
                <Button
                  variant={index() === 0 ? "primary" : "ghost"}
                  size="normal"
                  data-action={`suggest-${button.action}`}
                  onClick={() => run(button.action)}
                  disabled={busy()}
                >
                  {language.t(button.key as Parameters<typeof language.t>[0], button.params)}
                </Button>
              )}
            </For>
          </div>
        </>
      }
    >
      <Show when={props.suggestion.reason}>
        {(reason) => (
          <div data-slot="permission-row">
            <span data-slot="permission-spacer" aria-hidden="true" />
            <div data-slot="permission-hint">{reason()}</div>
          </div>
        )}
      </Show>
    </DockPrompt>
  )
}
