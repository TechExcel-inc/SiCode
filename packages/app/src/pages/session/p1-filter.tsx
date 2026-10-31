import { For, Show, createSignal, onCleanup, onMount } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { blank, closed, expand, open, type Filter, type Status } from "@/p1/filter"
import type { Choice } from "@/p1/points"
import { Menu } from "./p1-inline"
import { layer } from "./p1-pop"

type Key = "owners" | "states" | "modules"

/**
 * The requirement list's filter, as P1 has it: owners (or submitters), states, module owners and two link
 * checks; the grouping has its own button. Changes wait for OK; Clear only empties the boxes, and clicking outside drops them.
 */
export function P1Filter(props: {
  at: DOMRect
  value: Filter
  owners: Choice[]
  states: Status[]
  // Module owners, when the project has a development project to own modules.
  members?: Choice[]
  onApply: (next: Filter) => void
  onClose: () => void
}) {
  const language = useLanguage()
  const [state, setState] = createStore({ ...props.value })
  const [pick, setPick] = createSignal<{ key: Key; at: DOMRect }>()
  const stack = layer()
  const width = 420
  const left = Math.max(16, Math.min(props.at.left, window.innerWidth - width - 16))

  onMount(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && stack.top()) props.onClose()
    }
    window.addEventListener("keydown", key)
    onCleanup(() => window.removeEventListener("keydown", key))
  })

  const marks = [
    { id: open, name: language.t("p1.filter.open") },
    { id: closed, name: language.t("p1.filter.closed") },
  ]
  const items = (key: Key): Choice[] => {
    if (key === "owners") return props.owners
    if (key === "states") return [...marks, ...props.states]
    return props.members ?? []
  }
  const chosen = (key: Key) => state[key]
  const label = (key: Key) => {
    const names = items(key)
      .filter((item) => chosen(key).includes(item.id))
      .map((item) => item.name)
    return names.join(", ")
  }
  const choose = (key: Key, value: string) => {
    const ids = value.split(",").filter(Boolean).map(Number)
    if (key === "states") return setState("states", expand(ids, props.states))
    setState(key, ids)
  }

  const Box = (box: { key: Key; empty: string }) => (
    <button
      type="button"
      data-action={`p1-filter-${box.key}`}
      class="min-w-0 h-9 px-2.5 flex items-center gap-2 rounded-md border border-border-weak-base bg-background-base text-left hover:border-border-strong-base"
      classList={{ "border-border-interactive-base": pick()?.key === box.key }}
      onClick={(event) => setPick({ key: box.key, at: event.currentTarget.getBoundingClientRect() })}
    >
      <span class="min-w-0 flex-1 truncate text-13-regular" classList={{ "text-text-weak": !label(box.key) }}>
        {label(box.key) || box.empty}
      </span>
      <Icon name="chevron-down" size="small" class="shrink-0 text-icon-weak" />
    </button>
  )

  const row = "grid grid-cols-[120px_1fr] items-center gap-3"
  const name = "text-13-medium text-text-base"

  return (
    <Portal>
      <div class="fixed inset-0" style={{ "z-index": stack.z }} onClick={() => props.onClose()} />
      <div
        data-component="p1-filter"
        class="fixed flex flex-col rounded-xl border border-border-strong-base bg-surface-raised-stronger-non-alpha"
        style={{
          left: `${left}px`,
          top: `${props.at.bottom + 6}px`,
          width: `${width}px`,
          "z-index": stack.z + 1,
          "box-shadow": "var(--shadow-lg-border-base), 0 16px 48px rgb(0 0 0 / 0.45)",
        }}
      >
        <div class="px-4 pt-4 pb-3 flex flex-col gap-3">
          <div class={row}>
            <div class="flex items-center p-0.5 rounded-md bg-surface-base w-fit">
              <For each={[false, true]}>
                {(submitter) => (
                  <button
                    type="button"
                    class="h-6 px-2 rounded text-12-medium"
                    classList={{
                      "bg-background-base text-text-strong shadow-xs": state.submitter === submitter,
                      "text-text-weak hover:text-text-base": state.submitter !== submitter,
                    }}
                    aria-pressed={state.submitter === submitter}
                    onClick={() => setState("submitter", submitter)}
                  >
                    {language.t(submitter ? "p1.filter.submitter" : "p1.filter.owner")}
                  </button>
                )}
              </For>
            </div>
            <Box key="owners" empty={language.t("p1.filter.all")} />
          </div>
          <div class={row}>
            <span class={name}>{language.t("p1.filter.status")}</span>
            <Box key="states" empty={language.t("p1.filter.all")} />
          </div>
          <Show when={props.members}>
            <div class={row}>
              <span class={name}>{language.t("p1.filter.module")}</span>
              <Box key="modules" empty={language.t("p1.filter.all")} />
            </div>
          </Show>
          <label class="mt-1 flex items-start gap-2 text-13-regular text-text-base cursor-pointer">
            <input
              type="checkbox"
              class="mt-0.5 size-4 shrink-0 accent-[var(--surface-interactive-base)]"
              checked={state.unlinked}
              onChange={(event) => setState("unlinked", event.currentTarget.checked)}
            />
            {language.t("p1.filter.unlinked")}
          </label>
          <label class="flex items-start gap-2 text-13-regular text-text-base cursor-pointer">
            <input
              type="checkbox"
              class="mt-0.5 size-4 shrink-0 accent-[var(--surface-interactive-base)]"
              checked={state.untested}
              onChange={(event) => setState("untested", event.currentTarget.checked)}
            />
            {language.t("p1.filter.untested")}
          </label>
        </div>
        <div class="px-3 py-2.5 flex items-center justify-between border-t border-border-weaker-base">
          <button
            type="button"
            data-action="p1-filter-clear"
            class="h-8 px-2.5 rounded-md text-13-regular text-text-weak hover:bg-surface-raised-base-hover"
            onClick={() => setState({ ...blank, submitter: state.submitter, group: state.group })}
          >
            {language.t("p1.inline.clear")}
          </button>
          <Button variant="primary" size="large" data-action="p1-filter-ok" onClick={() => props.onApply({ ...state })}>
            {language.t("p1.inline.done")}
          </Button>
        </div>
      </div>
      <Show when={pick()}>
        {(menu) => (
          <Menu
            at={menu().at}
            items={items(menu().key)}
            picked={chosen(menu().key).map(String)}
            many
            people={menu().key === "owners" || menu().key === "modules"}
            clear={false}
            onPick={(value) => {
              choose(menu().key, value)
              setPick(undefined)
            }}
            onClose={() => setPick(undefined)}
          />
        )}
      </Show>
    </Portal>
  )
}
