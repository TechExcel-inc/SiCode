import type { Todo } from "@opencode-ai/sdk/v2"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TurnChecklist } from "@opencode-ai/ui/session-turn"
import { createEffect, createMemo, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { composerEnabled, composerProbe } from "@/testing/session-composer"
import { useLanguage } from "@/context/language"
import { stepDockMount } from "./step-dock-mount"

/**
 * The task step box above the composer: the session's steps, drawn like the step box in a reply. While
 * the AI works the step in progress turns; once the turn ends with steps left undone the box stays and
 * says the session waits on the person, who can continue it with one click or dismiss the steps.
 */
export function SessionTodoDock(props: {
  sessionID?: string
  todos: Todo[]
  /** The request the steps belong to. */
  name?: string
  /** "Next: …" for the first queued request, with how many more wait. */
  next?: string
  live: boolean
  collapseLabel: string
  expandLabel: string
  dismissLabel: string
  onDismiss: () => void
  continueLabel: string
  onContinue: () => void
  dockProgress: number
}) {
  const language = useLanguage()
  const [store, setStore] = createStore({ collapsed: false })
  const toggle = () => setStore("collapsed", (value) => !value)

  const steps = createMemo(() => props.todos.map((todo) => ({ content: todo.content, status: todo.status })))
  const shut = createMemo(() => 1 - Math.max(0, Math.min(1, props.dockProgress)))
  const e2e = composerEnabled()
  const probe = composerProbe(props.sessionID)

  createEffect(() => {
    if (!e2e) return
    probe.set({
      mounted: true,
      collapsed: store.collapsed,
      hidden: store.collapsed || shut() > 0.98,
      count: props.todos.length,
      states: props.todos.map((todo) => todo.status),
    })
  })

  onCleanup(() => {
    stepDockMount.setBelow(undefined)
  })

  onCleanup(() => {
    if (!e2e) return
    probe.drop()
  })

  return (
    // The composer below is pulled up 36px over the dock (see the region's `lift`), so the bottom padding
    // keeps the box clear of it, with a small gap.
    <div data-component="session-todo-dock" style={{ opacity: `${1 - shut()}`, "padding-bottom": "44px" }}>
      <TurnChecklist
        steps={steps()}
        name={props.name}
        next={props.next}
        working={props.live}
        collapsed={store.collapsed}
        note={props.live ? undefined : language.t("agent.status.waiting")}
        actions={
          <>
            <Show when={!props.live}>
              <Button data-action="session-todo-continue" size="small" variant="secondary" onClick={() => props.onContinue()}>
                {props.continueLabel}
              </Button>
            </Show>
            <IconButton
              data-action="session-todo-toggle-button"
              data-collapsed={store.collapsed ? "true" : "false"}
              icon="chevron-down"
              size="small"
              variant="ghost"
              style={{ transform: `rotate(${store.collapsed ? 180 : 0}deg)` }}
              onClick={toggle}
              aria-label={store.collapsed ? props.expandLabel : props.collapseLabel}
            />
            <Show when={!props.live}>
              <IconButton
                data-action="session-todo-dismiss"
                icon="close"
                size="small"
                variant="ghost"
                onClick={() => props.onDismiss()}
                aria-label={props.dismissLabel}
              />
            </Show>
          </>
        }
      />
      <div data-slot="session-step-dock-below" ref={stepDockMount.setBelow} />
    </div>
  )
}
