import DOMPurify from "dompurify"
import { For, Show, createMemo, onCleanup, onMount, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useLanguage } from "@/context/language"
import {
  blank,
  create,
  created,
  entry,
  fixedField,
  load,
  rich,
  rules,
  select,
  update,
  wide,
  type Choice,
  type Field,
  type Page,
  type Rules,
  type State,
  type Value,
} from "@/p1/form"
import { useP1 } from "@/p1/settings"

const input =
  "h-9 w-full px-3 rounded-lg bg-surface-base border border-border-weaker-base text-13-regular text-text-strong outline-none focus:border-border-interactive-base disabled:opacity-60"

const empty: Value = { value: "", choice: "", html: "" }

/** P1's requirement dialog: edit one (`id`) or create one in `folder`. */
export function P1Item(props: {
  project: number
  folder: number
  id?: number
  onClose: () => void
  onSaved: (id: number) => void
  onDesign?: () => void
}) {
  const p1 = useP1()
  const language = useLanguage()
  const [state, setState] = createStore({
    loading: true,
    busy: false,
    err: "",
    pages: [] as Page[],
    page: 0,
    values: {} as Record<number, Value>,
    // What the form started with, to send only what changed.
    start: {} as Record<number, Value>,
    states: [] as State[],
    current: 0,
    // The state picked with the buttons, saved on Submit.
    next: undefined as State | undefined,
    rules: { readonly: [], hidden: [], required: [], locked: false } as Rules,
    choices: {} as Record<number, Choice[]>,
    owners: [] as Choice[],
    folder: props.folder,
    update: 0,
    access: 4,
  })
  const fresh = () => !props.id
  const fields = createMemo(() => state.pages[state.page]?.fields ?? [])
  const all = () => state.pages.flatMap((page) => page.fields)
  const locked = () => state.rules.locked || state.access < 2
  const shown = (field: Field) => !state.rules.hidden.includes(field.id)
  const required = (field: Field) => field.id === 1101 || state.rules.required.includes(field.id)
  const readonly = (field: Field) =>
    locked() || field.id === 1114 || fixedField(field.id) || state.rules.readonly.includes(field.id)
  const value = (id: number) => state.values[id] ?? empty
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

  const init = async () => {
    const host = p1.server()
    const token = p1.token()
    setState({ loading: true, err: "" })
    if (props.id) {
      const found = await load(host, token, props.project, props.id, p1.user(), language.locale()).catch(
        (err: unknown) => {
          setState({ err: message(err), loading: false })
        },
      )
      if (!found) return
      setState({
        pages: found.pages,
        values: found.values,
        start: structuredClone(found.values),
        states: found.states,
        current: found.state,
        rules: found.rules,
        folder: found.folder || props.folder,
        update: found.update,
        access: found.access,
        choices: found.choices,
        owners: found.owners,
        loading: false,
      })
      return
    }
    const found = await blank(host, token, props.project, props.folder, p1.user(), language.locale()).catch(
      (err: unknown) => {
        setState({ err: message(err), loading: false })
      },
    )
    if (!found) return
    const me = found.owners.find((item) => String(item.id) === p1.user())
    setState({
      pages: found.pages,
      values: me ? { 1113: { value: me.name, choice: String(me.id), html: "" } } : {},
      start: {},
      states: found.states,
      next: found.first,
      rules: found.rules,
      choices: found.choices,
      owners: found.owners,
      page: 0,
      loading: false,
    })
  }

  const move = async (next: State) => {
    if (locked()) return
    const same = state.next?.id === next.id && state.next?.transition === next.transition
    const chosen = same && !fresh() ? undefined : next
    setState("next", chosen)
    const found = await rules(
      p1.server(),
      p1.token(),
      props.project,
      props.id ?? 0,
      chosen?.id ?? state.current,
      chosen?.transition ?? 0,
      p1.user(),
      state.pages,
      language.locale(),
    )
    setState("rules", found)
  }

  const set = (id: number, next: Partial<Value>) => setState("values", id, { ...value(id), ...next })

  const submit = async (more: boolean) => {
    if (state.busy || locked()) return
    const missing = all().find((field) => shown(field) && required(field) && !filled(field, value(field.id)))
    if (missing) {
      setState("err", language.t("p1.form.required", { name: missing.name }))
      return
    }
    const host = p1.server()
    const token = p1.token()
    setState({ busy: true, err: "" })
    if (props.id) {
      const changed = all()
        .filter((field) => !readonly(field) && differs(field, value(field.id), state.start[field.id] ?? empty))
        .map((field) => entry(field, value(field.id)))
      const values = state.next ? [...changed, { ID: 1114, ChoiceId: state.next.id }] : changed
      if (!values.length) {
        setState("busy", false)
        props.onClose()
        return
      }
      const ok = await update(
        host,
        token,
        { project: props.project, id: props.id, folder: state.folder, update: state.update, values },
        language.locale(),
      )
        .then(() => true)
        .catch((err: unknown) => {
          setState({ err: message(err), busy: false })
          return false
        })
      if (!ok) return
      setState("busy", false)
      props.onSaved(props.id)
      props.onClose()
      return
    }
    const owner = state.owners.find((item) => String(item.id) === value(1113).choice)
    const body = created({
      project: props.project,
      folder: props.folder,
      user: p1.user(),
      name: p1.name(),
      state: state.next,
      owner,
      fields: all().filter((field) => !readonly(field)),
      values: state.values,
    })
    const id = await create(host, token, body, language.locale()).catch((err: unknown) => {
      setState({ err: message(err), busy: false })
    })
    if (id === undefined) return
    setState("busy", false)
    props.onSaved(id)
    if (!more) {
      props.onClose()
      return
    }
    await init()
  }

  const key = (event: KeyboardEvent) => {
    if (event.key === "Escape") props.onClose()
  }
  onMount(() => {
    window.addEventListener("keydown", key)
    void init()
  })
  onCleanup(() => window.removeEventListener("keydown", key))

  return (
    <Frame name="p1-item" class="max-w-5xl h-full max-h-[90vh]">
        <header class="shrink-0 px-6 py-4 flex items-center gap-3 border-b border-border-weaker-base">
          <div class="min-w-0 flex-1 truncate text-18-medium text-text-strong">
            {fresh() ? language.t("p1.form.new") : language.t("p1.form.edit", { id: String(props.id) })}
          </div>
          <Show when={props.onDesign}>
            <Button variant="ghost" size="large" onClick={() => props.onDesign?.()} data-action="p1-item-design">
              {language.t("p1.open")}
            </Button>
          </Show>
          <Show when={fresh()}>
            <Button
              variant="secondary"
              size="large"
              disabled={state.loading || state.busy}
              onClick={() => void submit(true)}
              data-action="p1-item-continue"
            >
              {language.t("p1.form.continue")}
            </Button>
          </Show>
          <Button
            variant="primary"
            size="large"
            disabled={state.loading || state.busy || locked()}
            onClick={() => void submit(false)}
            data-action="p1-item-submit"
          >
            <Show when={state.busy}>
              <Spinner class="size-4" />
            </Show>
            {language.t("p1.form.submit")}
          </Button>
          <Button variant="ghost" size="large" onClick={() => props.onClose()} data-action="p1-item-close">
            {fresh() ? language.t("p1.form.cancel") : language.t("p1.form.close")}
          </Button>
        </header>
        <Show
          when={!state.loading}
          fallback={
            <div class="flex-1 flex items-center justify-center gap-2 text-13-regular text-text-weak">
              <Show when={state.err} fallback={<Spinner class="size-4" />}>
                <span class="text-text-diff-delete-base">{state.err}</span>
              </Show>
            </div>
          }
        >
          <div class="shrink-0 px-6 pt-4 flex flex-wrap gap-2">
            <Show when={!fresh() && state.current}>
              <span
                class="h-8 px-3 rounded-lg border text-13-medium flex items-center"
                classList={{
                  "border-border-interactive-base bg-surface-interactive-base text-text-on-interactive-base": !state.next,
                  "border-border-weaker-base text-text-weak": !!state.next,
                }}
              >
                {value(1114).value}
              </span>
            </Show>
            <For each={state.states}>
              {(item) => (
                <button
                  type="button"
                  data-action="p1-item-state"
                  class="h-8 px-3 rounded-lg border text-13-medium disabled:opacity-60"
                  classList={{
                    "border-border-interactive-base bg-surface-interactive-base text-text-on-interactive-base":
                      state.next?.id === item.id && state.next?.transition === item.transition,
                    "border-border-weaker-base text-text-base hover:bg-surface-base-hover": !(
                      state.next?.id === item.id && state.next?.transition === item.transition
                    ),
                  }}
                  disabled={locked()}
                  onClick={() => void move(item)}
                >
                  {item.name}
                </button>
              )}
            </For>
          </div>
          <Show when={state.pages.length > 1}>
            <nav class="shrink-0 px-6 pt-3 flex gap-1 border-b border-border-weaker-base">
              <For each={state.pages}>
                {(page, index) => (
                  <button
                    type="button"
                    class="h-9 px-3 -mb-px border-b-2 text-13-medium"
                    classList={{
                      "border-text-interactive-base text-text-strong": state.page === index(),
                      "border-transparent text-text-weak hover:text-text-base": state.page !== index(),
                    }}
                    onClick={() => setState("page", index())}
                  >
                    {page.name}
                  </button>
                )}
              </For>
            </nav>
          </Show>
          <Show when={state.err}>
            <p class="shrink-0 px-6 pt-3 text-12-regular text-text-diff-delete-base">{state.err}</p>
          </Show>
          <div class="flex-1 min-h-0 overflow-y-auto px-6 py-5">
            <div class="grid grid-cols-2 gap-x-6 gap-y-4">
              <For each={fields().filter(shown)}>
                {(field) => (
                  <div class="flex flex-col gap-1.5 min-w-0" classList={{ "col-span-2": wide(field) }}>
                    <span
                      class="text-12-medium"
                      classList={{
                        "text-text-diff-delete-base": required(field),
                        "text-text-weak": !required(field),
                      }}
                    >
                      {field.name}
                    </span>
                    <Control
                      field={field}
                      value={value(field.id)}
                      readonly={readonly(field)}
                      choices={field.id === 1113 ? state.owners : (state.choices[field.id] ?? [])}
                      state={field.id === 1114 ? (state.next?.name ?? value(1114).value) : undefined}
                      onChange={(next) => set(field.id, next)}
                    />
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
    </Frame>
  )
}

/** A dialog frame that clearly sits above the page: a dimmed window, a raised panel with a strong edge and a deep shadow. */
export function Frame(props: { name: string; class: string; children: JSX.Element }) {
  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ "background-color": "rgb(0 0 0 / 0.55)" }}
      data-component={props.name}
    >
      <div
        class={`w-full flex flex-col rounded-xl overflow-hidden ${props.class}`}
        style={{
          border: "1px solid var(--border-strong-base)",
          background: "var(--surface-raised-stronger-non-alpha)",
          "box-shadow": "var(--shadow-lg-border-base), 0 24px 64px rgb(0 0 0 / 0.5), 0 4px 16px rgb(0 0 0 / 0.3)",
        }}
      >
        {props.children}
      </div>
    </div>
  )
}

function Control(props: {
  field: Field
  value: Value
  readonly: boolean
  choices: Choice[]
  state?: string
  onChange: (next: Partial<Value>) => void
}) {
  if (props.state !== undefined) return <input class={input} value={props.state} disabled />
  if (rich(props.field)) return <Rich html={props.value.html} readonly={props.readonly} onChange={(html) => props.onChange({ html })} />
  if (props.field.type === 8) {
    const picked = () => props.value.choice.split(",").filter(Boolean)
    return (
      <div class="min-h-9 flex flex-wrap gap-1.5 p-1.5 rounded-lg bg-surface-base border border-border-weaker-base">
        <For each={props.choices}>
          {(item) => (
            <button
              type="button"
              disabled={props.readonly}
              class="h-6 px-2 rounded-md text-12-regular disabled:opacity-60"
              classList={{
                "bg-surface-interactive-base text-text-on-interactive-base": picked().includes(String(item.id)),
                "text-text-base hover:bg-surface-base-hover": !picked().includes(String(item.id)),
              }}
              onClick={(event) => {
                event.preventDefault()
                const id = String(item.id)
                const next = picked().includes(id) ? picked().filter((x) => x !== id) : [...picked(), id]
                props.onChange({ choice: next.join(","), value: "" })
              }}
            >
              {item.name}
            </button>
          )}
        </For>
      </div>
    )
  }
  if (select(props.field)) {
    // Keep the current choice even when it isn't in the list (an inactive owner, say).
    const options = () =>
      props.value.choice && props.value.choice !== "0" && !props.choices.some((item) => String(item.id) === props.value.choice)
        ? [{ id: Number(props.value.choice), name: props.value.value }, ...props.choices]
        : props.choices
    return (
      <select
        class={input}
        disabled={props.readonly}
        value={props.value.choice}
        onChange={(event) => {
          const id = event.currentTarget.value
          props.onChange({ choice: id, value: options().find((item) => String(item.id) === id)?.name ?? "" })
        }}
      >
        <option value="" />
        <For each={options()}>{(item) => <option value={String(item.id)}>{item.name}</option>}</For>
      </select>
    )
  }
  if (props.field.type === 14)
    return (
      <input
        type="checkbox"
        class="size-4"
        disabled={props.readonly}
        checked={props.value.value === "1" || props.value.value === "true"}
        onChange={(event) => props.onChange({ value: event.currentTarget.checked ? "1" : "0" })}
      />
    )
  const type = props.field.type === 1 || props.field.type === 2 ? "number" : props.field.type === 3 ? "date" : "text"
  return (
    <input
      class={input}
      type={type}
      disabled={props.readonly}
      value={type === "date" ? props.value.value.slice(0, 10) : props.value.value}
      onInput={(event) => props.onChange({ value: event.currentTarget.value })}
    />
  )
}

/** A small rich-text editor for P1's HTML fields. What comes from P1 is sanitized before it's shown. */
export function Rich(props: { html: string; readonly: boolean; onChange: (html: string) => void }) {
  let box: HTMLDivElement | undefined
  const run = (command: string, arg?: string) => {
    box?.focus()
    document.execCommand(command, false, arg)
    if (box) props.onChange(box.innerHTML)
  }
  const tools: { icon: string; command: string; label: string }[] = [
    { icon: "B", command: "bold", label: "Bold" },
    { icon: "I", command: "italic", label: "Italic" },
    { icon: "U", command: "underline", label: "Underline" },
    { icon: "S", command: "strikeThrough", label: "Strikethrough" },
  ]
  return (
    <div class="flex flex-col rounded-lg border border-border-weaker-base bg-surface-base overflow-hidden">
      <Show when={!props.readonly}>
        <div class="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-border-weaker-base">
          <select
            class="h-7 px-1.5 rounded-md bg-transparent text-12-regular text-text-base outline-none"
            onChange={(event) => run("formatBlock", event.currentTarget.value)}
          >
            <option value="p">Paragraph</option>
            <option value="h1">Heading 1</option>
            <option value="h2">Heading 2</option>
            <option value="h3">Heading 3</option>
          </select>
          <For each={tools}>
            {(tool) => (
              <button
                type="button"
                class="size-7 rounded-md text-13-medium text-text-base hover:bg-surface-base-hover"
                classList={{
                  italic: tool.command === "italic",
                  underline: tool.command === "underline",
                  "line-through": tool.command === "strikeThrough",
                }}
                aria-label={tool.label}
                title={tool.label}
                onMouseDown={(event) => {
                  event.preventDefault()
                  run(tool.command)
                }}
              >
                {tool.icon}
              </button>
            )}
          </For>
          <button
            type="button"
            class="size-7 rounded-md flex items-center justify-center text-text-base hover:bg-surface-base-hover"
            aria-label="Bulleted list"
            title="Bulleted list"
            onMouseDown={(event) => {
              event.preventDefault()
              run("insertUnorderedList")
            }}
          >
            <Icon name="bullet-list" size="small" />
          </button>
          <button
            type="button"
            class="h-7 px-1.5 rounded-md text-12-medium text-text-base hover:bg-surface-base-hover"
            aria-label="Numbered list"
            title="Numbered list"
            onMouseDown={(event) => {
              event.preventDefault()
              run("insertOrderedList")
            }}
          >
            1.
          </button>
        </div>
      </Show>
      <div
        ref={(el) => {
          box = el
          el.innerHTML = DOMPurify.sanitize(props.html)
        }}
        contentEditable={!props.readonly}
        class="min-h-64 max-h-[50vh] overflow-y-auto px-4 py-3 text-13-regular text-text-strong outline-none [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_h1]:text-18-medium [&_h2]:text-16-medium [&_h3]:text-14-medium [&_p]:my-1 [&_img]:max-w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border-weaker-base [&_td]:px-2"
        onInput={(event) => props.onChange(event.currentTarget.innerHTML)}
      />
    </div>
  )
}

function filled(field: Field, value: Value) {
  if (rich(field)) return !!value.html.replace(/<[^>]+>/g, "").trim()
  if (select(field) || field.type === 8) return !!value.choice && value.choice !== "0"
  return !!value.value.trim()
}

function differs(field: Field, next: Value, prev: Value) {
  if (rich(field)) return next.html !== prev.html
  if (select(field) || field.type === 8) return next.choice !== prev.choice
  return next.value !== prev.value
}
