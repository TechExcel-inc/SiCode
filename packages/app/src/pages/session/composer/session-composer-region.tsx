import { For, Show, createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { useSpring } from "@opencode-ai/ui/motion-spring"
import { PromptInput } from "@/components/prompt-input"
import { useLanguage } from "@/context/language"
import { usePrompt } from "@/context/prompt"
import { useLayout } from "@/context/layout"
import { ACTIONS } from "@/pages/session/design-actions"
import { design } from "@/pages/session/design-state"
import { useSync } from "@/context/sync"
import { getSessionHandoff, setSessionHandoff } from "@/pages/session/handoff"
import { useSessionKey } from "@/pages/session/session-layout"
import { SessionPermissionDock } from "@/pages/session/composer/session-permission-dock"
import { SessionFollowupDock } from "@/pages/session/composer/session-followup-dock"
import { SessionRevertDock } from "@/pages/session/composer/session-revert-dock"
import type { SessionComposerState } from "@/pages/session/composer/session-composer-state"
import { SessionTodoDock } from "@/pages/session/composer/session-todo-dock"
import { taskLine, taskName } from "@opencode-ai/ui/session-turn"
import type { FollowupDraft } from "@/components/prompt-input/submit"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { OneTimeBanner, OneTimeClosed } from "@/components/one-time"

export function SessionComposerRegion(props: {
  state: SessionComposerState
  ready: boolean
  centered: boolean
  inputRef: (el: HTMLDivElement) => void
  newSessionWorktree: string
  onNewSessionWorktreeReset: () => void
  onSubmit: () => void
  onResponseSubmit: () => void
  followup?: {
    queue: () => boolean
    items: { id: string; text: string }[]
    sending?: string
    edit?: { id: string; prompt: FollowupDraft["prompt"]; context: FollowupDraft["context"] }
    onQueue: (draft: FollowupDraft) => void
    onAbort: () => void
    onSend: (id: string) => void
    onEdit: (id: string) => void
    onFresh: (id: string) => void
    onEditLoaded: () => void
  }
  revert?: {
    items: { id: string; text: string }[]
    restoring?: string
    disabled?: boolean
    onRestore: (id: string) => void
  }
  setPromptDockRef: (el: HTMLDivElement) => void
}) {
  const navigate = useNavigate()
  const prompt = usePrompt()
  const layout = useLayout()
  let input: HTMLElement | undefined
  // On the Design tab, one click sends a ready-made request about the open doc.
  const ask = (text: string) => {
    prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
    requestAnimationFrame(() => input?.closest("form")?.requestSubmit())
  }
  const language = useLanguage()
  const route = useSessionKey()
  const sync = useSync()

  // The request whose turn last wrote the steps, so the box names the task they belong to.
  const task = createMemo(() => {
    const id = route.params.id
    if (!id) return
    const list = sync.data.message[id] ?? []
    const writer = list.findLast(
      (item) =>
        item.role === "assistant" &&
        (sync.data.part[item.id] ?? []).some((part) => part.type === "tool" && part.tool === "todowrite"),
    )
    const parent = writer?.role === "assistant" ? writer.parentID : undefined
    const user = list.find((item) => item.id === parent) ?? list.findLast((item) => item.role === "user")
    if (user?.role !== "user") return
    return taskName(user, sync.data.part[user.id] ?? [])
  })
  const next = createMemo(() => {
    const items = props.followup?.items ?? []
    const first = items[0] ? taskLine(items[0].text) : undefined
    if (!first) return
    return items.length > 1
      ? language.t("session.todo.nextMore", { name: first, count: items.length - 1 })
      : language.t("session.todo.next", { name: first })
  })

  const handoffPrompt = createMemo(() => getSessionHandoff(route.sessionKey())?.prompt)
  const info = createMemo(() => (route.params.id ? sync.session.get(route.params.id) : undefined))
  const parentID = createMemo(() => info()?.parentID)
  const child = createMemo(() => !!parentID())
  const once = createMemo(() => info()?.oneTime)
  // An open one-time session that has used every request it was allowed.
  const spent = createMemo(() => {
    const one = once()
    return one?.status === "open" && one.limit !== undefined && one.requests >= one.limit
  })
  // A pending question stays usable: it is answered in the conversation or by typing a message.
  const showComposer = createMemo(() => (!props.state.permissionRequest() && !props.state.questionRequest()) || child())

  const previewPrompt = () =>
    prompt
      .current()
      .map((part) => {
        if (part.type === "file") return `[file:${part.path}]`
        if (part.type === "agent") return `@${part.name}`
        if (part.type === "image") return `[image:${part.filename}]`
        return part.content
      })
      .join("")
      .trim()

  createEffect(() => {
    if (!prompt.ready()) return
    setSessionHandoff(route.sessionKey(), { prompt: previewPrompt() })
  })

  const [store, setStore] = createStore({
    ready: false,
    height: 320,
    body: undefined as HTMLDivElement | undefined,
  })
  let timer: number | undefined
  let frame: number | undefined

  const clear = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timer = undefined
    }
    if (frame !== undefined) {
      cancelAnimationFrame(frame)
      frame = undefined
    }
  }

  createEffect(() => {
    route.sessionKey()
    const ready = props.ready
    const delay = 140

    clear()
    setStore("ready", false)
    if (!ready) return

    frame = requestAnimationFrame(() => {
      frame = undefined
      timer = window.setTimeout(() => {
        setStore("ready", true)
        timer = undefined
      }, delay)
    })
  })

  onCleanup(clear)

  const open = createMemo(() => store.ready && props.state.dock() && !props.state.closing())
  const progress = useSpring(() => (open() ? 1 : 0), { visualDuration: 0.3, bounce: 0 })
  const value = createMemo(() => Math.max(0, Math.min(1, progress())))
  const dock = createMemo(() => (store.ready && props.state.dock()) || value() > 0.001)
  const rolled = createMemo(() => (props.revert?.items.length ? props.revert : undefined))
  const lift = createMemo(() => (rolled() ? 18 : 36 * value()))
  const full = createMemo(() => Math.max(78, store.height))

  const openParent = () => {
    const id = parentID()
    if (!id) return
    navigate(`/${route.params.dir}/session/${id}`)
  }

  createEffect(() => {
    const el = store.body
    if (!el) return
    const update = () => setStore("height", el.getBoundingClientRect().height)
    createResizeObserver(store.body, update)
    update()
  })

  return (
    <div
      ref={props.setPromptDockRef}
      data-component="session-prompt-dock"
      class="shrink-0 w-full pb-3 flex flex-col justify-center items-center bg-background-stronger pointer-events-none"
    >
      <div
        classList={{
          "w-full px-3 pointer-events-auto": true,
          "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.centered,
        }}
      >
        <Show when={props.state.permissionRequest()} keyed>
          {(request) => (
            <div>
              <SessionPermissionDock
                request={request}
                responding={props.state.permissionResponding()}
                onDecide={(response) => {
                  props.onResponseSubmit()
                  props.state.decide(response)
                }}
              />
            </div>
          )}
        </Show>

        <Show when={showComposer()}>
          <Show
            when={prompt.ready()}
            fallback={
              <>
                <Show when={rolled()} keyed>
                  {(revert) => (
                    <div class="pb-2">
                      <SessionRevertDock
                        items={revert.items}
                        restoring={revert.restoring}
                        disabled={revert.disabled}
                        onRestore={revert.onRestore}
                      />
                    </div>
                  )}
                </Show>
                <div class="w-full min-h-32 md:min-h-40 rounded-md border border-border-weak-base bg-background-base/50 px-4 py-3 text-text-weak whitespace-pre-wrap pointer-events-none">
                  {handoffPrompt() || language.t("prompt.loading")}
                </div>
              </>
            }
          >
            <Show when={dock()}>
              <div
                classList={{
                  "overflow-hidden": true,
                  "pointer-events-none": value() < 0.98,
                }}
                style={{
                  "max-height": `${full() * value()}px`,
                }}
              >
                <div ref={(el) => setStore("body", el)}>
                  <SessionTodoDock
                    sessionID={route.params.id}
                    todos={props.state.todos()}
                    name={task()}
                    next={next()}
                    live={props.state.live()}
                    collapseLabel={language.t("session.todo.collapse")}
                    expandLabel={language.t("session.todo.expand")}
                    dismissLabel={language.t("session.todo.dismiss")}
                    onDismiss={props.state.dismissTodos}
                    continueLabel={language.t("session.todo.continue")}
                    onContinue={props.state.continueSteps}
                    dockProgress={value()}
                  />
                </div>
              </div>
            </Show>
            <Show when={rolled()} keyed>
              {(revert) => (
                <div
                  style={{
                    "margin-top": `${-36 * value()}px`,
                  }}
                >
                  <SessionRevertDock
                    items={revert.items}
                    restoring={revert.restoring}
                    disabled={revert.disabled}
                    onRestore={revert.onRestore}
                  />
                </div>
              )}
            </Show>
            <div
              classList={{
                "relative z-10": true,
              }}
              style={{
                "margin-top": `${-lift()}px`,
              }}
            >
              <Show when={once()?.status === "open" && info()} keyed>
                {(session) => <OneTimeBanner session={session} />}
              </Show>
              <Show when={props.followup?.items.length}>
                <SessionFollowupDock
                  items={props.followup!.items}
                  sending={props.followup!.sending}
                  onSend={props.followup!.onSend}
                  onEdit={props.followup!.onEdit}
                  onFresh={props.followup!.onFresh}
                />
              </Show>
              <Show
                when={child() || once()?.status === "closed" || spent()}
                fallback={
                  <Show when={!props.state.permissionRequest()}>
                    <Show when={layout.nav.current() === "design" && design.doc}>
                      <div data-component="design-actions" class="flex flex-wrap gap-1.5 pb-2">
                        <For each={ACTIONS}>
                          {(action) => (
                            <button
                              type="button"
                              data-action={`design-action-${action.id}`}
                              class="h-7 px-2.5 rounded-full border border-border-weak-base text-12-regular text-text-base hover:bg-surface-base-hover"
                              onClick={() => ask(action.prompt(design.doc))}
                            >
                              {language.t(action.label)}
                            </button>
                          )}
                        </For>
                      </div>
                    </Show>
                    <PromptInput
                      ref={(el) => {
                        input = el
                        props.inputRef(el)
                      }}
                      newSessionWorktree={props.newSessionWorktree}
                      onNewSessionWorktreeReset={props.onNewSessionWorktreeReset}
                      edit={props.followup?.edit}
                      onEditLoaded={props.followup?.onEditLoaded}
                      shouldQueue={props.followup?.queue}
                      onQueue={props.followup?.onQueue}
                      onAbort={props.followup?.onAbort}
                      onSubmit={props.onSubmit}
                    />
                  </Show>
                }
              >
                <Show when={(once()?.status === "closed" || spent()) && info()} keyed>
                  {(session) => <OneTimeClosed session={session} full={spent()} ref={props.inputRef} />}
                </Show>
                <Show when={child()}>
                  <div
                    ref={props.inputRef}
                    class="w-full rounded-[12px] border border-border-weak-base bg-background-base p-3 text-16-regular text-text-weak"
                  >
                    <span>{language.t("session.child.promptDisabled")} </span>
                    <Show when={parentID()}>
                      <button
                        type="button"
                        class="text-text-base transition-colors hover:text-text-strong"
                        onClick={openParent}
                      >
                        {language.t("session.child.backToParent")}
                      </button>
                    </Show>
                  </div>
                </Show>
              </Show>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  )
}
