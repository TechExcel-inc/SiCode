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
  system,
  update,
  widget,
  type Choice,
  type Field,
  type Page,
  type Rules,
  type State,
  type Value,
} from "@/p1/form"
import { useP1 } from "@/p1/settings"
import { stories } from "@/p1/stories"
import { arrange } from "@/p1/layout"
import { tabs } from "@/p1/tabs"
import { Ck } from "./p1-ck"
import { Attachments, Notes } from "./p1-files"
import { P1Page } from "./p1-page"
import { Tip } from "./p1-tip"

const empty: Value = { value: "", choice: "", html: "" }

/**
 * P1's requirement editor: edit one (`id`) or create one in `folder`. As a dialog it saves on Submit; docked
 * beside the list (`dock`) it saves with its Save button, or by itself when it closes or moves to another spec.
 */
export function P1Item(props: {
  project: number
  folder: number
  id?: number
  dock?: boolean
  onClose: () => void
  onSaved: (id: number) => void
  onExpand?: () => void
  onFail?: (err: string) => void
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
    // The spec's points: what its stories' points add up to.
    points: undefined as number | undefined,
    // The form's width, the list icon's menu, and the question before closing with changes.
    width: 0,
    menu: false,
    confirm: false,
  })
  const fresh = () => !props.id
  const fields = createMemo(() => state.pages[state.page]?.fields ?? [])
  const all = () => state.pages.flatMap((page) => page.fields)
  const locked = () => state.rules.locked || state.access < 2
  const shown = (field: Field) => !state.rules.hidden.includes(field.id)
  const required = (field: Field) => field.id === 1101 || state.rules.required.includes(field.id)
  const readonly = (field: Field) =>
    locked() ||
    field.id === 1114 ||
    field.id === 1131 ||
    field.id === 1121 ||
    widget(field) ||
    field.id === 1143 ||
    fixedField(field.id) ||
    state.rules.readonly.includes(field.id)
  const value = (id: number) => state.values[id] ?? empty
  const shows = (id: number) =>
    id === 1131 && state.points !== undefined ? { ...value(id), value: state.points.toFixed(1) } : value(id)
  // The fields changed since the form was read, with a picked state last, as `PUT ReqItem` takes them.
  const changes = () => {
    const changed = all()
      .filter((field) => !readonly(field) && differs(field, value(field.id), state.start[field.id] ?? empty))
      .map((field) => entry(field, value(field.id)))
    return state.next ? [...changed, { ID: 1114, ChoiceId: state.next.id }] : changed
  }
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

  const init = async () => {
    const host = p1.server()
    const token = p1.token()
    setState({ loading: true, err: "" })
    if (props.id) {
      const id = props.id
      void stories(host, token, props.project, id, language.locale())
        .then((list) =>
          setState(
            "points",
            list.reduce((sum, story) => sum + story.target, 0),
          ),
        )
        .catch(() => undefined)
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
        next: undefined,
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
      const values = changes()
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
      // Docked, the editor stays open on the saved spec, read again for its new state and rules.
      if (props.dock) return void init()
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
    if (event.key === "Escape" && !props.dock && !state.confirm) close()
  }
  onMount(() => {
    window.addEventListener("keydown", key)
    void init()
  })
  onCleanup(() => {
    window.removeEventListener("keydown", key)
    // Docked, what you changed saves as the editor closes or moves to another spec, as P1's panel does.
    if (!props.dock || !props.id || state.loading || state.busy || locked()) return
    const values = changes()
    if (!values.length) return
    const id = props.id
    void update(
      p1.server(),
      p1.token(),
      { project: props.project, id, folder: state.folder, update: state.update, values },
      language.locale(),
    )
      .then(() => props.onSaved(id))
      .catch((err: unknown) => props.onFail?.(message(err)))
  })

  // Changed fields carry P1's red corner mark until they are saved.
  const touched = (field: Field) => !readonly(field) && differs(field, value(field.id), state.start[field.id] ?? empty)
  const page = () => state.pages[state.page]
  // P1 places a designed page's fields where its designer drew them, once the form is wider than 500px.
  const rows = createMemo(() => {
    const list = fields().filter(shown)
    if (props.dock || state.width <= 500 || !list.length || !list.some((field) => field.at)) return
    return arrange(list, state.width)
  })
  const close = () => {
    if (!props.dock && !fresh() && changes().length) return setState("confirm", true)
    props.onClose()
  }
  const watch = (el: HTMLDivElement) => {
    const resize = new ResizeObserver(() => setState("width", Math.trunc(el.clientWidth - 20)))
    resize.observe(el)
    onCleanup(() => resize.disconnect())
  }

  // One field as P1 draws it: its label right-aligned in the room the designer gave it, then the control.
  const Item = (item: { field: Field; label?: number; split?: number; bare?: boolean }) => (
    <Show
      when={item.field.type !== 23}
      fallback={
        <div class="px-2.5 py-[5px]">
          <Attachments
            project={props.project}
            id={props.id}
            name={item.field.name}
            label={item.bare ? 0 : (item.label ?? 100)}
            split={item.split ?? 0}
            must={required(item.field)}
            readonly={locked()}
          />
        </div>
      }
    >
      <div
        class="relative flex items-center min-h-11 px-2.5 py-[5px]"
        classList={{ "items-start": rich(item.field) || widget(item.field) }}
      >
        <Show when={touched(item.field)}>
          <span class="absolute left-0 top-0 border-[5px] border-r-transparent border-b-transparent border-t-[#d7201f] border-l-[#d7201f]" />
        </Show>
        <Show when={!item.bare}>
          <span
            class="shrink-0 mr-2.5 text-14-regular text-right line-clamp-2 break-words"
            classList={{
              "text-[#d7201f]": required(item.field),
              "text-text-strong": !required(item.field),
              "pt-1.5": rich(item.field),
            }}
            style={{ width: `${item.label ?? 100}px` }}
          >
            {item.field.name}
          </span>
          <Show when={item.split}>
            <span class="shrink-0" style={{ width: `${item.split}px` }} />
          </Show>
        </Show>
        <div class="min-w-0 flex-1">
          <Control
            field={item.field}
            value={shows(item.field.id)}
            readonly={readonly(item.field)}
            choices={item.field.id === 1113 ? state.owners : (state.choices[item.field.id] ?? [])}
            state={item.field.id === 1114 ? { now: value(1114).value, next: state.next } : undefined}
            project={props.project}
            spec={props.id}
            onChange={(next) => set(item.field.id, next)}
          />
        </div>
      </div>
    </Show>
  )

  const form = () => (
    <div ref={watch} class="py-2.5 pr-2.5">
      <Show
        when={rows()}
        fallback={
          <div
            classList={{
              "grid grid-cols-2": !props.dock,
              "flex flex-col": !!props.dock,
            }}
          >
            <For each={fields().filter(shown)}>
              {(field) => (
                <div classList={{ "col-span-2": !props.dock && (field.id === 1101 || rich(field)) }}>
                  <Item field={field} label={props.dock ? 96 : 100} bare={field.type === 14 || field.type === 18} />
                </div>
              )}
            </For>
          </div>
        }
      >
        {(list) => (
          <For each={list()}>
            {(row) => (
              <div class="flex">
                <For each={row.columns}>
                  {(column) => (
                    <div
                      class="shrink-0 grid items-start"
                      style={{
                        width: `${column.width}px`,
                        "margin-left": `${column.left}px`,
                        "margin-top": `${column.top}px`,
                      }}
                    >
                      <For each={column.items}>
                        {(item) => (
                          <div
                            class="col-start-1 self-start"
                            style={{
                              "grid-row": String(item.line + 1),
                              width: `${item.width}px`,
                              "margin-left": `${item.left}px`,
                              "margin-top": `${item.top}px`,
                            }}
                          >
                            <Item field={item.field} label={item.label} split={item.split} bare={item.bare} />
                          </div>
                        )}
                      </For>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        )}
      </Show>
    </div>
  )

  const body = () => (
    <>
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
        {/* P1's state buttons: where the spec can go next, orange when that closes it, filled once picked. */}
        <Show when={state.states.length && !locked()}>
          <div class="shrink-0 px-2.5 pb-2.5 flex flex-wrap gap-x-2.5">
            <For each={state.states}>
              {(item) => {
                const on = () => state.next?.id === item.id && state.next?.transition === item.transition
                const color = item.closed ? "#E99A16" : "#00AAFF"
                return (
                  <button
                    type="button"
                    data-action="p1-item-state"
                    class="mt-2.5 px-2.5 py-[5px] rounded-[5px] border text-14-regular"
                    style={{
                      "border-color": color,
                      background: on() ? color : "transparent",
                      color: on() ? "#fff" : "var(--text-strong)",
                    }}
                    onClick={() => void move(item)}
                  >
                    {item.name}
                  </button>
                )
              }}
            </For>
          </div>
        </Show>
        <Show when={state.pages.length > 1}>
          <nav class="relative shrink-0 flex overflow-x-auto" classList={{ "px-2.5": !props.dock }}>
            <span class="absolute inset-x-0 bottom-0 border-b border-border-weaker-base" />
            <For each={state.pages}>
              {(item, index) => (
                <button
                  type="button"
                  data-action="p1-item-tab"
                  class="relative z-[1] shrink-0 px-2.5 py-[5px] flex items-center whitespace-nowrap text-14-regular border-b"
                  classList={{
                    "text-[#00AAFF] border-[#00AAFF]": state.page === index(),
                    "text-text-strong border-transparent": state.page !== index(),
                  }}
                  onClick={() => setState("page", index())}
                >
                  <TabIcon page={item.parent} />
                  {item.name}
                </button>
              )}
            </For>
          </nav>
        </Show>
        <Show when={state.err}>
          <p class="shrink-0 px-5 pt-3 text-12-regular text-text-diff-delete-base">{state.err}</p>
        </Show>
        <div class="flex-1 min-h-0 overflow-y-auto">
          <Show
            when={page() && system.includes(page()!.parent) && !page()!.fields.length && props.id ? page() : undefined}
            fallback={form()}
          >
            {(open) => <P1Page kind={open().parent} project={props.project} id={props.id!} folder={state.folder} />}
          </Show>
        </div>
      </Show>
    </>
  )

  if (props.dock)
    return (
      <div data-component="p1-panel" class="h-full flex flex-col min-w-0">
        <header class="shrink-0 h-12 pl-4 pr-2 flex items-center gap-1 border-b border-border-weaker-base">
          <span class="min-w-0 flex-1 truncate font-mono text-14-medium text-text-strong">#{props.id}</span>
          <Show when={!state.loading && changes().length}>
            <Button
              variant="primary"
              size="small"
              disabled={state.busy || locked()}
              onClick={() => void submit(false)}
              data-action="p1-panel-save"
            >
              <Show when={state.busy}>
                <Spinner class="size-3.5" />
              </Show>
              {language.t("p1.panel.save")}
            </Button>
          </Show>
          <Show when={props.onExpand}>
            <button
              type="button"
              data-action="p1-panel-expand"
              class="size-8 rounded-lg flex items-center justify-center text-icon-weak hover:text-text-strong hover:bg-surface-base-hover"
              aria-label={language.t("p1.panel.expand")}
              onClick={() => props.onExpand?.()}
            >
              <Icon name="square-arrow-top-right" size="small" />
            </button>
          </Show>
          <button
            type="button"
            data-action="p1-panel-close"
            class="size-8 rounded-lg flex items-center justify-center text-icon-weak hover:text-text-strong hover:bg-surface-base-hover"
            aria-label={language.t("common.close")}
            onClick={() => props.onClose()}
          >
            <Icon name="close" size="small" />
          </button>
        </header>
        {body()}
      </div>
    )

  return (
    <Frame name="p1-item" class="max-w-[80vw] h-[80vh]">
      <header class="shrink-0 px-5 py-2.5 flex items-center gap-2.5 border-b border-border-weaker-base">
        <div class="min-w-0 flex-1 truncate text-18-medium text-text-strong">
          <Show when={!fresh()} fallback={language.t("p1.form.new")}>
            {language.t("p1.item.edit", { type: value(1121).value || language.t("p1.item.requirement") })}
            <span class="ml-1.5">{props.id}</span>
          </Show>
        </div>
        <Show when={!fresh()}>
          <div class="relative mr-2.5">
            <button
              type="button"
              data-action="p1-item-menu"
              class="size-8 rounded border border-border-weak-base flex items-center justify-center text-text-base hover:text-text-strong"
              aria-label={language.t("p1.item.more")}
              onClick={() => setState("menu", (open) => !open)}
            >
              <Icon name="bullet-list" size="small" />
            </button>
            <Show when={state.menu}>
              <div class="fixed inset-0 z-10" onClick={() => setState("menu", false)} />
              <div
                class="absolute right-0 top-full mt-1.5 z-20 w-56 py-1.5 rounded-xl border border-border-strong-base bg-surface-raised-stronger-non-alpha"
                style={{ "box-shadow": "0 12px 32px rgb(0 0 0 / 0.35)" }}
              >
                <For each={["delete", "type", "parent", "folder", "link", "graph"]}>
                  {(key) => (
                    <div class="h-8 pl-[22px] pr-3 flex items-center justify-between gap-3 text-14-regular text-text-weak cursor-default">
                      <span class="truncate">{language.t(`p1.item.menu.${key}`)}</span>
                      <span class="shrink-0 text-11-regular text-text-weaker">{language.t("p1.tab.soon")}</span>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
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
        <Button variant="ghost" size="large" onClick={close} data-action="p1-item-close">
          {fresh() ? language.t("p1.form.cancel") : language.t("p1.form.close")}
        </Button>
      </header>
      {body()}
      {/* Closing with changes asks first, as P1 does: save them, drop them, or stay. */}
      <Show when={state.confirm}>
        <div class="absolute inset-0 z-30 flex items-center justify-center" style={{ background: "rgb(0 0 0 / 0.35)" }}>
          <div
            class="w-[300px] p-5 flex flex-col gap-4 rounded-xl border border-border-strong-base bg-surface-raised-stronger-non-alpha"
            style={{ "box-shadow": "0 12px 32px rgb(0 0 0 / 0.35)" }}
          >
            <p class="text-14-regular text-text-strong">{language.t("p1.item.changed")}</p>
            <div class="flex justify-end gap-2">
              <Button
                variant="primary"
                size="small"
                onClick={() => {
                  setState("confirm", false)
                  void submit(false)
                }}
              >
                {language.t("p1.panel.save")}
              </Button>
              <Button variant="secondary" size="small" onClick={() => props.onClose()}>
                {language.t("p1.item.discard")}
              </Button>
              <Button variant="ghost" size="small" onClick={() => setState("confirm", false)}>
                {language.t("common.cancel")}
              </Button>
            </div>
          </div>
        </div>
      </Show>
    </Frame>
  )
}

/** P1's icon for a page tab: links, history, the description page, events, or its custom-page icon. */
function TabIcon(props: { page: number }) {
  const icon = () => {
    if (props.page === 107) return tabs.link
    if (props.page === 104) return tabs.history
    if (props.page === 1505) return tabs.default
    if (props.page === 106) return tabs.event
    return tabs.custom
  }
  return (
    <svg class="size-4 shrink-0 mr-[5px]" viewBox={icon().box} fill="currentColor" aria-hidden="true">
      <For each={icon().paths}>{(d) => <path d={d} />}</For>
    </svg>
  )
}

const input =
  "h-8 w-full px-[7px] rounded border border-border-weak-base bg-background-base text-14-regular text-text-strong outline-none focus:border-[#00AAFF] disabled:bg-surface-base disabled:text-text-weak disabled:cursor-not-allowed"

/** A control with P1's button on its right end: "…" to pick through a dialog, "+" to add. */
function Append(props: { text: string; mark: "more" | "add"; children?: JSX.Element }) {
  const language = useLanguage()
  return (
    <div class="h-8 flex rounded border border-border-weak-base overflow-hidden">
      <span class="min-w-0 flex-1 px-[7px] flex items-center truncate bg-surface-base text-14-regular text-text-weak cursor-not-allowed">
        {props.text}
      </span>
      <span class="relative group/tip shrink-0 w-8 flex items-center justify-center border-l border-border-weak-base bg-background-base text-text-base">
        {props.mark === "more" ? "···" : <Icon name="plus-small" size="small" />}
        <Tip side="right" text={language.t("p1.tab.soon")} />
      </span>
    </div>
  )
}

function Control(props: {
  field: Field
  value: Value
  readonly: boolean
  choices: Choice[]
  state?: { now: string; next?: State }
  project: number
  spec?: number
  onChange: (next: Partial<Value>) => void
}) {
  const language = useLanguage()
  if (props.field.type === 13) return <Notes project={props.project} id={props.spec} />
  if (props.field.type === 18)
    return <div class="ml-2.5 text-14-regular text-text-strong whitespace-pre-wrap">{props.field.name}</div>
  // Labels (1611) and the product module (1606) live in Kloud's services; their boxes show what P1 shows empty.
  if (props.field.id === 1611)
    return (
      <div class="relative group/tip min-h-8 pl-2.5 flex flex-wrap items-center rounded border border-border-weak-base">
        <span class="h-[21px] px-2.5 flex items-center rounded-r bg-[#2c8cf0] text-white text-[20px] leading-none">
          +
        </span>
        <Tip side="left" text={language.t("p1.tab.soon")} />
      </div>
    )
  if (props.field.id === 1606)
    return (
      <div class="relative group/tip flex gap-2.5">
        <div class="min-w-0 flex-1 h-8 px-[7px] flex items-center justify-between rounded-[5px] border border-border-weak-base text-14-regular text-text-weaker">
          {language.t("p1.item.select")}
          <Icon name="chevron-down" size="small" />
        </div>
        <div class="min-w-0 flex-1">
          <Append text="" mark="more" />
        </div>
        <Tip side="left" text={language.t("p1.tab.soon")} />
      </div>
    )
  if (props.field.id === 1149)
    return <div class="h-8 flex items-center text-13-regular text-text-weak">{language.t("p1.tab.soon")}</div>
  // State: read only, and once a state button is picked, the move from the current state to it.
  if (props.state)
    return (
      <div class="h-8 px-2.5 flex items-center gap-2 rounded border border-border-weak-base bg-surface-base text-14-regular text-text-weak cursor-not-allowed">
        <span class="truncate">{props.state.now}</span>
        <Show when={props.state.next}>
          {(next) => (
            <>
              <Icon name="arrow-right" size="small" class="shrink-0" />
              <span class="truncate" style={{ color: next().closed ? "#E99A16" : "#00AAFF" }}>
                {next().name}
              </span>
            </>
          )}
        </Show>
      </div>
    )
  if (rich(props.field))
    return <Ck html={props.value.html} readonly={props.readonly} onChange={(html) => props.onChange({ html })} />
  if (props.field.id === 1143) return <Append text={`${props.value.value || 0}h`} mark="add" />
  if (props.field.id === 1103 || props.field.id === 1104 || props.field.id === 1121)
    return <Append text={props.value.value.replace(/\//g, "\\")} mark="more" />
  if (props.field.id === 1601) {
    const month = () =>
      /^\d{6}$/.test(props.value.value)
        ? `${props.value.value.slice(0, 4)}-${props.value.value.slice(4)}`
        : props.value.value
    return (
      <input
        class={input}
        type="month"
        disabled={props.readonly}
        value={month()}
        onInput={(event) => props.onChange({ value: event.currentTarget.value.replace("-", "") })}
      />
    )
  }
  if (props.field.type === 8) {
    const picked = () => props.value.choice.split(",").filter(Boolean)
    return (
      <div class="min-h-8 flex flex-wrap gap-1.5 p-1 rounded border border-border-weak-base bg-background-base">
        <For each={props.choices}>
          {(item) => (
            <button
              type="button"
              disabled={props.readonly}
              class="h-6 px-2 rounded text-13-regular disabled:opacity-60"
              classList={{
                "bg-[#00AAFF] text-white": picked().includes(String(item.id)),
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
      props.value.choice &&
      props.value.choice !== "0" &&
      !props.choices.some((item) => String(item.id) === props.value.choice)
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
      <label class="h-8 flex items-center gap-2 text-14-regular text-text-strong">
        <input
          type="checkbox"
          class="size-4"
          disabled={props.readonly}
          checked={props.value.value === "1" || props.value.value === "true"}
          onChange={(event) => props.onChange({ value: event.currentTarget.checked ? "1" : "0" })}
        />
        {props.field.name}
      </label>
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

/** A dialog frame that clearly sits above the page: a dimmed window, a raised panel with a strong edge and a deep shadow. */
export function Frame(props: { name: string; class: string; children: JSX.Element }) {
  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ "background-color": "rgb(0 0 0 / 0.55)" }}
      data-component={props.name}
    >
      <div
        class={`relative w-full flex flex-col rounded-xl overflow-hidden ${props.class}`}
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
