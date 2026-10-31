import { For, Show, onCleanup, onMount } from "solid-js"
import { Portal } from "solid-js/web"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import type { Prefs } from "@/p1/prefs"
import { useP1 } from "@/p1/settings"
import { layer } from "./p1-pop"

/** The colors of the two ways to edit from the list: green edits in place, purple opens the edit panel. */
export const tint = { inline: "#12B76A", panel: "#9B6CF2" }

/**
 * The requirement view's settings, as P1's settings popover has them, plus what clicking a field does in SiCode.
 * Each change applies at once.
 */
export function P1Prefs(props: {
  at: DOMRect
  value: Prefs
  onChange: (next: Prefs) => void
  onColumns: () => void
  onClose: () => void
}) {
  const p1 = useP1()
  const language = useLanguage()
  const stack = layer()
  const width = 380
  const left = Math.max(16, Math.min(props.at.right - width, window.innerWidth - width - 16))

  onMount(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && stack.top()) props.onClose()
    }
    window.addEventListener("keydown", key)
    onCleanup(() => window.removeEventListener("keydown", key))
  })

  const set = (next: Partial<Prefs>) => props.onChange({ ...props.value, ...next })
  const box = "mt-0.5 size-4 shrink-0 accent-[var(--surface-interactive-base)]"
  const line = "flex items-start gap-2 text-13-regular text-text-base cursor-pointer"
  const head = "text-12-medium text-text-weak"

  return (
    <Portal>
      <div class="fixed inset-0" style={{ "z-index": stack.z }} onClick={() => props.onClose()} />
      <div
        data-component="p1-prefs"
        class="fixed flex flex-col rounded-xl border border-border-strong-base bg-surface-raised-stronger-non-alpha"
        style={{
          left: `${left}px`,
          top: `${props.at.bottom + 6}px`,
          width: `${width}px`,
          "z-index": stack.z + 1,
          "box-shadow": "0 12px 32px rgb(0 0 0 / 0.35)",
        }}
      >
        <div class="h-11 pl-4 pr-2 flex items-center justify-between border-b border-border-weaker-base">
          <span class="text-14-medium text-text-strong">{language.t("p1.prefs.title")}</span>
          <button
            type="button"
            data-action="p1-prefs-close"
            class="size-8 rounded-lg flex items-center justify-center text-icon-weak hover:text-text-strong hover:bg-surface-base-hover"
            aria-label={language.t("common.close")}
            onClick={() => props.onClose()}
          >
            <Icon name="close" size="small" />
          </button>
        </div>
        {/* SiCode's own: one way to edit from the list, each in the color its toolbar button wears. */}
        <div class="px-4 pt-3 pb-3 flex flex-col gap-2.5 border-b border-border-weaker-base">
          <span class={head}>{language.t("p1.prefs.click")}</span>
          <For each={["inline", "panel"] as const}>
            {(mode) => (
              <label class={line}>
                <input
                  type="radio"
                  name="p1-edit"
                  class="mt-0.5 size-4 shrink-0"
                  style={{ "accent-color": tint[mode] }}
                  checked={p1.edit() === mode}
                  onChange={() => p1.mode(mode)}
                />
                <span style={{ color: p1.edit() === mode ? tint[mode] : undefined }}>
                  {language.t(`p1.prefs.${mode}`)}
                </span>
              </label>
            )}
          </For>
        </div>
        <div class="px-4 py-3 flex flex-col gap-2.5 border-b border-border-weaker-base">
          <span class={head}>{language.t("p1.prefs.folders")}</span>
          <label class={line}>
            <input
              type="checkbox"
              class={box}
              checked={props.value.closed}
              onChange={(e) => set({ closed: e.currentTarget.checked })}
            />
            {language.t("p1.prefs.closed")}
          </label>
          <label class={line}>
            <input
              type="checkbox"
              class={box}
              checked={props.value.current}
              onChange={(e) => set({ current: e.currentTarget.checked })}
            />
            {language.t("p1.prefs.current")}
          </label>
        </div>
        <div class="px-4 py-3 flex flex-col gap-2.5 border-b border-border-weaker-base">
          <span class={head}>{language.t("p1.prefs.events")}</span>
          <select
            class="h-8 px-2 rounded-md border border-border-weak-base bg-background-base text-13-regular text-text-strong outline-none focus:border-border-interactive-base"
            value={String(props.value.events)}
            onChange={(e) => set({ events: Number(e.currentTarget.value) })}
          >
            <For each={[0, 1, 2, 3]}>
              {(id) => <option value={String(id)}>{language.t(`p1.prefs.event.${id}`)}</option>}
            </For>
          </select>
          <Show when={props.value.events}>
            <For each={[1, 2]}>
              {(bit) => (
                <label class={line}>
                  <input
                    type="checkbox"
                    class={box}
                    checked={!!(props.value.owners & bit)}
                    onChange={(e) =>
                      set({ owners: e.currentTarget.checked ? props.value.owners | bit : props.value.owners & ~bit })
                    }
                  />
                  {language.t(`p1.prefs.owners.${bit}`)}
                </label>
              )}
            </For>
          </Show>
        </div>
        <button
          type="button"
          data-action="p1-prefs-columns"
          class="mx-2 my-2 h-9 px-2 flex items-center gap-2 rounded-lg text-13-regular text-text-base hover:bg-surface-base-hover"
          onClick={() => props.onColumns()}
        >
          <Icon name="bullet-list" size="small" class="text-icon-weak" />
          {language.t("p1.prefs.columns")}
        </button>
      </div>
    </Portal>
  )
}
