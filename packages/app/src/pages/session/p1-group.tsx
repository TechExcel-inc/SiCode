import { For, Show, createSignal, onCleanup, onMount } from "solid-js"
import { Portal } from "solid-js/web"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import type { Choice } from "@/p1/points"
import { layer } from "./p1-pop"
import { Tip } from "./p1-tip"

/** An icon for each way the requirement list can be grouped, drawn on a 16px grid in the current color. */
export function Grouping(props: { id: number }) {
  const shape = () => {
    // Weekly committed work: a calendar with its weeks ranked.
    if (props.id === 1132)
      return (
        <>
          <rect x="2" y="3" width="12" height="11" rx="2" />
          <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
          <path d="M5 9.25h6M5 11.75h3.5" />
        </>
      )
    // Spec owner: a person.
    if (props.id === 1113)
      return (
        <>
          <circle cx="8" cy="5.5" r="2.75" />
          <path d="M2.75 14c.6-2.6 2.75-4.25 5.25-4.25s4.65 1.65 5.25 4.25" />
        </>
      )
    // Module owner: a person beside the module they own.
    if (props.id === 1604)
      return (
        <>
          <circle cx="5.5" cy="5.5" r="2.25" />
          <path d="M1.5 13.5c.45-2.15 2-3.5 4-3.5 1 0 1.9.35 2.6.95" />
          <path d="M11.5 7.5l3 1.6v3.4l-3 1.6-3-1.6V9.1z M8.5 9.1l3 1.6 3-1.6M11.5 10.7v3.4" />
        </>
      )
    // Created by: a person with a pen.
    if (props.id === 1110)
      return (
        <>
          <circle cx="6" cy="5.5" r="2.5" />
          <path d="M1.75 13.75c.5-2.4 2.25-3.9 4.25-3.9 .7 0 1.35.15 1.95.45" />
          <path d="M13.9 8.6l1 1-4 4-1.6.6.6-1.6z" />
        </>
      )
    // No grouping: one plain list.
    return <path d="M3 4.5h10M3 8h10M3 11.5h10" />
  }
  return (
    <svg
      class="size-4 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.3"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {shape()}
    </svg>
  )
}

/** The requirement list's Group By button: shows the grouping in use, and picks another from a short menu. */
export function P1Group(props: { value: number; items: Choice[]; disabled?: boolean; onPick: (id: number) => void }) {
  const language = useLanguage()
  const [at, setAt] = createSignal<DOMRect>()
  const name = () => props.items.find((item) => item.id === props.value)?.name ?? ""

  return (
    <div class="relative group/tip shrink-0">
      <button
        type="button"
        data-action="p1-group"
        class="size-8 rounded-lg flex items-center justify-center border bg-surface-base hover:text-text-strong"
        classList={{
          "text-text-interactive-base border-border-interactive-base": !!props.value,
          "text-text-weak border-border-weaker-base": !props.value,
        }}
        disabled={props.disabled}
        aria-label={language.t("p1.filter.group")}
        aria-pressed={!!props.value}
        onClick={(event) => setAt(event.currentTarget.getBoundingClientRect())}
      >
        <Grouping id={props.value} />
      </button>
      <Show when={!at()}>
        <Tip side="left" rows={[[language.t("p1.filter.group"), name()]]} />
      </Show>
      <Show when={at()}>
        {(rect) => (
          <Pick
            at={rect()}
            value={props.value}
            items={props.items}
            onPick={(id) => {
              setAt(undefined)
              if (id !== props.value) props.onPick(id)
            }}
            onClose={() => setAt(undefined)}
          />
        )}
      </Show>
    </div>
  )
}

function Pick(props: {
  at: DOMRect
  value: number
  items: Choice[]
  onPick: (id: number) => void
  onClose: () => void
}) {
  const language = useLanguage()
  const stack = layer()
  const width = 264
  const left = Math.max(16, Math.min(props.at.left, window.innerWidth - width - 16))

  onMount(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && stack.top()) props.onClose()
    }
    window.addEventListener("keydown", key)
    onCleanup(() => window.removeEventListener("keydown", key))
  })

  return (
    <Portal>
      <div class="fixed inset-0" style={{ "z-index": stack.z }} onClick={() => props.onClose()} />
      <div
        data-component="p1-group"
        role="menu"
        class="fixed p-1.5 flex flex-col rounded-xl border border-border-strong-base bg-surface-raised-stronger-non-alpha"
        style={{
          left: `${left}px`,
          top: `${props.at.bottom + 6}px`,
          width: `${width}px`,
          "z-index": stack.z + 1,
          "box-shadow": "0 12px 32px rgb(0 0 0 / 0.35)",
        }}
      >
        <div class="px-2.5 pt-1.5 pb-2 text-12-medium text-text-weak">{language.t("p1.filter.group")}</div>
        <For each={props.items}>
          {(item) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={item.id === props.value}
              class="h-9 px-2.5 flex items-center gap-2.5 rounded-lg text-left text-13-regular hover:bg-surface-raised-base-hover"
              classList={{
                "text-text-strong bg-surface-base": item.id === props.value,
                "text-text-base": item.id !== props.value,
              }}
              onClick={() => props.onPick(item.id)}
            >
              <span
                class="size-6 shrink-0 rounded-md flex items-center justify-center"
                classList={{
                  "text-text-interactive-base bg-surface-interactive-weak": item.id === props.value,
                  "text-icon-weak": item.id !== props.value,
                }}
              >
                <Grouping id={item.id} />
              </span>
              <span class="min-w-0 flex-1 truncate">{item.name}</span>
              <Show when={item.id === props.value}>
                <Icon name="check-small" size="small" class="shrink-0 text-text-interactive-base" />
              </Show>
            </button>
          )}
        </For>
      </div>
    </Portal>
  )
}
