import { For, Show, createMemo, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useLanguage } from "@/context/language"
import { defaults, keep, pinned, type Column } from "@/p1/columns"
import { useP1 } from "@/p1/settings"
import { Frame } from "./p1-item"

/** P1's Customize dialog for the requirement list: pick columns from the available ones and put them in order. */
export function P1Columns(props: {
  project: number
  chosen: Column[]
  pool: Column[]
  onClose: () => void
  onSaved: (list: Column[]) => void
}) {
  const p1 = useP1()
  const language = useLanguage()
  const [state, setState] = createStore({ list: [...props.chosen], find: "", busy: false, err: "" })
  const left = createMemo(() => {
    const query = state.find.trim().toLowerCase()
    return props.pool
      .filter((item) => !state.list.some((other) => other.id === item.id))
      .filter((item) => !query || item.name.toLowerCase().includes(query))
      .toSorted((a, b) => a.name.localeCompare(b.name))
  })
  const shift = (index: number, by: number) => {
    const list = [...state.list]
    const [item] = list.splice(index, 1)
    list.splice(index + by, 0, item)
    setState("list", list)
  }
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

  const reset = async () => {
    setState({ busy: true, err: "" })
    const list = await defaults(p1.server(), p1.token(), props.project, language.locale()).catch((err: unknown) => {
      setState("err", message(err))
    })
    setState("busy", false)
    if (list?.length) setState("list", list)
  }

  const submit = async () => {
    setState({ busy: true, err: "" })
    const ok = await keep(p1.server(), p1.token(), props.project, p1.user(), state.list, language.locale())
      .then(() => true)
      .catch((err: unknown) => {
        setState({ err: message(err), busy: false })
        return false
      })
    if (!ok) return
    props.onSaved(state.list)
    props.onClose()
  }

  onMount(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose()
    }
    window.addEventListener("keydown", key)
    onCleanup(() => window.removeEventListener("keydown", key))
  })

  const row =
    "h-9 px-2.5 flex items-center gap-2 rounded-lg text-13-regular text-text-strong hover:bg-surface-base-hover"
  const tool = "size-7 shrink-0 rounded-md flex items-center justify-center text-text-weak hover:text-text-strong disabled:opacity-30"

  return (
    <Frame name="p1-columns" class="max-w-3xl h-[80vh]">
      <header class="shrink-0 px-6 py-4 flex items-center gap-3 border-b border-border-weaker-base">
        <div class="min-w-0 flex-1 truncate text-18-medium text-text-strong">{language.t("p1.act.customize")}</div>
        <Button variant="ghost" size="large" disabled={state.busy} onClick={() => void reset()} data-action="p1-columns-reset">
          {language.t("p1.columns.reset")}
        </Button>
        <Button variant="primary" size="large" disabled={state.busy} onClick={() => void submit()} data-action="p1-columns-submit">
          <Show when={state.busy}>
            <Spinner class="size-4" />
          </Show>
          {language.t("p1.form.submit")}
        </Button>
        <Button variant="ghost" size="large" onClick={() => props.onClose()}>
          {language.t("p1.form.cancel")}
        </Button>
      </header>
      <Show when={state.err}>
        <p class="shrink-0 px-6 pt-3 text-12-regular text-text-diff-delete-base">{state.err}</p>
      </Show>
      <div class="flex-1 min-h-0 grid grid-cols-2 gap-4 p-5">
        <section class="min-h-0 flex flex-col rounded-lg border border-border-weaker-base">
          <div class="shrink-0 px-3 pt-3 pb-2 flex flex-col gap-2">
            <span class="text-12-medium text-text-weak">{language.t("p1.columns.available")}</span>
            <input
              class="h-8 px-2.5 rounded-lg bg-surface-base border border-border-weaker-base text-13-regular text-text-strong outline-none focus:border-border-interactive-base"
              value={state.find}
              placeholder={language.t("p1.columns.search")}
              onInput={(event) => setState("find", event.currentTarget.value)}
            />
          </div>
          <div class="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
            <For each={left()}>
              {(item) => (
                <button
                  type="button"
                  data-action="p1-columns-add"
                  class={`w-full text-left ${row}`}
                  onClick={() => setState("list", [...state.list, item])}
                >
                  <Icon name="plus-small" size="small" class="shrink-0 text-text-weak" />
                  <span class="truncate">{item.name}</span>
                </button>
              )}
            </For>
          </div>
        </section>
        <section class="min-h-0 flex flex-col rounded-lg border border-border-weaker-base">
          <div class="shrink-0 px-3 pt-3 pb-2 text-12-medium text-text-weak">
            {language.t("p1.columns.chosen", { count: state.list.length })}
          </div>
          <div class="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
            <For each={state.list}>
              {(item, index) => (
                <div class={row} data-column={item.id}>
                  <span class="flex-1 min-w-0 truncate">{item.name}</span>
                  <button
                    type="button"
                    class={tool}
                    aria-label={language.t("p1.columns.up")}
                    title={language.t("p1.columns.up")}
                    disabled={index() === 0}
                    onClick={() => shift(index(), -1)}
                  >
                    <Icon name="arrow-up" size="small" />
                  </button>
                  <button
                    type="button"
                    class={tool}
                    aria-label={language.t("p1.columns.down")}
                    title={language.t("p1.columns.down")}
                    disabled={index() === state.list.length - 1}
                    onClick={() => shift(index(), 1)}
                  >
                    <Icon name="arrow-down-to-line" size="small" />
                  </button>
                  <button
                    type="button"
                    class={tool}
                    aria-label={language.t("p1.columns.remove")}
                    title={language.t("p1.columns.remove")}
                    disabled={item.id === pinned}
                    onClick={() => setState("list", (list) => list.filter((other) => other.id !== item.id))}
                  >
                    <Icon name="close-small" size="small" />
                  </button>
                </div>
              )}
            </For>
          </div>
        </section>
      </div>
    </Frame>
  )
}
