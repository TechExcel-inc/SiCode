import {
  AssistantMessage,
  type SnapshotFileDiff,
  Message as MessageType,
  Part as PartType,
} from "@opencode-ai/sdk/v2/client"
import type { SessionStatus } from "@opencode-ai/sdk/v2"
import { useData } from "../context"
import { useFileComponent } from "../context/file"

import { Binary } from "@opencode-ai/util/binary"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { createEffect, createMemo, createSignal, For, type JSX, on, onCleanup, ParentProps, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic, Portal } from "solid-js/web"
import { AssistantParts, Message, MessageDivider, type TurnFilesAction, type UserActions } from "./message-part"
import { Card } from "./card"
import { Accordion } from "./accordion"
import { StickyAccordionHeader } from "./sticky-accordion-header"
import { DiffChanges } from "./diff-changes"
import { Icon } from "./icon"
import { TextShimmer } from "./text-shimmer"
import { Spinner } from "./spinner"
import { SessionRetry } from "./session-retry"
import { TextReveal } from "./text-reveal"
import { createAutoScroll } from "../hooks"
import { useI18n } from "../context/i18n"
import { normalize } from "./session-diff"
import {
  checklistFolds,
  checklistProgress,
  currentAction,
  elapsedParts,
  latestChecklist,
  taskName,
  runningHelpers,
  doneActions,
  type TurnStep,
} from "./session-turn-activity"
import type { UiI18nKey } from "../context/i18n"

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function unwrap(message: string) {
  const text = message.replace(/^Error:\s*/, "").trim()

  const parse = (value: string) => {
    try {
      return JSON.parse(value) as unknown
    } catch {
      return undefined
    }
  }

  const read = (value: string) => {
    const first = parse(value)
    if (typeof first !== "string") return first
    return parse(first.trim())
  }

  let json = read(text)

  if (json === undefined) {
    const start = text.indexOf("{")
    const end = text.lastIndexOf("}")
    if (start !== -1 && end > start) {
      json = read(text.slice(start, end + 1))
    }
  }

  if (!record(json)) return message

  const err = record(json.error) ? json.error : undefined
  if (err) {
    const type = typeof err.type === "string" ? err.type : undefined
    const msg = typeof err.message === "string" ? err.message : undefined
    if (type && msg) return `${type}: ${msg}`
    if (msg) return msg
    if (type) return type
    const code = typeof err.code === "string" ? err.code : undefined
    if (code) return code
  }

  const msg = typeof json.message === "string" ? json.message : undefined
  if (msg) return msg

  const reason = typeof json.error === "string" ? json.error : undefined
  if (reason) return reason

  return message
}

function same<T>(a: readonly T[], b: readonly T[]) {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((x, i) => x === b[i])
}

function list<T>(value: T[] | undefined | null, fallback: T[]) {
  if (Array.isArray(value)) return value
  return fallback
}

function clean(value: string) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/[*_~]+/g, "")
    .trim()
}

function heading(text: string) {
  const markdown = text.replace(/\r\n?/g, "\n")

  const html = markdown.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)
  if (html?.[1]) {
    const value = clean(html[1].replace(/<[^>]+>/g, " "))
    if (value) return value
  }

  const atx = markdown.match(/^\s{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/m)
  if (atx?.[1]) {
    const value = clean(atx[1])
    if (value) return value
  }

  const setext = markdown.match(/^([^\n]+)\n(?:=+|-+)\s*$/m)
  if (setext?.[1]) {
    const value = clean(setext[1])
    if (value) return value
  }

  const strong = markdown.match(/^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*$/m)
  if (strong?.[1]) {
    const value = clean(strong[1])
    if (value) return value
  }
}

export function SessionTurn(
  props: ParentProps<{
    sessionID: string
    messageID: string
    messages?: MessageType[]
    actions?: UserActions
    showReasoningSummaries?: boolean
    shellToolDefaultOpen?: boolean
    editToolDefaultOpen?: boolean
    active?: boolean
    status?: SessionStatus
    /** The steps show in the task step box above the composer instead of inside this reply. */
    checklistDocked?: boolean
    /** While docked, the live line (current action, elapsed time, helpers, retries) goes below the box. */
    liveMount?: { below?: HTMLElement }
    onUserInteracted?: () => void
    classes?: {
      root?: string
      content?: string
      container?: string
    }
  }>,
) {
  const data = useData()
  const i18n = useI18n()
  const fileComponent = useFileComponent()

  const emptyMessages: MessageType[] = []
  const emptyParts: PartType[] = []
  const emptyAssistant: AssistantMessage[] = []
  const emptyDiffs: SnapshotFileDiff[] = []
  const idle = { type: "idle" as const }

  const allMessages = createMemo(() => props.messages ?? list(data.store.message?.[props.sessionID], emptyMessages))

  const messageIndex = createMemo(() => {
    const messages = allMessages() ?? emptyMessages
    const result = Binary.search(messages, props.messageID, (m) => m.id)

    const index = result.found ? result.index : messages.findIndex((m) => m.id === props.messageID)
    if (index < 0) return -1

    const msg = messages[index]
    if (!msg || msg.role !== "user") return -1

    return index
  })

  const message = createMemo(() => {
    const index = messageIndex()
    if (index < 0) return undefined

    const messages = allMessages() ?? emptyMessages
    const msg = messages[index]
    if (!msg || msg.role !== "user") return undefined

    return msg
  })

  const pending = createMemo(() => {
    if (typeof props.active === "boolean") return
    const messages = allMessages() ?? emptyMessages
    return messages.findLast(
      (item): item is AssistantMessage => item.role === "assistant" && typeof item.time.completed !== "number",
    )
  })

  const pendingUser = createMemo(() => {
    const item = pending()
    if (!item?.parentID) return
    const messages = allMessages() ?? emptyMessages
    const result = Binary.search(messages, item.parentID, (m) => m.id)
    const msg = result.found ? messages[result.index] : messages.find((m) => m.id === item.parentID)
    if (!msg || msg.role !== "user") return
    return msg
  })

  const active = createMemo(() => {
    if (typeof props.active === "boolean") return props.active
    const msg = message()
    const parent = pendingUser()
    if (!msg || !parent) return false
    return parent.id === msg.id
  })

  const parts = createMemo(() => {
    const msg = message()
    if (!msg) return emptyParts
    return list(data.store.part?.[msg.id], emptyParts)
  })

  const compaction = createMemo(() => parts().find((part) => part.type === "compaction"))

  const diffs = createMemo(() => {
    const files = message()?.summary?.diffs
    if (!files?.length) return emptyDiffs

    const seen = new Set<string>()
    return files
      .reduceRight<SnapshotFileDiff[]>((result, diff) => {
        if (seen.has(diff.file)) return result
        seen.add(diff.file)
        result.push(diff)
        return result
      }, [])
      .reverse()
  })
  const MAX_FILES = 10
  const edited = createMemo(() => diffs().length)
  const [state, setState] = createStore({
    showAll: false,
    expanded: [] as string[],
  })
  const showAll = () => state.showAll
  const expanded = () => state.expanded
  const overflow = createMemo(() => Math.max(0, edited() - MAX_FILES))
  const visible = createMemo(() => (showAll() ? diffs() : diffs().slice(0, MAX_FILES)))
  const runFilesAction = (action: TurnFilesAction) => {
    const msg = message()
    if (!msg) return
    void action({ sessionID: props.sessionID, messageID: msg.id, files: diffs().map((diff) => diff.file) })
  }
  const toggleAll = () => {
    autoScroll.pause()
    setState("showAll", !showAll())
  }

  const assistantMessages = createMemo(
    () => {
      const msg = message()
      if (!msg) return emptyAssistant

      const messages = allMessages() ?? emptyMessages
      const index = messageIndex()
      if (index < 0) return emptyAssistant

      const result: AssistantMessage[] = []
      for (let i = index + 1; i < messages.length; i++) {
        const item = messages[i]
        if (!item) continue
        if (item.role === "user") break
        if (item.role === "assistant" && item.parentID === msg.id) result.push(item as AssistantMessage)
      }
      return result
    },
    emptyAssistant,
    { equals: same },
  )

  const interrupted = createMemo(() => assistantMessages().some((m) => m.error?.name === "MessageAbortedError"))
  const divider = createMemo(() => {
    if (compaction()) return i18n.t("ui.messagePart.compaction")
    if (interrupted()) return i18n.t("ui.message.interrupted")
    return ""
  })
  const error = createMemo(
    () => assistantMessages().find((m) => m.error && m.error.name !== "MessageAbortedError")?.error,
  )
  const showAssistantCopyPartID = createMemo(() => {
    const messages = assistantMessages()

    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (!message) continue

      const parts = list(data.store.part?.[message.id], emptyParts)
      for (let j = parts.length - 1; j >= 0; j--) {
        const part = parts[j]
        if (!part || part.type !== "text" || !part.text?.trim()) continue
        return part.id
      }
    }

    return undefined
  })
  const errorText = createMemo(() => {
    const msg = error()?.data?.message
    if (typeof msg === "string") return unwrap(msg)
    if (msg === undefined || msg === null) return ""
    return unwrap(String(msg))
  })

  const status = createMemo(() => {
    if (props.status !== undefined) return props.status
    if (typeof props.active === "boolean" && !props.active) return idle
    return data.store.session_status[props.sessionID] ?? idle
  })
  const working = createMemo(() => status().type !== "idle" && active())
  const showReasoningSummaries = createMemo(() => props.showReasoningSummaries ?? true)

  const assistantCopyPartID = createMemo(() => {
    if (working()) return null
    return showAssistantCopyPartID() ?? null
  })
  const turnDurationMs = createMemo(() => {
    const start = message()?.time.created
    if (typeof start !== "number") return undefined

    const end = assistantMessages().reduce<number | undefined>((max, item) => {
      const completed = item.time.completed
      if (typeof completed !== "number") return max
      if (max === undefined) return completed
      return Math.max(max, completed)
    }, undefined)

    if (typeof end !== "number") return undefined
    if (end < start) return undefined
    return end - start
  })
  const turnParts = createMemo(() =>
    assistantMessages().flatMap((message) => list(data.store.part?.[message.id], emptyParts)),
  )
  // Only the thinking since the last tool call: an older heading would name a step that is long done.
  const reasoningHeading = createMemo(() =>
    turnParts().reduce<string | undefined>((reason, part) => {
      if (part.type === "tool") return undefined
      if (part.type !== "reasoning" || !part.text) return reason
      return heading(part.text) ?? reason
    }, undefined),
  )
  const checklist = createMemo(() => latestChecklist(turnParts()))
  const docked = createMemo(() => !!props.checklistDocked && !!props.liveMount?.below)
  const live = createMemo(() => {
    if (!working() || !!error()) return false
    return status().type !== "retry"
  })
  const action = createMemo(() => (live() ? currentAction(turnParts()) : undefined))
  const actionText = createMemo(() => {
    const value = action()
    if (!value) return i18n.t("ui.sessionTurn.status.thinking")
    return i18n.t(value.key as UiI18nKey, value.params)
  })
  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    if (!live()) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })
  const liveStatus = createMemo(() => {
    const items: string[] = []
    const helpers = runningHelpers(turnParts())
    if (helpers > 0)
      items.push(
        i18n.t(helpers === 1 ? "ui.sessionTurn.live.helpers.one" : "ui.sessionTurn.live.helpers.other", {
          count: String(helpers),
        }),
      )
    const done = doneActions(turnParts())
    if (done > 0)
      items.push(
        i18n.t(done === 1 ? "ui.sessionTurn.live.done.one" : "ui.sessionTurn.live.done.other", {
          count: String(done),
        }),
      )
    const start = message()?.time.created
    if (typeof start === "number") {
      const elapsed = elapsedParts(now() - start)
      items.push(i18n.t(elapsed.key as UiI18nKey, elapsed.params))
    }
    return items.join(" \u00B7 ")
  })

  const autoScroll = createAutoScroll({
    working,
    onUserInteracted: props.onUserInteracted,
    overflowAnchor: "dynamic",
  })

  return (
    <div data-component="session-turn" class={props.classes?.root}>
      <div
        ref={autoScroll.scrollRef}
        onScroll={autoScroll.handleScroll}
        data-slot="session-turn-content"
        class={props.classes?.content}
      >
        <div onClick={autoScroll.handleInteraction}>
          <Show when={message()}>
            <div
              ref={autoScroll.contentRef}
              data-message={message()!.id}
              data-slot="session-turn-message-container"
              class={props.classes?.container}
            >
              <div data-slot="session-turn-message-content" aria-live="off">
                <Message message={message()!} parts={parts()} actions={props.actions} />
              </div>
              <Show when={divider()}>
                <div data-slot="session-turn-compaction">
                  <MessageDivider label={divider()} />
                </div>
              </Show>
              <Show when={assistantMessages().length > 0}>
                <div data-slot="session-turn-assistant-content" aria-hidden={working()}>
                  <AssistantParts
                    messages={assistantMessages()}
                    showAssistantCopyPartID={assistantCopyPartID()}
                    turnDurationMs={turnDurationMs()}
                    working={working()}
                    showReasoningSummaries={showReasoningSummaries()}
                    shellToolDefaultOpen={props.shellToolDefaultOpen}
                    editToolDefaultOpen={props.editToolDefaultOpen}
                    foldActions
                  />
                </div>
              </Show>
              <Show
                when={docked()}
                fallback={
                  <>
                    <Show when={live()}>
                      <div data-slot="session-turn-thinking" data-component="session-turn-live-action">
                        <TextShimmer text={actionText()} />
                        <Show when={!action() && !showReasoningSummaries()}>
                          <TextReveal
                            text={reasoningHeading()}
                            class="session-turn-thinking-heading"
                            travel={25}
                            duration={700}
                          />
                        </Show>
                      </div>
                    </Show>
                    <Show when={checklist()}>
                      {(steps) => (
                        <TurnChecklist
                          steps={steps()}
                          name={taskName(message(), parts())}
                          working={working()}
                          foldWhenDone
                        />
                      )}
                    </Show>
                    <Show when={live() && liveStatus()}>
                      <div data-component="session-turn-live-status" class="session-turn-live-status">
                        {liveStatus()}
                      </div>
                    </Show>
                    <SessionRetry status={status()} show={active()} />
                  </>
                }
              >
                {/* Docked: one live line below the box, next to the composer, says what the AI is doing now
                    with the elapsed time and helpers; a retry notice shows there too. */}
                <Docked to={props.liveMount?.below}>
                  <Show when={live()}>
                    <div data-component="session-turn-live-action" data-docked>
                      <Spinner class="session-turn-live-spinner" />
                      <span data-slot="session-turn-live-text">
                        <TextShimmer text={action() ? actionText() : (reasoningHeading() ?? actionText())} />
                      </span>
                      <Show when={liveStatus()}>
                        <span data-slot="session-turn-live-meta">{liveStatus()}</span>
                      </Show>
                    </div>
                  </Show>
                  <SessionRetry status={status()} show={active()} />
                </Docked>
              </Show>
              <Show when={edited() > 0 && !working()}>
                <div
                  data-slot="session-turn-diffs"
                  data-component="session-turn-diffs-group"
                  data-show-all={showAll() || undefined}
                >
                  <div data-slot="session-turn-diffs-header">
                    <span data-slot="session-turn-diffs-label">
                      {edited()} {i18n.t("ui.sessionTurn.diffs.changed")}{" "}
                      {i18n.t(edited() === 1 ? "ui.common.file.one" : "ui.common.file.other")}
                    </span>
                    <DiffChanges changes={diffs()} />
                    <Show when={overflow() > 0}>
                      <span data-slot="session-turn-diffs-toggle" onClick={toggleAll}>
                        {showAll() ? i18n.t("ui.sessionTurn.diffs.showLess") : i18n.t("ui.sessionTurn.diffs.showAll")}
                      </span>
                    </Show>
                    <Show when={props.actions?.commit || props.actions?.discard}>
                      <span data-slot="session-turn-diffs-actions">
                        <Show when={props.actions?.discard}>
                          {(discard) => (
                            <button
                              type="button"
                              data-action="session-turn-discard"
                              data-slot="session-turn-diffs-action"
                              onClick={() => runFilesAction(discard())}
                            >
                              <Icon name="reset" size="small" />
                              {i18n.t("ui.sessionTurn.diffs.discard")}
                            </button>
                          )}
                        </Show>
                        <Show when={props.actions?.commit}>
                          {(commit) => (
                            <button
                              type="button"
                              data-action="session-turn-commit"
                              data-slot="session-turn-diffs-action"
                              data-primary
                              onClick={() => runFilesAction(commit())}
                            >
                              <Icon name="cloud-upload" size="small" />
                              {i18n.t("ui.sessionTurn.diffs.commit")}
                            </button>
                          )}
                        </Show>
                      </span>
                    </Show>
                  </div>
                  <div data-component="session-turn-diffs-content">
                    <Accordion
                      multiple
                      style={{ "--sticky-accordion-offset": "44px" }}
                      value={expanded()}
                      onChange={(value) => setState("expanded", Array.isArray(value) ? value : value ? [value] : [])}
                    >
                      <For each={visible()}>
                        {(diff) => {
                          const view = normalize(diff)
                          const active = createMemo(() => expanded().includes(diff.file))
                          const [shown, setShown] = createSignal(false)

                          createEffect(
                            on(
                              active,
                              (value) => {
                                if (!value) {
                                  setShown(false)
                                  return
                                }

                                requestAnimationFrame(() => {
                                  if (!active()) return
                                  setShown(true)
                                })
                              },
                              { defer: true },
                            ),
                          )

                          return (
                            <Accordion.Item value={diff.file}>
                              <StickyAccordionHeader>
                                <Accordion.Trigger>
                                  <div data-slot="session-turn-diff-trigger">
                                    <span data-slot="session-turn-diff-path">
                                      <Show when={diff.file.includes("/")}>
                                        <span data-slot="session-turn-diff-directory">
                                          {`\u202A${getDirectory(diff.file)}\u202C`}
                                        </span>
                                      </Show>
                                      <span data-slot="session-turn-diff-filename">{getFilename(diff.file)}</span>
                                    </span>
                                    <div data-slot="session-turn-diff-meta">
                                      <span data-slot="session-turn-diff-changes">
                                        <DiffChanges changes={diff} />
                                      </span>
                                      <span data-slot="session-turn-diff-chevron">
                                        <Icon name="chevron-down" size="small" />
                                      </span>
                                    </div>
                                  </div>
                                </Accordion.Trigger>
                              </StickyAccordionHeader>
                              <Accordion.Content>
                                <Show when={shown()}>
                                  <div data-slot="session-turn-diff-view" data-scrollable>
                                    <Dynamic component={fileComponent} mode="diff" fileDiff={view.fileDiff} />
                                  </div>
                                </Show>
                              </Accordion.Content>
                            </Accordion.Item>
                          )
                        }}
                      </For>
                    </Accordion>
                    <Show when={!showAll() && overflow() > 0}>
                      <div data-slot="session-turn-diffs-more" onClick={toggleAll}>
                        {i18n.t("ui.sessionTurn.diffs.more", { count: String(overflow()) })}
                      </div>
                    </Show>
                  </div>
                </div>
              </Show>
              <Show when={error()}>
                <Card variant="error" class="error-card">
                  {errorText()}
                </Card>
              </Show>
            </div>
          </Show>
          {props.children}
        </div>
      </div>
    </div>
  )
}

/** Draws its children in place, or at `to` (a slot next to the docked task step box) when given. */
function Docked(props: ParentProps<{ to?: HTMLElement }>) {
  return (
    <Show when={props.to} keyed fallback={props.children}>
      {(el) => <Portal mount={el}>{props.children}</Portal>}
    </Show>
  )
}

/** For the task box above the composer, which names the request and the next queued one the same way. */
export { taskLine, taskName } from "./session-turn-activity"

/**
 * The task step box: the latest steps the AI wrote, updated in place as it works. Drawn inside a reply,
 * and above the composer while the session's steps are open; there `note` says the session waits on the
 * person, `actions` adds header buttons and `collapsed` shows the header alone.
 */
export function TurnChecklist(props: {
  steps: TurnStep[]
  /** The request the steps belong to: the header reads "Task: name". */
  name?: string
  /** Above the composer: the first queued request, shown as "Next: …" under the steps. */
  next?: string
  working: boolean
  note?: string
  actions?: JSX.Element
  collapsed?: boolean
  /** Inside a reply: once the turn stops with every step completed or cancelled, show one line that opens on click. */
  foldWhenDone?: boolean
}) {
  const i18n = useI18n()
  const progress = createMemo(() => checklistProgress(props.steps))
  const foldable = createMemo(() => !!props.foldWhenDone && checklistFolds(props.steps, props.working))
  const [opened, setOpened] = createSignal(false)
  const folded = createMemo(() => foldable() && !opened())
  const collapsed = () => props.collapsed || folded()
  const counts = () => ({ done: String(progress().done), total: String(progress().total) })

  return (
    <div
      data-component="session-turn-checklist"
      class="session-turn-checklist"
      data-collapsed={collapsed() || undefined}
      data-foldable={foldable() || undefined}
    >
      <div
        data-slot="session-turn-checklist-header"
        role={foldable() ? "button" : undefined}
        tabIndex={foldable() ? 0 : undefined}
        aria-expanded={foldable() ? !folded() : undefined}
        title={
          foldable()
            ? i18n.t(folded() ? "ui.sessionTurn.checklist.expand" : "ui.sessionTurn.checklist.collapse")
            : undefined
        }
        onClick={() => foldable() && setOpened((value) => !value)}
        onKeyDown={(event) => {
          if (!foldable() || (event.key !== "Enter" && event.key !== " ")) return
          event.preventDefault()
          setOpened((value) => !value)
        }}
      >
        <Icon name="checklist" size="small" />
        <span data-slot="session-turn-checklist-label" title={props.name}>
          {props.name
            ? i18n.t("ui.sessionTurn.checklist.task", { name: props.name })
            : i18n.t("ui.sessionTurn.checklist.label")}
        </span>
        <Show
          when={foldable()}
          fallback={
            <span data-slot="session-turn-checklist-progress">
              {i18n.t("ui.sessionTurn.checklist.progress", counts())}
            </span>
          }
        >
          <span data-slot="session-turn-checklist-summary">
            {"· "}
            {i18n.t("ui.sessionTurn.checklist.done", counts())}
          </span>
          <span data-slot="session-turn-checklist-done">
            <Icon name="check" size="small" />
          </span>
          <span data-slot="session-turn-checklist-chevron" data-open={!folded() || undefined}>
            <Icon name="chevron-down" size="small" />
          </span>
        </Show>
        <Show when={props.note}>
          <span data-slot="session-turn-checklist-note">{props.note}</span>
        </Show>
        <Show when={props.actions}>
          <span data-slot="session-turn-checklist-actions">{props.actions}</span>
        </Show>
      </div>
      <Show when={!collapsed()}>
        <ul data-slot="session-turn-checklist-steps">
          <For each={props.steps}>
            {(step) => (
              <li data-slot="session-turn-checklist-step" data-status={step.status}>
                <span data-slot="session-turn-checklist-marker" aria-hidden="true">
                  <StepIcon status={step.status} working={props.working} />
                </span>
                <span data-slot="session-turn-checklist-content" title={step.content}>
                  {step.content}
                </span>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={props.next}>
        <div data-slot="session-turn-checklist-next" title={props.next}>
          {props.next}
        </div>
      </Show>
    </div>
  )
}

/**
 * A checklist step's state, drawn so the four states read apart at a glance: a dashed circle for a
 * step not started, a ring of dots turning slowly for the step in progress (still once the turn
 * stops), a check for a finished step and a cross for a cancelled one.
 */
function StepIcon(props: { status: string; working: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" data-slot="session-turn-step-icon" data-status={props.status}>
      <Show when={props.status === "completed"}>
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" stroke-width="1.25" />
        <path d="M5.2 8.2l1.9 1.9 3.7-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
      </Show>
      <Show when={props.status === "cancelled"}>
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" stroke-width="1.25" />
        <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" />
      </Show>
      <Show when={props.status === "in_progress"}>
        <g data-slot="session-turn-step-ring" data-turning={props.working || undefined}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
            const angle = (i / 8) * Math.PI * 2
            return (
              <circle
                cx={8 + 6 * Math.cos(angle)}
                cy={8 + 6 * Math.sin(angle)}
                r="1.05"
                fill="currentColor"
                opacity={0.35 + (i / 7) * 0.65}
              />
            )
          })}
        </g>
      </Show>
      <Show when={props.status !== "completed" && props.status !== "cancelled" && props.status !== "in_progress"}>
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" stroke-width="1.25" stroke-dasharray="2.2 2.2" />
      </Show>
    </svg>
  )
}
