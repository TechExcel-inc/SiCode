import { For, Match, Show, Switch, createMemo, createSignal, onMount } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useLanguage } from "@/context/language"
import {
  entry,
  fixedField,
  load,
  rich,
  rules,
  select,
  update,
  type Choice,
  type Field,
  type State,
  type Value,
} from "@/p1/form"
import { useP1 } from "@/p1/settings"
import { Rich } from "./p1-item"
import { P1Pop, layer } from "./p1-pop"

const gap = 16
const ring = "shadow-[0_0_0_2px_var(--border-interactive-base)]"
const box =
  "h-8 w-full min-w-0 px-2 rounded-md bg-surface-base text-13-regular text-text-strong outline-none disabled:opacity-60 " +
  ring

// What each requirement's form holds, kept for a few minutes and refreshed after every save, so a
// cell opens at once instead of waiting on P1.
const cache = new Map<string, { at: number; data: ReturnType<typeof load> }>()
const fresh = 5 * 60_000
const known = new Map<string, { field: Field; choices: Choice[]; moves: State[] }>()

/** Starts loading a requirement's form before you click, so its cells open at once. */
export function prime(
  server: string,
  token: string,
  project: number,
  id: number,
  user: string,
  locale: string,
  force = false,
) {
  const tag = `${server}|${project}|${id}`
  const hit = cache.get(tag)
  if (hit && !force && Date.now() - hit.at < fresh) return hit.data
  const data = load(server, token, project, id, user, locale)
  cache.set(tag, { at: Date.now(), data })
  data.catch(() => cache.get(tag)?.data === data && cache.delete(tag))
  return data
}

/**
 * Edits one field of a requirement right in its list cell: a box to type in, a searchable list,
 * a calendar or a switch, by field type; multi-select and rich text open a popup. The state lists the
 * moves P1's workflow allows from where it is now, and the owner the people who can take it in its folder.
 * A field you can't change says so in the cell.
 */
export function P1Inline(props: {
  project: number
  id: number
  col: number
  text: string
  folder: number
  status: string
  onDone: (text?: string) => void
}) {
  const p1 = useP1()
  const language = useLanguage()
  const [state, setState] = createStore({
    field: undefined as Field | undefined,
    value: { value: "", choice: "", html: "" } as Value,
    start: { value: "", choice: "", html: "" } as Value,
    choices: [] as Choice[],
    folder: 0,
    update: 0,
    busy: false,
    err: "",
    readonly: false,
    // The workflow's moves from the current state, and what the form holds, to check a move's required fields.
    moves: [] as State[],
    pages: [] as Field[],
    values: {} as Record<number, Value>,
  })
  const [rect, setRect] = createSignal<DOMRect>()
  let root: HTMLDivElement | undefined
  const tag = `${p1.server()}|${props.project}|${props.id}`

  // The requirement's own form: its rules, folder and update number. Saving waits for it.
  const ready = prime(p1.server(), p1.token(), props.project, props.id, p1.user(), language.locale())
  // Cells in the same column, folder and state share a field and its choices, so the next one opens at once.
  const key = `${p1.server()}|${props.project}|${props.folder}|${props.col}|${props.status}`

  const show = (field: Field, choices: Choice[], moves: State[]) => {
    if (field.id === 1114)
      return setState({
        field,
        moves,
        choices: moves.map((item, index) => ({ id: index + 1, name: item.name })),
        value: { value: props.text, choice: "", html: "" },
        start: { value: props.text, choice: "", html: "" },
      })
    const choice = select(field) ? String(choices.find((item) => item.name === props.text)?.id ?? "") : ""
    setState({
      field,
      choices,
      value: { value: props.text, choice, html: "" },
      start: { value: props.text, choice, html: "" },
    })
  }

  onMount(async () => {
    setRect(root?.closest("td")?.getBoundingClientRect())
    const seen = known.get(key)
    if (seen && !rich(seen.field)) show(seen.field, seen.choices, seen.moves)
    const found = await ready.catch((err: unknown) => {
      setState("err", err instanceof Error ? err.message : String(err))
    })
    if (!found) return
    const all = found.pages.flatMap((page) => page.fields)
    // Title, owner and state sit above P1's form pages, so they may not be on them.
    const field =
      all.find((item) => item.id === props.col) ??
      (props.col === 1101
        ? { id: 1101, name: "", type: 5 }
        : props.col === 1113
          ? { id: 1113, name: "", type: 7 }
          : props.col === 1114
            ? { id: 1114, name: "", type: 7 }
            : undefined)
    setState({ folder: found.folder, update: found.update, pages: all, values: found.values })
    const locked = found.rules.locked || found.access < 2
    if (
      !field ||
      locked ||
      fixedField(field.id) ||
      found.rules.readonly.includes(field.id) ||
      (field.id === 1114 && !found.states.length)
    ) {
      setState({ readonly: true, busy: false })
      setTimeout(() => props.onDone(), 1500)
      return
    }
    const choices = field.id === 1113 ? found.owners : (found.choices[field.id] ?? [])
    known.set(key, { field, choices, moves: found.states })
    // A pick already on its way keeps what you chose.
    if (state.busy) return
    if (field.id === 1114) return show(field, choices, found.states)
    const value = found.values[field.id] ?? { value: "", choice: "", html: "" }
    // Keep the current choice even when it isn't in the list (an inactive owner, say).
    const extra =
      select(field) && value.choice && value.choice !== "0" && !choices.some((item) => String(item.id) === value.choice)
    setState({
      field,
      value: { ...value },
      start: { ...value },
      choices: extra ? [{ id: Number(value.choice), name: value.value }, ...choices] : choices,
    })
  })

  // Saving needs the requirement's own form; a cell opened from what others showed may still be fetching it.
  const wait = async () => {
    await ready.catch(() => undefined)
    if (!state.readonly && state.update) return true
    setState("busy", false)
    if (!state.readonly) setState("err", state.err || language.t("p1.inline.readonly"))
    return false
  }

  const kind = () => {
    const field = state.field
    if (!field) return
    if (rich(field)) return "rich"
    if (field.type === 8) return "multi"
    if (select(field)) return "select"
    if (field.type === 14) return "check"
    if (field.type === 3) return "date"
    if (field.type === 1 || field.type === 2) return "number"
    return "text"
  }

  const names = (choice: string) =>
    choice
      .split(",")
      .filter(Boolean)
      .map((id) => state.choices.find((item) => String(item.id) === id)?.name ?? "")
      .filter(Boolean)
      .join(", ")

  // Moves the state the way P1's workflow does, once the fields the move requires are filled in.
  const shift = async (pick: string) => {
    const move = state.moves[Number(pick) - 1]
    if (!move || state.busy) return props.onDone()
    setState({ busy: true, err: "" })
    if (!(await wait())) return
    const found = await rules(
      p1.server(),
      p1.token(),
      props.project,
      props.id,
      move.id,
      move.transition,
      p1.user(),
      [],
      language.locale(),
    ).catch(() => undefined)
    const missing = state.pages.filter((field) => {
      if (!found?.required.includes(field.id) || field.id === 1114) return false
      const value = state.values[field.id]
      if (!value) return true
      if (rich(field)) return !value.html.replace(/<[^>]+>/g, "").trim()
      if (select(field) || field.type === 8) return !value.choice || value.choice === "0"
      return !value.value.trim()
    })
    if (missing.length) {
      setState({
        busy: false,
        err: language.t("p1.inline.needs", { fields: missing.map((field) => field.name).join(", ") }),
      })
      return
    }
    const ok = await update(
      p1.server(),
      p1.token(),
      {
        project: props.project,
        id: props.id,
        folder: state.folder,
        update: state.update,
        values: [{ ID: 1114, ChoiceId: move.id }],
      },
      language.locale(),
    )
      .then(() => true)
      .catch((err: unknown) => {
        setState({ busy: false, err: err instanceof Error ? err.message : String(err) })
        return false
      })
    if (!ok) {
      cache.delete(tag)
      return
    }
    void prime(p1.server(), p1.token(), props.project, props.id, p1.user(), language.locale(), true).catch(
      () => undefined,
    )
    props.onDone(move.name)
  }

  const save = async (next: Partial<Value>) => {
    const field = state.field
    if (!field || state.busy) return
    if (field.id === 1114) return shift(next.choice ?? "")
    const value = { ...state.value, ...next }
    setState("value", value)
    if (value.value === state.start.value && value.choice === state.start.choice && value.html === state.start.html)
      return props.onDone()
    setState({ busy: true, err: "" })
    if (!(await wait())) return
    const ok = await update(
      p1.server(),
      p1.token(),
      {
        project: props.project,
        id: props.id,
        folder: state.folder,
        update: state.update,
        values: [entry(field, value)],
      },
      language.locale(),
    )
      .then(() => true)
      .catch((err: unknown) => {
        setState({ busy: false, err: err instanceof Error ? err.message : String(err) })
        return false
      })
    if (!ok) {
      cache.delete(tag)
      return
    }
    void prime(p1.server(), p1.token(), props.project, props.id, p1.user(), language.locale(), true).catch(
      () => undefined,
    )
    if (select(field)) return props.onDone(names(value.choice))
    if (field.type === 8) return props.onDone(names(value.choice))
    if (rich(field))
      return props.onDone(
        value.html
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      )
    props.onDone(value.value)
  }

  const keys = (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (event.key === "Escape") {
      event.preventDefault()
      props.onDone()
    }
    if (event.key === "Enter") {
      event.preventDefault()
      void save({ value: event.currentTarget.value })
    }
  }

  // The cell as it reads while a list, calendar or popup is open over it.
  const Chip = (chip: { text: string; icon?: "chevron-down" }) => (
    <div class={`h-8 px-2 -mx-2 flex items-center gap-1.5 rounded-md bg-surface-base ${ring}`}>
      <span class="min-w-0 flex-1 truncate text-text-strong">{chip.text}</span>
      <Show
        when={state.busy}
        fallback={chip.icon && <Icon name={chip.icon} size="small" class="shrink-0 text-icon-weak" />}
      >
        <Spinner class="size-3.5 shrink-0" />
      </Show>
    </div>
  )

  return (
    <div ref={root} class="flex flex-col gap-1" data-component="p1-inline" onClick={(event) => event.stopPropagation()}>
      <Switch>
        <Match when={state.readonly}>
          <div class="h-8 flex items-center gap-1.5 text-text-weak">
            <span class="min-w-0 truncate">{props.text}</span>
            <span class="shrink-0 h-5 px-1.5 rounded flex items-center gap-1 bg-surface-base text-11-medium">
              <Icon name="circle-ban-sign" size="small" />
              {language.t("p1.inline.readonly")}
            </span>
          </div>
        </Match>
        <Match when={!state.field}>
          <div class="h-8 flex items-center gap-2">
            <span class="min-w-0 flex-1 truncate text-text-weak">{props.text}</span>
            <Show when={!state.err}>
              <Spinner class="size-3.5 shrink-0" />
            </Show>
          </div>
        </Match>
        <Match when={kind() === "select" || kind() === "multi"}>
          <Chip text={names(state.value.choice) || state.value.value || props.text} icon="chevron-down" />
          <Show when={rect()}>
            {(at) => (
              <Menu
                at={at()}
                items={state.choices}
                picked={state.value.choice.split(",").filter(Boolean)}
                many={kind() === "multi"}
                people={state.field?.id === 1113 || state.field?.id === 1145}
                onPick={(choice) => void save({ choice, value: names(choice) })}
                onClose={() => !state.busy && props.onDone()}
                clear={state.field?.id !== 1114}
                note={state.err}
              />
            )}
          </Show>
        </Match>
        <Match when={kind() === "date"}>
          <Chip text={state.value.value.slice(0, 10)} icon="chevron-down" />
          <Show when={rect()}>
            {(at) => (
              <Calendar
                at={at()}
                value={state.value.value.slice(0, 10)}
                onPick={(value) => void save({ value })}
                onClose={() => props.onDone()}
              />
            )}
          </Show>
        </Match>
        <Match when={kind() === "check"}>
          <Toggle
            on={state.value.value === "1" || state.value.value === "true"}
            busy={state.busy}
            onChange={(on) => void save({ value: on ? "1" : "0" })}
            onClose={() => props.onDone()}
          />
        </Match>
        <Match when={kind() === "rich"}>
          <Chip text={props.text} />
          <P1Pop
            name="rich"
            x={rect()?.left ?? window.innerWidth / 2}
            y={rect()?.bottom ?? 120}
            width={640}
            min={{ w: 420, h: 280 }}
            onClose={() => props.onDone()}
          >
            <div data-drag class="shrink-0 px-5 pt-4 pb-3 border-b border-border-weaker-base cursor-move select-none">
              <div class="text-12-medium text-text-weak">#{props.id}</div>
              <div class="mt-0.5 text-14-medium text-text-strong">{state.field?.name}</div>
            </div>
            <div class="flex-1 min-h-0 overflow-y-auto p-4">
              <Rich
                html={state.value.html}
                readonly={state.busy}
                onChange={(html) => setState("value", "html", html)}
              />
            </div>
            <Show when={state.err}>
              <p class="px-5 pb-2 text-12-regular text-text-diff-delete-base">{state.err}</p>
            </Show>
            <div class="shrink-0 px-5 py-3 flex items-center justify-end gap-2 border-t border-border-weaker-base">
              <Show when={state.busy}>
                <Spinner class="size-4" />
              </Show>
              <Button variant="ghost" size="large" onClick={() => props.onDone()}>
                {language.t("p1.form.cancel")}
              </Button>
              <Button variant="primary" size="large" disabled={state.busy} onClick={() => void save({})}>
                {language.t("p1.inline.save")}
              </Button>
            </div>
          </P1Pop>
        </Match>
        <Match when={kind() === "number"}>
          <div class="flex items-center gap-1.5 -mx-2">
            <input
              ref={(el) =>
                queueMicrotask(() => {
                  el.focus()
                  el.select()
                })
              }
              class={`${box} text-right`}
              type="number"
              disabled={state.busy}
              value={state.value.value}
              onKeyDown={keys}
              onBlur={(event) => void save({ value: event.currentTarget.value })}
            />
            <Show when={state.busy}>
              <Spinner class="size-3.5 shrink-0" />
            </Show>
          </div>
        </Match>
        <Match when={kind() === "text"}>
          {/* Wraps and grows like the cell it replaces, in the same type, so the text doesn't jump. */}
          <div class="relative -mx-2 -my-1">
            <textarea
              ref={(el) =>
                queueMicrotask(() => {
                  grow(el)
                  el.focus()
                  el.setSelectionRange(el.value.length, el.value.length)
                })
              }
              rows={1}
              class={`block w-full resize-none overflow-hidden px-2 py-1 rounded-md bg-surface-base outline-none disabled:opacity-60 ${ring}`}
              classList={{
                "text-14-medium text-text-strong": props.col === 1101,
                "text-13-regular text-text-strong": props.col !== 1101,
                "pr-7": state.busy,
              }}
              disabled={state.busy}
              value={state.value.value}
              onInput={(event) => grow(event.currentTarget)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault()
                  props.onDone()
                }
                // A field is one line in P1, so Enter saves rather than breaking the line.
                if (event.key === "Enter") {
                  event.preventDefault()
                  void save({ value: event.currentTarget.value.replace(/\s*\n\s*/g, " ") })
                }
              }}
              onBlur={(event) => void save({ value: event.currentTarget.value.replace(/\s*\n\s*/g, " ") })}
            />
            <Show when={state.busy}>
              <Spinner class="absolute right-2 top-2 size-3.5" />
            </Show>
          </div>
        </Match>
      </Switch>
      <Show when={state.err && kind() !== "rich" && kind() !== "select" && kind() !== "multi"}>
        <p class="text-12-regular text-text-diff-delete-base whitespace-normal">{state.err}</p>
      </Show>
    </div>
  )
}

/** Where a panel under a cell goes: below it, or above when there's no room, kept inside the window. */
function place(at: DOMRect, width: number, height: number) {
  const left = Math.max(gap, Math.min(at.left, window.innerWidth - width - gap))
  const below = at.bottom + 4 + height <= window.innerHeight - gap
  return {
    left: `${left}px`,
    top: `${below ? at.bottom + 4 : Math.max(gap, at.top - height - 4)}px`,
    width: `${width}px`,
  }
}

const panel =
  "fixed flex flex-col rounded-xl overflow-hidden border border-border-strong-base bg-surface-raised-stronger-non-alpha"
const shadow = "var(--shadow-lg-border-base), 0 16px 48px rgb(0 0 0 / 0.45)"

/** A searchable list to pick one choice from, or several with checkmarks; people show their initials. */
export function Menu(props: {
  at: DOMRect
  items: Choice[]
  picked: string[]
  many: boolean
  people: boolean
  clear?: boolean
  note?: string
  onPick: (choice: string) => void
  onClose: () => void
}) {
  const language = useLanguage()
  const [state, setState] = createStore({ query: "", active: 0, picked: [...props.picked] })
  const shown = createMemo(() => {
    const query = state.query.trim().toLowerCase()
    return props.items.filter((item) => !query || item.name.toLowerCase().includes(query))
  })
  const width = Math.max(props.at.width + 16, 280)
  const height = Math.min(360, 56 + Math.max(1, props.items.length + (props.many ? 0 : 1)) * 36 + (props.many ? 52 : 0))
  let list: HTMLDivElement | undefined

  const done = () => props.onPick(state.picked.join(","))
  const pick = (item?: Choice) => {
    if (!props.many) return props.onPick(item ? String(item.id) : "")
    if (!item) return
    const id = String(item.id)
    setState("picked", (all) => (all.includes(id) ? all.filter((x) => x !== id) : [...all, id]))
  }
  const go = (step: number) => {
    const next = Math.max(0, Math.min(shown().length - 1, state.active + step))
    setState("active", next)
    list?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: "nearest" })
  }

  const stack = layer()

  return (
    <Portal>
      <div class="fixed inset-0" style={{ "z-index": stack.z }} onClick={() => props.onClose()} />
      <div
        class={panel}
        style={{
          ...place(props.at, width, height),
          "max-height": `${height}px`,
          "box-shadow": shadow,
          "z-index": stack.z + 1,
        }}
      >
        <div class="shrink-0 p-2 border-b border-border-weaker-base">
          <div class="h-8 px-2 flex items-center gap-2 rounded-md bg-surface-base">
            <Icon name="magnifying-glass" size="small" class="shrink-0 text-icon-weak" />
            <input
              ref={(el) => queueMicrotask(() => el.focus())}
              class="min-w-0 flex-1 bg-transparent text-13-regular text-text-strong outline-none placeholder:text-text-weak"
              placeholder={language.t("p1.inline.search")}
              value={state.query}
              onInput={(event) => setState({ query: event.currentTarget.value, active: 0 })}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") (event.preventDefault(), go(1))
                if (event.key === "ArrowUp") (event.preventDefault(), go(-1))
                if (event.key === "Escape") (event.preventDefault(), event.stopPropagation(), props.onClose())
                if (event.key === "Enter") {
                  event.preventDefault()
                  if (props.many && !shown().length) return done()
                  pick(shown()[state.active])
                }
              }}
            />
          </div>
        </div>
        <div ref={list} class="flex-1 min-h-0 overflow-y-auto p-1">
          <Show when={!props.many && !state.query && props.clear !== false}>
            <button
              type="button"
              class="w-full h-9 px-2.5 flex items-center gap-2.5 rounded-md text-left text-13-regular text-text-weak hover:bg-surface-raised-base-hover"
              onClick={() => pick()}
            >
              <span class="flex-1">—</span>
            </button>
          </Show>
          <For
            each={shown()}
            fallback={
              <div class="h-9 px-2.5 flex items-center text-13-regular text-text-weak">
                {language.t("p1.inline.none")}
              </div>
            }
          >
            {(item, index) => {
              const on = () => (props.many ? state.picked : props.picked).includes(String(item.id))
              return (
                <button
                  type="button"
                  data-index={index()}
                  class="w-full h-9 px-2.5 flex items-center gap-2.5 rounded-md text-left text-13-regular text-text-strong"
                  classList={{ "bg-surface-raised-base-hover": state.active === index() }}
                  onPointerMove={() => setState("active", index())}
                  onClick={() => pick(item)}
                >
                  <Show when={props.many}>
                    <span
                      class="size-4 shrink-0 rounded flex items-center justify-center border"
                      classList={{
                        "bg-surface-interactive-base border-transparent text-text-on-interactive-base": on(),
                        "border-border-strong-base": !on(),
                      }}
                    >
                      <Show when={on()}>
                        <Icon name="check-small" size="small" />
                      </Show>
                    </span>
                  </Show>
                  <Show when={props.people}>
                    <span class="size-6 shrink-0 rounded-full flex items-center justify-center bg-surface-base text-11-medium text-text-base">
                      {initials(item.name)}
                    </span>
                  </Show>
                  <span class="min-w-0 flex-1 truncate">{item.name}</span>
                  <Show when={!props.many && on()}>
                    <Icon name="check" size="small" class="shrink-0 text-icon-interactive-base" />
                  </Show>
                </button>
              )
            }}
          </For>
        </div>
        <Show when={props.note}>
          <p class="shrink-0 px-3 py-2 border-t border-border-weaker-base text-12-regular text-text-diff-delete-base">
            {props.note}
          </p>
        </Show>
        <Show when={props.many}>
          <div class="shrink-0 px-2 py-2 flex items-center justify-between border-t border-border-weaker-base">
            <button
              type="button"
              class="h-8 px-2.5 rounded-md text-13-regular text-text-weak hover:bg-surface-raised-base-hover"
              onClick={() => props.onClose()}
            >
              {language.t("common.cancel")}
            </button>
            <Button variant="primary" size="small" onClick={done}>
              {language.t("p1.inline.done")}
            </Button>
          </div>
        </Show>
      </div>
    </Portal>
  )
}

/** A month to pick a day from, opening on the field's date or today. */
function Calendar(props: { at: DOMRect; value: string; onPick: (value: string) => void; onClose: () => void }) {
  const language = useLanguage()
  const today = iso(new Date())
  const first = /^\d{4}-\d{2}-\d{2}$/.test(props.value) ? new Date(`${props.value}T00:00:00`) : new Date()
  const [month, setMonth] = createSignal(new Date(first.getFullYear(), first.getMonth(), 1))
  const days = createMemo(() => {
    const start = new Date(month())
    start.setDate(1 - start.getDay())
    return Array.from(
      { length: 42 },
      (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index),
    )
  })
  const fmt = new Intl.DateTimeFormat(language.locale(), { month: "long", year: "numeric" })
  const week = Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(language.locale(), { weekday: "narrow" }).format(new Date(2024, 0, 7 + index)),
  )
  const shift = (step: number) => setMonth((at) => new Date(at.getFullYear(), at.getMonth() + step, 1))

  const stack = layer()

  return (
    <Portal>
      <div class="fixed inset-0" style={{ "z-index": stack.z }} onClick={() => props.onClose()} />
      <div
        class={`${panel} p-3`}
        style={{ ...place(props.at, 288, 340), "box-shadow": shadow, "z-index": stack.z + 1 }}
        onKeyDown={(event) => event.key === "Escape" && props.onClose()}
      >
        <div class="flex items-center gap-1 mb-2">
          <div class="flex-1 pl-1 text-14-medium text-text-strong">{fmt.format(month())}</div>
          <button
            type="button"
            ref={(el) => queueMicrotask(() => el.focus())}
            class="size-8 rounded-md flex items-center justify-center text-icon-base hover:bg-surface-raised-base-hover"
            onClick={() => shift(-1)}
          >
            <Icon name="chevron-left" size="small" />
          </button>
          <button
            type="button"
            class="size-8 rounded-md flex items-center justify-center text-icon-base hover:bg-surface-raised-base-hover"
            onClick={() => shift(1)}
          >
            <Icon name="chevron-right" size="small" />
          </button>
        </div>
        <div class="grid grid-cols-7 gap-0.5 text-center">
          <For each={week}>
            {(day) => <div class="h-7 flex items-center justify-center text-11-medium text-text-weak">{day}</div>}
          </For>
          <For each={days()}>
            {(day) => {
              const key = iso(day)
              return (
                <button
                  type="button"
                  class="h-9 rounded-md text-13-regular"
                  classList={{
                    "bg-surface-interactive-base text-text-on-interactive-base": key === props.value,
                    "text-text-strong hover:bg-surface-raised-base-hover":
                      key !== props.value && day.getMonth() === month().getMonth(),
                    "text-text-weaker hover:bg-surface-raised-base-hover":
                      key !== props.value && day.getMonth() !== month().getMonth(),
                    "shadow-[inset_0_0_0_1px_var(--border-interactive-base)]": key === today && key !== props.value,
                  }}
                  onClick={() => props.onPick(key)}
                >
                  {day.getDate()}
                </button>
              )
            }}
          </For>
        </div>
        <div class="mt-2 pt-2 flex items-center justify-between border-t border-border-weaker-base">
          <button
            type="button"
            class="h-8 px-2.5 rounded-md text-13-regular text-text-weak hover:bg-surface-raised-base-hover"
            onClick={() => props.onPick("")}
          >
            {language.t("p1.inline.clear")}
          </button>
          <button
            type="button"
            class="h-8 px-2.5 rounded-md text-13-medium text-text-interactive-base hover:bg-surface-raised-base-hover"
            onClick={() => props.onPick(today)}
          >
            {language.t("p1.inline.today")}
          </button>
        </div>
      </div>
    </Portal>
  )
}

/** An on/off switch that saves as soon as it flips. */
function Toggle(props: { on: boolean; busy: boolean; onChange: (on: boolean) => void; onClose: () => void }) {
  return (
    <div class="h-8 flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={props.on}
        ref={(el) => queueMicrotask(() => el.focus())}
        disabled={props.busy}
        class="relative h-5 w-9 shrink-0 rounded-full transition-colors outline-none"
        classList={{
          "bg-surface-interactive-base": props.on,
          "bg-surface-base border border-border-strong-base": !props.on,
        }}
        onClick={() => props.onChange(!props.on)}
        onBlur={() => !props.busy && props.onClose()}
        onKeyDown={(event) => event.key === "Escape" && props.onClose()}
      >
        <span
          class="absolute top-0.5 size-4 rounded-full bg-text-strong transition-[left]"
          style={{ left: props.on ? "18px" : "2px" }}
        />
      </button>
      <Show when={props.busy}>
        <Spinner class="size-3.5" />
      </Show>
    </div>
  )
}

function grow(el: HTMLTextAreaElement) {
  el.style.height = "auto"
  el.style.height = `${el.scrollHeight}px`
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
}

function iso(day: Date) {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`
}
