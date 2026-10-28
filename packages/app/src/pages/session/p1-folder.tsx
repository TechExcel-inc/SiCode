import { For, Show, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useLanguage } from "@/context/language"
import { add, edited, folder, made, names, roadmap, save, types, type Place, type Shape } from "@/p1/folder"
import { useP1 } from "@/p1/settings"
import { Frame, Rich } from "./p1-item"

const input =
  "h-9 w-full px-3 rounded-lg bg-surface-base border border-border-weaker-base text-13-regular text-text-strong outline-none focus:border-border-interactive-base disabled:opacity-60"

/** P1's folder dialog: edit the folder `id`, or with `place` add one inside, above or below it. */
export function P1Folder(props: {
  project: number
  id: number
  place?: Place
  onClose: () => void
  onSaved: (id: number, name: string) => void
}) {
  const p1 = useP1()
  const language = useLanguage()
  const [state, setState] = createStore({
    loading: true,
    busy: false,
    err: "",
    shape: { name: "", open: true, type: 0, html: "", start: "", end: "", from: "", to: "", parent: "" } as Shape,
    raw: {} as Record<string, unknown>,
    key: 0,
  })
  const fresh = () => props.place !== undefined
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err))
  const title = () => {
    if (!fresh()) return language.t("p1.folder.edit")
    if (props.place === 0) return language.t("p1.folder.child")
    return props.place === -1 ? language.t("p1.folder.above") : language.t("p1.folder.below")
  }
  // A month field shows YYYY-MM; P1 keeps YYYYMM.
  const month = (value: string) => (value.length === 6 ? `${value.slice(0, 4)}-${value.slice(4)}` : "")

  onMount(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose()
    }
    window.addEventListener("keydown", key)
    onCleanup(() => window.removeEventListener("keydown", key))
    // A new folder starts from the selected one's settings, as in P1, but with no name or description.
    void folder(p1.server(), p1.token(), props.project, props.id, language.locale())
      .then((found) =>
        setState({
          shape: fresh()
            ? { ...found.shape, name: "", html: "", open: true, type: types[found.shape.type] ? found.shape.type : 0 }
            : found.shape,
          raw: found.raw,
          loading: false,
          key: state.key + 1,
        }),
      )
      .catch((err: unknown) => setState({ err: message(err), loading: false }))
  })

  const submit = async () => {
    if (state.busy) return
    const shape = state.shape
    if (!shape.name.trim()) {
      setState("err", language.t("p1.form.required", { name: language.t("p1.folder.name") }))
      return
    }
    if (roadmap(shape.type) && (!shape.from || !shape.to)) {
      setState("err", language.t("p1.folder.months"))
      return
    }
    setState({ busy: true, err: "" })
    const host = p1.server()
    const token = p1.token()
    const id = await (fresh()
      ? add(host, token, made(props.project, props.id, props.place ?? 0, shape), language.locale())
      : save(host, token, edited(props.project, props.id, state.raw, shape), language.locale()).then(() => props.id)
    ).catch((err: unknown) => {
      setState({ err: message(err), busy: false })
    })
    if (id === undefined) return
    setState("busy", false)
    props.onSaved(id, shape.name.trim())
    props.onClose()
  }

  return (
    <Frame name="p1-folder" class="max-w-3xl max-h-[90vh]">
      <header class="shrink-0 px-6 py-4 flex items-center gap-3 border-b border-border-weaker-base">
        <div class="min-w-0 flex-1 truncate text-18-medium text-text-strong">{title()}</div>
        <Button
          variant="primary"
          size="large"
          disabled={state.loading || state.busy}
          onClick={() => void submit()}
          data-action="p1-folder-submit"
        >
          <Show when={state.busy}>
            <Spinner class="size-4" />
          </Show>
          {language.t("p1.folder.finish")}
        </Button>
        <Button variant="ghost" size="large" onClick={() => props.onClose()} data-action="p1-folder-cancel">
          {language.t("p1.form.cancel")}
        </Button>
      </header>
      <Show
        when={!state.loading}
        fallback={
          <div class="h-60 flex items-center justify-center text-13-regular text-text-weak">
            <Show when={state.err} fallback={<Spinner class="size-4" />}>
              <span class="text-text-diff-delete-base">{state.err}</span>
            </Show>
          </div>
        }
      >
        <Show when={state.err}>
          <p class="shrink-0 px-6 pt-3 text-12-regular text-text-diff-delete-base">{state.err}</p>
        </Show>
        <div class="flex-1 min-h-0 overflow-y-auto px-6 py-5 grid grid-cols-2 gap-x-6 gap-y-4">
          <Show when={state.shape.parent}>
            <div class="col-span-2 flex flex-col gap-1.5">
              <span class="text-12-medium text-text-weak">{language.t("p1.folder.parent")}</span>
              <span class="text-13-regular text-text-base truncate">{state.shape.parent}</span>
            </div>
          </Show>
          <div class="col-span-2 flex flex-col gap-1.5">
            <span class="text-12-medium text-text-diff-delete-base">{language.t("p1.folder.name")}</span>
            <input
              class={input}
              value={state.shape.name}
              ref={(el) => setTimeout(() => el.focus())}
              onInput={(event) => setState("shape", "name", event.currentTarget.value)}
              data-action="p1-folder-name"
            />
          </div>
          <Show when={!fresh()}>
            <div class="flex flex-col gap-1.5">
              <span class="text-12-medium text-text-weak">{language.t("p1.folder.status")}</span>
              <select
                class={input}
                value={state.shape.open ? "Open" : "Close"}
                onChange={(event) => setState("shape", "open", event.currentTarget.value === "Open")}
              >
                <option value="Open">{language.t("p1.folder.open")}</option>
                <option value="Close">{language.t("p1.folder.closed")}</option>
              </select>
            </div>
          </Show>
          <div class="flex flex-col gap-1.5">
            <span class="text-12-medium text-text-weak">{language.t("p1.folder.type")}</span>
            {/* P1 changes an existing folder's type with its own tool, so editing only shows it. */}
            <Show
              when={fresh()}
              fallback={<input class={input} value={names[state.shape.type] ?? String(state.shape.type)} disabled />}
            >
              <select
                class={input}
                value={String(state.shape.type)}
                onChange={(event) => setState("shape", "type", Number(event.currentTarget.value))}
              >
                <For each={Object.entries(types)}>{([id, name]) => <option value={id}>{name}</option>}</For>
              </select>
            </Show>
          </div>
          <Show when={roadmap(state.shape.type)}>
            <div class="flex flex-col gap-1.5">
              <span class="text-12-medium text-text-diff-delete-base">{language.t("p1.folder.from")}</span>
              <input
                class={input}
                type="month"
                value={month(state.shape.from)}
                onInput={(event) => setState("shape", "from", event.currentTarget.value.replace("-", ""))}
              />
            </div>
            <div class="flex flex-col gap-1.5">
              <span class="text-12-medium text-text-diff-delete-base">{language.t("p1.folder.to")}</span>
              <input
                class={input}
                type="month"
                value={month(state.shape.to)}
                onInput={(event) => setState("shape", "to", event.currentTarget.value.replace("-", ""))}
              />
            </div>
          </Show>
          <div class="flex flex-col gap-1.5">
            <span class="text-12-medium text-text-weak">{language.t("p1.folder.start")}</span>
            <input
              class={input}
              type="date"
              value={state.shape.start}
              onInput={(event) => setState("shape", "start", event.currentTarget.value)}
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <span class="text-12-medium text-text-weak">{language.t("p1.folder.end")}</span>
            <input
              class={input}
              type="date"
              value={state.shape.end}
              onInput={(event) => setState("shape", "end", event.currentTarget.value)}
            />
          </div>
          <div class="col-span-2 flex flex-col gap-1.5">
            <span class="text-12-medium text-text-weak">{language.t("p1.folder.description")}</span>
            <Show when={state.key} keyed>
              <Rich html={state.shape.html} readonly={false} onChange={(html) => setState("shape", "html", html)} />
            </Show>
          </div>
        </div>
      </Show>
    </Frame>
  )
}
