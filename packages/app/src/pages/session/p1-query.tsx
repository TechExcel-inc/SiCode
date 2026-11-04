import { For, Match, Show, Switch, createMemo, createSignal, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useLanguage } from "@/context/language"
import { owners, states } from "@/p1/api"
import type { Choice } from "@/p1/points"
import {
  adhoc,
  choices,
  condition,
  drop,
  editor,
  fields,
  none,
  queries,
  query,
  row,
  shared,
  store,
  type Field,
  type Query,
  type Row,
} from "@/p1/query"
import { useP1 } from "@/p1/settings"

type Pick = { id: number; name: string }

// The fields owners are picked for, and the field P1 lists states in.
const people = [1106, 1108, 1110, 1113]

/**
 * P1's search controls on the requirement list: advanced search, cancel search and the saved search the list shows.
 * Advanced search edits field conditions; Search saves them as the ad-hoc search and lists by it, Save keeps them
 * under a name, private or public.
 */
export function P1Query(props: {
  project: number
  folder: number
  value?: Pick
  disabled?: boolean
  onChange: (next?: Pick) => void
}) {
  const p1 = useP1()
  const language = useLanguage()
  const [state, setState] = createStore({
    list: [] as Query[],
    // The saved-search picker and its quick search.
    picking: false,
    find: "",
    // The advanced search panel: its fields, rows, formula, choices by field, and the save form.
    open: false,
    loading: false,
    busy: false,
    err: "",
    fields: [] as Field[],
    rows: [] as Row[],
    formula: false,
    words: "",
    choices: {} as Record<number, Choice[]>,
    adding: false,
    seek: "",
    saving: false,
    name: "",
    public: false,
    over: true,
    share: false,
  })
  const [sure, setSure] = createSignal(0)
  const host = () => p1.server()
  const token = () => p1.token()
  const locale = () => language.locale()
  const active = () => !!props.value?.id
  const fail = (err: unknown) => setState({ busy: false, loading: false, err: err instanceof Error ? err.message : String(err) })

  const refresh = () =>
    queries(host(), token(), props.project, locale())
      .then((list) => setState("list", list))
      .catch(() => undefined)

  const label = (item?: Pick) => {
    if (!item?.id) return language.t("p1.query.none")
    if (item.id === adhoc) return language.t("p1.query.adhoc")
    return item.name
  }

  // The choices a pick field offers, read once a row needs them.
  const offer = async (field: Field) => {
    if (state.choices[field.id]) return
    const kind = editor(field)
    if (kind !== "pick" && kind !== "one") return
    const list = await (people.includes(field.id)
      ? owners(host(), token(), props.project, props.folder, locale())
      : field.id === 1114
        ? states(host(), token(), props.project, locale()).then((all) =>
            all.map((item) => ({ id: item.id, name: item.name, closed: item.closed })),
          )
        : choices(host(), token(), props.project, field, p1.user(), locale())
    ).catch(() => [] as Choice[])
    setState("choices", field.id, list)
  }

  // Opens the panel on the search the list shows, its conditions read back into rows.
  const show = async () => {
    if (state.open) return setState("open", false)
    setState({ open: true, picking: false, loading: true, err: "", saving: false, adding: false })
    const [all, found, share] = await Promise.all([
      state.fields.length ? Promise.resolve(state.fields) : fields(host(), token(), props.project, locale()),
      active() ? query(host(), token(), props.project, props.value!.id, locale()) : Promise.resolve(undefined),
      shared(host(), token(), props.project, p1.user(), locale()).catch(() => false),
    ]).catch((err: unknown) => {
      fail(err)
      return [] as never[]
    })
    if (!all) return
    const rows = (found?.conditions ?? []).flatMap((data) => {
      const field = all.find((item) => item.id === Number(data.FieldId))
      return field ? [{ field, data }] : []
    })
    await Promise.all(rows.map((item) => offer(item.field)))
    const formula = found?.formula ?? ""
    const plain = rows.map((_, index) => letter(index)).join(" AND ")
    setState({
      fields: all,
      share,
      loading: false,
      rows: rows.map((item) => row(item.field, item.data, state.choices[item.field.id])),
      formula: !!formula && formula !== plain,
      words: formula,
    })
  }

  const conditions = () =>
    state.rows.flatMap((item) => {
      const made = condition(item, state.choices[item.field.id])
      return made ? [made] : []
    })
  const formula = () => (state.formula ? state.words.trim() : "")

  // Searches by the conditions: saved as the ad-hoc search, which the list then shows.
  const search = async () => {
    setState({ busy: true, err: "" })
    const id = await store(
      host(),
      token(),
      props.project,
      { id: adhoc, name: "", open: false, formula: formula(), conditions: conditions() },
      locale(),
    ).catch(fail)
    if (id === undefined) return
    setState({ busy: false, open: false })
    props.onChange({ id: adhoc, name: "" })
  }

  // Keeps the conditions under a name: over the search shown, or as a new one.
  const save = async () => {
    const name = state.name.trim()
    if (!name) return setState("err", language.t("p1.query.named"))
    setState({ busy: true, err: "" })
    const over = state.over && (props.value?.id ?? 0) > 0
    const same = !over ? state.list.find((item) => item.name.toLowerCase() === name.toLowerCase()) : undefined
    const id = await store(
      host(),
      token(),
      props.project,
      {
        id: over ? props.value!.id : (same?.id ?? 0),
        name,
        open: state.share && state.public,
        formula: formula(),
        conditions: conditions(),
      },
      locale(),
    ).catch(fail)
    if (id === undefined) return
    await refresh()
    setState({ busy: false, saving: false, open: false })
    props.onChange({ id, name })
  }

  // Cancels the search: no search on the list, and the ad-hoc one emptied, as P1 does.
  const cancel = () => {
    setState({ open: false, rows: [], words: "", formula: false })
    props.onChange(undefined)
    void store(host(), token(), props.project, { id: adhoc, name: "", open: false, formula: "", conditions: [] }, locale()).catch(
      () => undefined,
    )
  }

  const remove = async (item: Query) => {
    if (sure() !== item.id) return setSure(item.id)
    setSure(0)
    await drop(host(), token(), props.project, item.id, locale()).catch(fail)
    await refresh()
    if (props.value?.id === item.id) props.onChange(undefined)
  }

  const add = (field: Field) => {
    setState({ rows: [...state.rows, { field }], adding: false, seek: "" })
    void offer(field)
  }
  const edit = (index: number, next: Partial<Row>) => setState("rows", index, (item) => ({ ...item, ...next }))

  const shown = createMemo(() => {
    const words = state.find.trim().toLowerCase()
    const all = [
      { id: none, name: language.t("p1.query.none"), open: false, own: false },
      { id: adhoc, name: language.t("p1.query.adhoc"), open: false, own: false },
      ...state.list.map((item) => ({ ...item, own: true })),
    ]
    return words ? all.filter((item) => item.name.toLowerCase().includes(words)) : all
  })
  const free = createMemo(() => {
    const words = state.seek.trim().toLowerCase()
    return state.fields
      .filter((item) => !state.rows.some((one) => one.field.id === item.id))
      .filter((item) => !words || item.name.toLowerCase().includes(words))
  })

  const tool = "shrink-0 size-8 rounded-lg flex items-center justify-center border transition-colors disabled:opacity-50"
  const box =
    "h-8 min-w-0 px-2.5 rounded-lg border border-border-weaker-base bg-surface-base text-13-regular text-text-strong outline-none focus:border-border-interactive-base"

  return (
    <div data-component="p1-query" class="relative shrink-0 flex items-center gap-1.5">
      <div class="relative">
        <button
          type="button"
          data-action="p1-query-pick"
          class="w-[150px] h-8 pl-2.5 pr-1.5 flex items-center gap-1 rounded-lg border bg-surface-base text-13-regular hover:bg-surface-base-hover"
          classList={{
            "border-border-interactive-base text-text-strong": active(),
            "border-border-weaker-base text-text-base": !active(),
          }}
          disabled={props.disabled}
          aria-expanded={state.picking}
          onClick={() => {
            setState({ picking: !state.picking, find: "", open: false })
            if (!state.picking) return
            setSure(0)
            void refresh()
          }}
        >
          <span class="min-w-0 flex-1 truncate text-left">{label(props.value)}</span>
          <Icon name="chevron-down" size="small" class="shrink-0 text-icon-weak" />
        </button>
        <Show when={state.picking}>
          <div class="fixed inset-0 z-40" onClick={() => setState("picking", false)} />
          <div
            data-component="p1-query-list"
            class="absolute left-0 top-full mt-1 z-50 w-60 p-1.5 rounded-xl border border-border-weak-base bg-background-base shadow-lg"
          >
            <label class="h-8 px-2 mb-1 flex items-center gap-2 rounded-lg border border-border-weaker-base bg-surface-base focus-within:border-border-interactive-base">
              <Icon name="magnifying-glass" size="small" class="shrink-0 text-icon-weak" />
              <input
                ref={(el) => setTimeout(() => el.focus())}
                class="min-w-0 flex-1 bg-transparent text-13-regular text-text-strong placeholder:text-text-weak outline-none"
                value={state.find}
                placeholder={language.t("p1.query.quick")}
                onInput={(event) => setState("find", event.currentTarget.value)}
              />
            </label>
            <div class="max-h-72 overflow-y-auto flex flex-col gap-0.5">
              <For each={shown()}>
                {(item) => (
                  <div
                    class="group h-8 pl-2.5 pr-1 flex items-center gap-1.5 rounded-md text-13-regular cursor-pointer"
                    classList={{
                      "bg-surface-raised-base-active text-text-strong": (props.value?.id ?? 0) === item.id,
                      "text-text-base hover:bg-surface-raised-base-hover": (props.value?.id ?? 0) !== item.id,
                    }}
                    onClick={() => {
                      setState("picking", false)
                      if ((props.value?.id ?? 0) === item.id) return
                      props.onChange(item.id ? { id: item.id, name: item.name } : undefined)
                    }}
                  >
                    <span class="min-w-0 flex-1 truncate">{item.name}</span>
                    <Show when={item.open}>
                      <span class="shrink-0 text-11-regular text-text-weaker">{language.t("p1.query.public")}</span>
                    </Show>
                    <Show when={item.own}>
                      <button
                        type="button"
                        data-action="p1-query-delete"
                        class="shrink-0 h-6 px-1.5 rounded flex items-center gap-1 text-11-medium"
                        classList={{
                          "text-text-diff-delete-base bg-surface-critical-weak": sure() === item.id,
                          "text-icon-weak hover:text-text-strong hover:bg-surface-base-hover": sure() !== item.id,
                        }}
                        aria-label={language.t("p1.query.delete")}
                        title={language.t("p1.query.delete")}
                        onClick={(event) => {
                          event.stopPropagation()
                          void remove(item)
                        }}
                      >
                        <Icon name="trash" size="small" />
                        <Show when={sure() === item.id}>{language.t("p1.query.sure")}</Show>
                      </button>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>
      <button
        type="button"
        data-action="p1-query-advanced"
        class={tool}
        classList={{
          "bg-surface-interactive-base border-transparent text-text-on-interactive-base hover:opacity-90": active(),
          "border-border-weaker-base bg-surface-base text-text-strong hover:bg-surface-base-hover": !active(),
        }}
        disabled={props.disabled}
        aria-label={language.t("p1.query.advanced")}
        title={language.t("p1.query.advanced")}
        aria-expanded={state.open}
        onClick={() => void show()}
      >
        <Icon name="magnifying-glass" size="small" />
      </button>
      <button
        type="button"
        data-action="p1-query-cancel"
        class={`${tool} border-border-weaker-base bg-surface-base text-text-strong hover:bg-surface-base-hover`}
        disabled={props.disabled || !active()}
        aria-label={language.t("p1.query.cancel")}
        title={language.t("p1.query.cancel")}
        onClick={cancel}
      >
        <Icon name="circle-ban-sign" size="small" />
      </button>
      <Show when={state.open}>
        <div class="fixed inset-0 z-40" onClick={() => setState("open", false)} />
        <div
          data-component="p1-query-panel"
          class="absolute left-0 top-full mt-1 z-50 w-[600px] max-h-[75vh] flex flex-col rounded-xl border border-border-weak-base bg-background-base shadow-lg"
        >
          <div class="shrink-0 h-12 pl-4 pr-2 flex items-center gap-2 border-b border-border-weaker-base">
            <span class="min-w-0 flex-1 truncate text-14-medium text-text-strong">{language.t("p1.query.title")}</span>
            <button
              type="button"
              data-action="p1-query-clear"
              class="h-8 px-3 rounded-lg text-13-regular text-text-base hover:bg-surface-base-hover"
              onClick={() => setState({ rows: [], words: "", formula: false, err: "" })}
            >
              {language.t("p1.query.clear")}
            </button>
            <button
              type="button"
              data-action="p1-query-save"
              class="h-8 px-3 rounded-lg border border-border-weaker-base bg-surface-base text-13-medium text-text-strong hover:bg-surface-base-hover disabled:opacity-50"
              disabled={state.busy || !conditions().length}
              onClick={() =>
                setState({
                  saving: !state.saving,
                  name: (props.value?.id ?? 0) > 0 ? props.value!.name : "",
                  over: (props.value?.id ?? 0) > 0,
                  err: "",
                })
              }
            >
              {language.t("p1.query.save")}
            </button>
            <button
              type="button"
              data-action="p1-query-search"
              class="h-8 px-3.5 rounded-lg flex items-center gap-1.5 bg-surface-interactive-base text-13-medium text-text-on-interactive-base hover:opacity-90 disabled:opacity-50"
              disabled={state.busy || state.loading}
              onClick={() => void search()}
            >
              <Show when={state.busy}>
                <Spinner class="size-3.5" />
              </Show>
              {language.t("p1.query.search")}
            </button>
          </div>
          <Show when={state.saving}>
            <div data-component="p1-query-saving" class="shrink-0 px-4 py-3 flex flex-col gap-2.5 border-b border-border-weaker-base bg-surface-base">
              <Show when={(props.value?.id ?? 0) > 0}>
                <div class="flex items-center gap-4 text-13-regular text-text-base">
                  <Radio on={state.over} onClick={() => setState({ over: true, name: props.value!.name })}>
                    {language.t("p1.query.over", { name: props.value!.name })}
                  </Radio>
                  <Radio on={!state.over} onClick={() => setState({ over: false, name: "" })}>
                    {language.t("p1.query.asnew")}
                  </Radio>
                </div>
              </Show>
              <div class="flex items-center gap-2">
                <input
                  ref={(el) => setTimeout(() => el.focus())}
                  data-action="p1-query-name"
                  class={`${box} flex-1`}
                  value={state.name}
                  placeholder={language.t("p1.query.name")}
                  onInput={(event) => setState("name", event.currentTarget.value)}
                  onKeyDown={(event) => event.key === "Enter" && void save()}
                />
                <Show when={state.share && !(state.over && (props.value?.id ?? 0) > 0)}>
                  <div class="shrink-0 flex items-center gap-3 px-1 text-13-regular text-text-base">
                    <Radio on={!state.public} onClick={() => setState("public", false)}>
                      {language.t("p1.query.private")}
                    </Radio>
                    <Radio on={state.public} onClick={() => setState("public", true)}>
                      {language.t("p1.query.public")}
                    </Radio>
                  </div>
                </Show>
                <button
                  type="button"
                  data-action="p1-query-store"
                  class="shrink-0 h-8 px-3.5 rounded-lg bg-surface-interactive-base text-13-medium text-text-on-interactive-base hover:opacity-90 disabled:opacity-50"
                  disabled={state.busy}
                  onClick={() => void save()}
                >
                  {language.t("p1.query.keep")}
                </button>
              </div>
            </div>
          </Show>
          <Show when={state.err}>
            <p class="shrink-0 px-4 pt-2 text-12-regular text-text-diff-delete-base">{state.err}</p>
          </Show>
          <div class="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-2">
            <Show
              when={!state.loading}
              fallback={
                <div class="h-24 flex items-center justify-center">
                  <Spinner class="size-4" />
                </div>
              }
            >
              <Show when={!state.rows.length}>
                <p class="py-2 text-13-regular text-text-weak">{language.t("p1.query.empty")}</p>
              </Show>
              <For each={state.rows}>
                {(item, index) => (
                  <div data-component="p1-query-row" class="group flex items-start gap-2">
                    <Show when={state.formula}>
                      <span class="shrink-0 w-5 h-8 flex items-center justify-center text-12-medium text-text-interactive-base">
                        {letter(index())}
                      </span>
                    </Show>
                    <span class="shrink-0 w-40 h-8 flex items-center text-13-regular text-text-base truncate" title={item.field.name}>
                      {item.field.name}
                    </span>
                    <div class="min-w-0 flex-1">
                      <Value
                        row={item}
                        choices={state.choices[item.field.id]}
                        box={box}
                        onChange={(next) => edit(index(), next)}
                      />
                    </div>
                    <button
                      type="button"
                      class="shrink-0 size-8 rounded-lg flex items-center justify-center text-icon-weak hover:text-text-strong hover:bg-surface-base-hover"
                      aria-label={language.t("p1.query.remove")}
                      title={language.t("p1.query.remove")}
                      onClick={() => setState("rows", (all) => all.filter((_, at) => at !== index()))}
                    >
                      <Icon name="close-small" size="small" />
                    </button>
                  </div>
                )}
              </For>
              <Show when={state.rows.length < 26}>
                <div class="relative">
                  <button
                    type="button"
                    data-action="p1-query-add"
                    class="h-8 px-2 -ml-2 rounded-md flex items-center gap-1.5 text-13-medium text-text-interactive-base hover:bg-surface-base-hover"
                    onClick={() => setState({ adding: !state.adding, seek: "" })}
                  >
                    <Icon name="plus-small" size="small" />
                    {language.t("p1.query.add")}
                  </button>
                  <Show when={state.adding}>
                    <div class="absolute left-0 top-full mt-1 z-10 w-72 p-1.5 rounded-xl border border-border-weak-base bg-background-base shadow-lg">
                      <input
                        ref={(el) => setTimeout(() => el.focus())}
                        class={`${box} w-full mb-1`}
                        value={state.seek}
                        placeholder={language.t("p1.query.field")}
                        onInput={(event) => setState("seek", event.currentTarget.value)}
                        onKeyDown={(event) => event.key === "Escape" && setState("adding", false)}
                      />
                      <div class="max-h-60 overflow-y-auto flex flex-col gap-0.5">
                        <For each={free()}>
                          {(field) => (
                            <button
                              type="button"
                              data-action="p1-query-field"
                              class="h-8 px-2.5 rounded-md text-left text-13-regular text-text-base hover:bg-surface-raised-base-hover truncate"
                              onClick={() => add(field)}
                            >
                              {field.name}
                            </button>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                </div>
              </Show>
            </Show>
          </div>
          <div class="shrink-0 px-4 py-2.5 flex items-center gap-3 border-t border-border-weaker-base">
            <label class="shrink-0 flex items-center gap-2 text-13-regular text-text-base cursor-pointer">
              <input
                type="checkbox"
                class="size-4 accent-[var(--surface-interactive-base)]"
                checked={state.formula}
                onChange={(event) =>
                  setState({
                    formula: event.currentTarget.checked,
                    words: state.words || state.rows.map((_, index) => letter(index)).join(" AND "),
                  })
                }
              />
              {language.t("p1.query.formula")}
            </label>
            <Show when={state.formula}>
              <input
                class={`${box} flex-1 font-mono`}
                value={state.words}
                placeholder="A AND (B OR C)"
                onInput={(event) => setState("words", event.currentTarget.value.toUpperCase())}
              />
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}

/** A condition row's letter in the formula: A for the first, B for the second. */
function letter(index: number) {
  return String.fromCharCode(65 + index)
}

function Radio(props: { on: boolean; onClick: () => void; children: JSX.Element }) {
  return (
    <button type="button" class="flex items-center gap-1.5" aria-pressed={props.on} onClick={() => props.onClick()}>
      <span
        class="size-3.5 rounded-full border flex items-center justify-center"
        classList={{ "border-border-interactive-base": props.on, "border-border-strong-base": !props.on }}
      >
        <Show when={props.on}>
          <span class="size-2 rounded-full bg-surface-interactive-base" />
        </Show>
      </span>
      {props.children}
    </button>
  )
}

/** The editor for one condition's value, by the field's kind. */
function Value(props: { row: Row; choices?: Choice[]; box: string; onChange: (next: Partial<Row>) => void }) {
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)
  const [find, setFind] = createSignal("")
  const kind = () => editor(props.row.field)
  const picked = () => props.row.picks ?? []
  const names = () =>
    picked()
      .map((id) => props.choices?.find((item) => String(item.id) === id)?.name)
      .filter(Boolean)
      .join(", ")
  const toggle = (id: string) =>
    props.onChange({ picks: picked().includes(id) ? picked().filter((one) => one !== id) : [...picked(), id] })
  const states = () => props.choices as (Choice & { closed?: boolean })[] | undefined
  const group = (closed: boolean) => (states() ?? []).filter((item) => !!item.closed === closed).map((item) => String(item.id))
  const listed = () => {
    const words = find().trim().toLowerCase()
    return (props.choices ?? []).filter((item) => !words || item.name.toLowerCase().includes(words))
  }
  return (
    <Switch>
      <Match when={kind() === "text"}>
        <input
          class={`${props.box} w-full`}
          value={props.row.words ?? ""}
          onInput={(event) => props.onChange({ words: event.currentTarget.value })}
        />
      </Match>
      <Match when={kind() === "number" || kind() === "date"}>
        <div class="flex items-center gap-2">
          <input
            type={kind() === "date" ? "date" : "number"}
            class={`${props.box} flex-1`}
            value={props.row.from ?? ""}
            placeholder={language.t("p1.query.from")}
            onInput={(event) => props.onChange({ from: event.currentTarget.value })}
          />
          <span class="shrink-0 text-12-regular text-text-weak">–</span>
          <input
            type={kind() === "date" ? "date" : "number"}
            class={`${props.box} flex-1`}
            value={props.row.to ?? ""}
            placeholder={language.t("p1.query.to")}
            onInput={(event) => props.onChange({ to: event.currentTarget.value })}
          />
        </div>
      </Match>
      <Match when={kind() === "yes"}>
        <div class="h-8 flex items-center gap-4 text-13-regular text-text-base">
          <For each={["yes", "no", ""] as const}>
            {(item) => (
              <Radio on={(props.row.yes ?? "") === item} onClick={() => props.onChange({ yes: item })}>
                {language.t(`p1.query.${item || "any"}`)}
              </Radio>
            )}
          </For>
        </div>
      </Match>
      <Match when={kind() === "one"}>
        <select
          class={`${props.box} w-full`}
          value={picked()[0] ?? ""}
          onChange={(event) => props.onChange({ picks: event.currentTarget.value ? [event.currentTarget.value] : [] })}
        >
          <option value="" />
          <For each={props.choices ?? []}>{(item) => <option value={String(item.id)}>{item.name}</option>}</For>
        </select>
      </Match>
      <Match when={kind() === "pick"}>
        <div class="relative">
          <button
            type="button"
            class={`${props.box} w-full flex items-center gap-1 text-left`}
            onClick={() => (setOpen(!open()), setFind(""))}
          >
            <span class="min-w-0 flex-1 truncate" classList={{ "text-text-weak": !picked().length }}>
              {names() || language.t("p1.query.choose")}
            </span>
            <Show when={!props.choices}>
              <Spinner class="size-3.5 shrink-0" />
            </Show>
            <Icon name="chevron-down" size="small" class="shrink-0 text-icon-weak" />
          </button>
          <Show when={open()}>
            <div class="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div class="absolute left-0 right-0 top-full mt-1 z-20 p-1.5 rounded-xl border border-border-weak-base bg-background-base shadow-lg">
              <input
                ref={(el) => setTimeout(() => el.focus())}
                class={`${props.box} w-full mb-1`}
                value={find()}
                placeholder={language.t("p1.query.quick")}
                onInput={(event) => setFind(event.currentTarget.value)}
              />
              <div class="max-h-56 overflow-y-auto flex flex-col gap-0.5">
                {/* States can be picked all open or all closed at once, as P1's {Open only} and {Close only}. */}
                <Show when={props.row.field.id === 1114 && !find()}>
                  <For each={[false, true]}>
                    {(closed) => {
                      const ids = () => group(closed)
                      const on = () => ids().length > 0 && ids().every((id) => picked().includes(id))
                      return (
                        <label class="h-8 px-2.5 flex items-center gap-2 rounded-md text-13-medium text-text-strong hover:bg-surface-raised-base-hover cursor-pointer">
                          <input
                            type="checkbox"
                            class="size-4 accent-[var(--surface-interactive-base)]"
                            checked={on()}
                            onChange={() =>
                              props.onChange({
                                picks: on()
                                  ? picked().filter((id) => !ids().includes(id))
                                  : [...new Set([...picked(), ...ids()])],
                              })
                            }
                          />
                          {language.t(closed ? "p1.query.closed" : "p1.query.open")}
                        </label>
                      )
                    }}
                  </For>
                </Show>
                <For each={listed()}>
                  {(item) => (
                    <label class="h-8 px-2.5 flex items-center gap-2 rounded-md text-13-regular text-text-base hover:bg-surface-raised-base-hover cursor-pointer">
                      <input
                        type="checkbox"
                        class="size-4 accent-[var(--surface-interactive-base)]"
                        checked={picked().includes(String(item.id))}
                        onChange={() => toggle(String(item.id))}
                      />
                      <span class="truncate">{item.name}</span>
                    </label>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>
      </Match>
    </Switch>
  )
}
