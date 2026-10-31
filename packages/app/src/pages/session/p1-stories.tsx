import { For, Show, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useLanguage } from "@/context/language"
import { update } from "@/p1/form"
import { members, modules, type Choice, type Home } from "@/p1/points"
import { useP1 } from "@/p1/settings"
import {
  add,
  aim,
  areas,
  budget,
  change,
  create,
  discard,
  drop,
  edit,
  field,
  spend,
  stories,
  type Story,
  type Task,
} from "@/p1/stories"
import { Menu, prime } from "./p1-inline"
import { StoryIcon, TaskIcon } from "./p1-icons"
import { P1Pop } from "./p1-pop"
import { Tip } from "./p1-tip"

const ring = "shadow-[0_0_0_2px_var(--border-interactive-base)]"
// The table's columns with their least and starting widths, the least still showing all a cell holds; the
// edit and delete column after them stays as wide as its buttons.
const cols = [
  { key: "name", min: 220, base: 440, right: false },
  { key: "owner", min: 110, base: 150, right: false },
  { key: "target", min: 104, base: 120, right: true },
  { key: "time", min: 128, base: 150, right: true },
  { key: "finish", min: 132, base: 150, right: false },
] as const
const edge = 96
// Stories folded shut, by spec, for as long as the app runs.
const shut = new Map<number, number[]>()

/**
 * A spec's stories and the tasks under them. The spec's points are the hours of AI coding it needs;
 * each story has an owner, modules and a target time, and holds tasks people or SiCode's agents add.
 * Everything edits in place and saves at once.
 */
export function P1Stories(props: {
  project: number
  spec: number
  title: string
  hours: number
  home: Home
  readonly: boolean
  x: number
  y: number
  onClose: (changed: boolean) => void
}) {
  const p1 = useP1()
  const language = useLanguage()
  const [state, setState] = createStore({
    loading: true,
    err: "",
    list: [] as Story[],
    people: [] as Choice[],
    mods: [] as Choice[],
    hours: props.hours,
    // Saving rows by key ("s7" a story, "t70" a task, "spec", "form"), and their errors.
    busy: {} as Record<string, boolean>,
    errs: {} as Record<string, string>,
    // Modules just picked on a story, shown while their tasks are being made.
    adding: {} as Record<number, number[]>,
    shut: shut.get(props.spec) ?? ([] as number[]),
    // The story or task open in the form (a story alone to add a task to it), and a delete waiting for its second click.
    form: undefined as { kind: "story" | "task"; story?: Story; task?: Task } | undefined,
    sure: "",
    changed: false,
    // Column widths while being dragged, and the width the table has to fill.
    sizes: {} as Record<string, number | undefined>,
    room: 0,
  })
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err))
  const host = () => p1.server()
  const token = () => p1.token()
  const locale = () => language.locale()

  const read = async () => {
    const list = await stories(host(), token(), props.project, props.spec, locale()).catch((err: unknown) => {
      setState("err", message(err))
    })
    setState({ loading: false, ...(list ? { list, err: "" } : {}) })
  }

  onMount(() => {
    void read()
    void members(host(), token(), props.home, locale())
      .then((people) => setState("people", people))
      .catch(() => undefined)
    void modules(host(), token(), props.home, locale())
      .then((mods) => setState("mods", mods))
      .catch(() => undefined)
  })

  // Runs a change for a row, shows its spinner and any error from P1, then reloads the stories.
  const act = async (key: string, run: () => Promise<unknown>) => {
    setState("busy", key, true)
    setState("errs", key, "")
    const ok = await run()
      .then(() => true)
      .catch((err: unknown) => {
        setState("errs", key, message(err))
        return false
      })
    if (ok) setState("changed", true)
    await read()
    setState("busy", key, false)
    return ok
  }

  const name = (id: number) => state.people.find((item) => item.id === id)?.name ?? ""
  // The spec's time spent and left, and how far it is: each story's % finish weighted by its target time.
  const total = createMemo(() => {
    const target = state.list.reduce((sum, story) => sum + story.target, 0)
    const finish = target
      ? state.list.reduce((sum, story) => sum + story.finish * story.target, 0) / target
      : state.list.reduce((sum, story) => sum + story.finish, 0) / (state.list.length || 1)
    return {
      spent: state.list.reduce((sum, story) => sum + story.spent, 0),
      remain: state.list.reduce((sum, story) => sum + story.remain, 0),
      finish: Math.round(finish),
    }
  })

  // The spec's hours of AI coding live in its Points field, saved like any other field.
  const hours = (next: string) =>
    act("spec", async () => {
      const value = tenth(next)
      const found = await prime(host(), token(), props.project, props.spec, p1.user(), locale(), true)
      await update(
        host(),
        token(),
        {
          project: props.project,
          id: props.spec,
          folder: found.folder,
          update: found.update,
          values: [{ ID: 1131, Value: value }],
        },
        locale(),
      )
      setState("hours", value)
    })

  const fold = (story: Story) => {
    const next = state.shut.includes(story.id) ? state.shut.filter((id) => id !== story.id) : [...state.shut, story.id]
    setState("shut", next)
    shut.set(props.spec, next)
  }

  const remove = (key: string, run: () => Promise<unknown>) => {
    if (state.sure !== key) {
      setState("sure", key)
      setTimeout(() => state.sure === key && setState("sure", ""), 3000)
      return
    }
    setState("sure", "")
    void act(key, run)
  }

  const extra = (story: Story, name: string, owner: number, mods: Choice[]) =>
    mods.reduce(
      (prev, mod) =>
        prev.then(() =>
          add(
            host(),
            token(),
            {
              project: props.project,
              spec: props.spec,
              story,
              name: `${name} – ${mod.name}`,
              owner,
              module: mod.id,
              points: 0,
            },
            locale(),
          ),
        ),
      Promise.resolve(),
    )

  // Modules picked on a story row: a new one gets a task. P1 can't take one away yet, so that only says so.
  const modulate = async (story: Story, ids: string) => {
    const key = `s${story.id}`
    const next = ids.split(",").filter(Boolean).map(Number)
    const have = areas(story, state.mods).map((item) => item.id)
    const added = state.mods.filter((item) => next.includes(item.id) && !have.includes(item.id))
    if (added.length) {
      setState(
        "adding",
        story.id,
        added.map((item) => item.id),
      )
      await act(key, () => extra(story, story.name, story.owner, added))
      setState("adding", story.id, [])
    }
    if (have.some((id) => !next.includes(id))) setState("errs", key, language.t("p1.stories.form.dropped"))
  }

  const save = async (value: Value) => {
    const form = state.form
    if (!form) return
    if (!value.name || !value.owner || !value.modules.length) {
      setState("errs", "form", language.t("p1.stories.needs"))
      return
    }
    const story = form.story
    const task = form.task
    const picked = state.mods.filter((item) => value.modules.includes(item.id))
    const ok = await act("form", async () => {
      if (!story)
        return create(
          host(),
          token(),
          {
            project: props.project,
            spec: props.spec,
            home: props.home,
            name: value.name,
            owner: value.owner,
            target: value.hours,
            modules: picked,
          },
          locale(),
        )
      if (form.kind === "task" && !task)
        return add(
          host(),
          token(),
          {
            project: props.project,
            spec: props.spec,
            story,
            name: value.name,
            owner: value.owner,
            module: value.modules[0],
            points: value.hours,
          },
          locale(),
        )
      if (task) {
        const set = (id: number, next: string | number) =>
          change(host(), token(), story.project, task.id, id, next, locale())
        if (value.name !== task.name) await set(field.name, value.name)
        if (value.owner !== task.owner) await set(field.owner, value.owner)
        if (value.modules[0] !== task.module) await set(field.module, value.modules[0])
        if (value.hours !== task.remain) await set(field.remain, Math.round(value.hours * 60))
        return
      }
      const next = {
        ...(value.name !== story.name ? { StoryTitle: value.name } : {}),
        ...(value.owner !== story.owner ? { CurrentOwnerId: value.owner } : {}),
        ...(value.hours !== story.target ? aim(value.hours) : {}),
      }
      if (Object.keys(next).length) await edit(host(), token(), story, next, locale())
      const have = areas(story, state.mods).map((item) => item.id)
      await extra(
        story,
        value.name,
        value.owner,
        picked.filter((item) => !have.includes(item.id)),
      )
    })
    if (ok) setState("form", undefined)
  }

  const head = "relative px-3 py-2.5 text-12-medium text-text-weak text-left font-medium whitespace-nowrap"
  const cell = "px-3 py-1.5 align-middle"

  // Columns resize by dragging their header's right edge, and keep the width you left them at.
  const size = (col: (typeof cols)[number]) =>
    Math.max(col.min, state.sizes[col.key] ?? p1.width(`stories.${col.key}`) ?? col.base)
  // The widths the columns get in the room there is: the name column takes any extra room; with less, every
  // column gives up its share down to its least, and below that the table scrolls sideways.
  const widths = createMemo(() => {
    const want = cols.map(size)
    const least = cols.reduce((sum, col) => sum + col.min, 0)
    const total = want.reduce((sum, px) => sum + px, 0)
    const room = state.room - edge
    if (room >= total) return want.map((px, i) => (i === 0 ? px + room - total : px))
    if (room <= least) return cols.map((col) => col.min)
    return cols.map((col, i) => Math.floor(col.min + ((want[i] - col.min) * (room - least)) / (total - least)))
  })
  const resize = (event: PointerEvent, col: (typeof cols)[number]) => {
    event.preventDefault()
    event.stopPropagation()
    const start = event.clientX
    const from = size(col)
    const move = (next: PointerEvent) =>
      setState("sizes", col.key, Math.max(col.min, Math.round(from + next.clientX - start)))
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
      const px = state.sizes[col.key]
      if (px !== undefined) p1.size(`stories.${col.key}`, px)
      setState("sizes", col.key, undefined)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
  }
  const reset = (col: (typeof cols)[number]) => {
    setState("sizes", col.key, undefined)
    p1.size(`stories.${col.key}`, undefined)
  }

  return (
    <P1Pop
      name="stories"
      x={props.x}
      y={props.y}
      width={1040}
      min={{ w: 720, h: 320 }}
      onClose={() => props.onClose(state.changed)}
    >
      <div
        data-drag
        class="shrink-0 pl-5 pr-3 pt-3 pb-3 flex items-start gap-4 border-b border-border-weaker-base cursor-move select-none"
      >
        <div class="min-w-0 flex-1 pt-1">
          <div class="text-12-medium text-text-weak">{language.t("p1.stories.title", { id: String(props.spec) })}</div>
          <div class="mt-0.5 text-14-medium text-text-strong line-clamp-2">{props.title}</div>
        </div>
        {/* The spec at a glance: its points (editable), its stories' time spent and left, and how far along it is. */}
        <div
          data-component="p1-summary"
          class="shrink-0 flex items-stretch rounded-xl border border-border-weaker-base bg-surface-base divide-x divide-border-weaker-base"
        >
          <div class="relative group/tip px-4 py-2 flex flex-col gap-0.5">
            <span class="text-11-medium text-text-weak">{language.t("p1.stories.sum.points")}</span>
            <Edit
              value={String(state.hours)}
              kind="number"
              readonly={props.readonly}
              busy={state.busy.spec}
              class="text-14-medium text-text-strong tabular-nums"
              width="w-16"
              onSave={hours}
            >
              {state.hours.toFixed(1)}h
            </Edit>
            <Tip side="left" text={language.t("p1.stories.targethint")} />
          </div>
          <For
            each={[
              { label: "p1.stories.sum.spent", value: total().spent },
              { label: "p1.stories.sum.remain", value: total().remain },
            ]}
          >
            {(cell) => (
              <div class="px-4 py-2 flex flex-col gap-0.5">
                <span class="text-11-medium text-text-weak">{language.t(cell.label)}</span>
                <span class="text-14-medium text-text-strong tabular-nums">{cell.value.toFixed(1)}h</span>
              </div>
            )}
          </For>
          <div class="px-4 py-2 flex flex-col gap-0.5">
            <span class="text-11-medium text-text-weak">{language.t("p1.stories.sum.finish")}</span>
            <span class="flex items-center gap-2">
              <span class="text-14-medium text-text-strong tabular-nums">{total().finish}%</span>
              <span class="h-1.5 w-12 rounded-full bg-background-base overflow-hidden">
                <span
                  class="block h-full min-w-1 rounded-full bg-surface-success-strong"
                  style={{ width: `${Math.max(0, Math.min(100, total().finish))}%` }}
                />
              </span>
            </span>
          </div>
        </div>
        <button
          type="button"
          data-action="p1-stories-close"
          class="size-8 shrink-0 rounded-lg flex items-center justify-center text-icon-base hover:text-icon-strong-base hover:bg-surface-base-hover"
          aria-label={language.t("p1.form.close")}
          onClick={() => props.onClose(state.changed)}
        >
          <Icon name="close" size="small" />
        </button>
      </div>
      <Show when={state.err || state.errs.spec}>
        <p class="shrink-0 px-5 pt-2 text-12-regular text-text-diff-delete-base">{state.err || state.errs.spec}</p>
      </Show>
      <div
        class="flex-1 min-h-0 overflow-auto"
        ref={(el) => {
          const watch = new ResizeObserver(() => setState("room", el.clientWidth))
          watch.observe(el)
          onCleanup(() => watch.disconnect())
        }}
      >
        <Show
          when={!state.loading}
          fallback={
            <div class="h-32 flex items-center justify-center">
              <Spinner class="size-4" />
            </div>
          }
        >
          <table
            class="table-fixed min-w-full text-left border-collapse text-13-regular"
            style={{ width: `${widths().reduce((sum, px) => sum + px, 0) + edge}px` }}
          >
            <colgroup>
              <For each={widths()}>{(px) => <col style={{ width: `${px}px` }} />}</For>
              <col style={{ width: `${edge}px` }} />
            </colgroup>
            <thead class="sticky top-0 z-10 bg-surface-raised-stronger-non-alpha">
              <tr class="group/head border-b border-border-weaker-base">
                <For each={cols}>
                  {(col) => (
                    <th
                      class={head}
                      classList={{
                        "pl-5": col.key === "name",
                        "text-right": col.right,
                        "group/tip": col.key === "target" || col.key === "time",
                      }}
                    >
                      <span class="block truncate">{language.t(`p1.stories.col.${col.key}`)}</span>
                      <Show when={col.key === "target" || col.key === "time"}>
                        <Tip
                          text={language.t(col.key === "target" ? "p1.stories.targethint" : "p1.stories.col.timehint")}
                        />
                      </Show>
                      <div
                        class="group/edge absolute top-0 -right-1.5 z-10 h-full w-3 cursor-col-resize flex justify-center"
                        title={language.t("p1.stories.resize")}
                        onPointerDown={(event) => resize(event, col)}
                        onDblClick={() => reset(col)}
                      >
                        <div class="my-2 w-px bg-transparent group-hover/head:bg-border-strong-base group-hover/edge:w-0.5 group-hover/edge:bg-text-strong group-active/edge:w-0.5 group-active/edge:bg-text-strong" />
                      </div>
                    </th>
                  )}
                </For>
                <th class={`${head} pr-4 text-right`}>
                  <span class="inline-flex align-middle text-icon-weak" title={language.t("p1.stories.actions")}>
                    <Icon name="settings-gear" size="small" />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              <Show when={!state.list.length}>
                <tr>
                  <td colSpan={6} class="px-5 py-6 text-13-regular text-text-weak">
                    {props.home.dev ? language.t("p1.stories.none") : language.t("p1.stories.nodev")}
                  </td>
                </tr>
              </Show>
              <For each={state.list}>
                {(story) => {
                  const key = `s${story.id}`
                  const open = () => !state.shut.includes(story.id)
                  const only = () => (story.tasks.length === 1 ? story.tasks[0] : undefined)
                  const picked = () => {
                    const have = areas(story, state.mods)
                    const ids = have.map((item) => item.id)
                    return [
                      ...have,
                      ...state.mods.filter(
                        (item) => state.adding[story.id]?.includes(item.id) && !ids.includes(item.id),
                      ),
                    ]
                  }
                  return (
                    <>
                      <tr
                        class="border-b border-border-weaker-base bg-surface-base"
                        classList={{ "opacity-60": state.busy[key] }}
                      >
                        <td class={`${cell} pl-3 py-2`}>
                          <div class="flex items-start gap-1.5 min-w-0">
                            <button
                              type="button"
                              class="mt-0.5 size-6 shrink-0 rounded-md flex items-center justify-center text-icon-strong-base hover:bg-surface-base-hover"
                              aria-expanded={open()}
                              onClick={() => fold(story)}
                            >
                              <Icon name={open() ? "chevron-down" : "chevron-right"} size="small" />
                            </button>
                            <div class="min-w-0 flex-1 flex flex-col gap-1.5">
                              <div class="flex items-start gap-2 min-w-0">
                                <span class="mt-1">
                                  <StoryIcon />
                                </span>
                                <Edit
                                  value={story.name}
                                  readonly={props.readonly}
                                  busy={state.busy[key]}
                                  wrap
                                  class="text-13-medium text-text-strong"
                                  onSave={(next) =>
                                    act(key, () => edit(host(), token(), story, { StoryTitle: next }, locale()))
                                  }
                                >
                                  {story.name}
                                </Edit>
                                <Show when={state.busy[key]}>
                                  <Spinner class="size-3.5 shrink-0" />
                                </Show>
                              </div>
                              {/* The story's related modules, lined up under its name; the selector picks more. */}
                              <div class="pl-6 flex items-start gap-2 min-w-0">
                                <span class="h-6 shrink-0 flex items-center text-12-regular text-text-weak">
                                  {language.t("p1.stories.form.modules")}
                                </span>
                                <Pick
                                  items={state.mods}
                                  picked={picked().map((item) => String(item.id))}
                                  many
                                  bare
                                  readonly={props.readonly}
                                  onPick={(ids) => modulate(story, ids)}
                                >
                                  <span class="group/mods inline-flex flex-wrap items-center gap-1">
                                    <For each={picked()}>{(item) => <Chip name={item.name} />}</For>
                                    <Show when={!props.readonly}>
                                      <span class="size-6 rounded-md flex items-center justify-center text-icon-base group-hover/mods:bg-surface-base-hover group-hover/mods:text-icon-strong-base">
                                        <Icon name="selector" size="small" />
                                      </span>
                                    </Show>
                                  </span>
                                </Pick>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td class={cell}>
                          <Pick
                            items={state.people}
                            picked={[String(story.owner)]}
                            people
                            readonly={props.readonly}
                            onPick={(id) =>
                              act(key, () => edit(host(), token(), story, { CurrentOwnerId: Number(id) }, locale()))
                            }
                          >
                            <Person name={story.person || name(story.owner)} />
                          </Pick>
                        </td>
                        <td class={`${cell} text-right`}>
                          <Edit
                            value={String(story.target)}
                            kind="number"
                            readonly={props.readonly}
                            busy={state.busy[key]}
                            class="tabular-nums"
                            align
                            onSave={(next) => act(key, () => edit(host(), token(), story, aim(tenth(next)), locale()))}
                          >
                            {story.target.toFixed(1)}h
                          </Edit>
                        </td>
                        <td class={cell}>
                          <div class="flex items-center justify-end gap-1 tabular-nums">
                            <span class="text-text-strong" title={language.t("p1.stories.rollup")}>
                              {story.spent.toFixed(1)}h
                            </span>
                            <span class="text-text-weaker">/</span>
                            {/* With no tasks a story's time left is its target time; with tasks it is spread over them. */}
                            <Edit
                              value={String(story.remain)}
                              width="w-14"
                              kind="number"
                              readonly={props.readonly || !story.tasks.length}
                              busy={state.busy[key]}
                              class="tabular-nums"
                              align
                              onSave={(next) => act(key, () => budget(host(), token(), story, tenth(next), locale()))}
                            >
                              {story.remain.toFixed(1)}h
                            </Edit>
                          </div>
                        </td>
                        <td class={cell} title={only() ? undefined : language.t("p1.stories.rollup")}>
                          <Edit
                            value={String(story.finish)}
                            kind="number"
                            readonly={props.readonly || !only()}
                            busy={state.busy[key]}
                            onSave={(next) => {
                              const task = only()
                              if (!task) return
                              return act(key, () =>
                                change(host(), token(), story.project, task.id, field.finish, percent(next), locale()),
                              )
                            }}
                          >
                            <Bar value={story.finish} story />
                          </Edit>
                        </td>
                        <td class={`${cell} pr-4`}>
                          <Show when={!props.readonly}>
                            <Actions
                              sure={state.sure === key}
                              onEdit={() =>
                                setState({ form: { kind: "story", story }, errs: { ...state.errs, form: "" } })
                              }
                              onRemove={() => remove(key, () => discard(host(), token(), story, locale()))}
                            />
                          </Show>
                        </td>
                      </tr>
                      <Show when={state.errs[key]}>
                        <Problem text={state.errs[key]} />
                      </Show>
                      <Show when={open()}>
                        <For each={story.tasks}>
                          {(task) => (
                            <Row
                              task={task}
                              story={story}
                              people={state.people}
                              mods={state.mods}
                              readonly={props.readonly}
                              busy={state.busy[`t${task.id}`]}
                              err={state.errs[`t${task.id}`]}
                              sure={state.sure === `t${task.id}`}
                              name={name}
                              act={(run) => act(`t${task.id}`, run)}
                              onEdit={() =>
                                setState({ form: { kind: "task", story, task }, errs: { ...state.errs, form: "" } })
                              }
                              onRemove={() =>
                                remove(`t${task.id}`, () => drop(host(), token(), story.project, task.id, locale()))
                              }
                            />
                          )}
                        </For>
                        <Show when={!props.readonly}>
                          <tr class="border-b border-border-weaker-base">
                            <td colSpan={6} class="py-1.5 pl-[66px] pr-3">
                              <button
                                type="button"
                                class="h-7 px-2 -ml-2 rounded-md flex items-center gap-2 text-12-regular text-text-base hover:bg-surface-base-hover hover:text-text-strong"
                                onClick={() =>
                                  setState({ form: { kind: "task", story }, errs: { ...state.errs, form: "" } })
                                }
                              >
                                <Icon name="plus-small" size="small" />
                                {language.t("p1.stories.task")}
                              </button>
                            </td>
                          </tr>
                        </Show>
                      </Show>
                    </>
                  )
                }}
              </For>
              <Show when={!props.readonly && props.home.dev}>
                <tr>
                  <td colSpan={6} class="px-3 py-2.5">
                    <button
                      type="button"
                      class="h-8 px-2.5 rounded-md flex items-center gap-1.5 text-13-medium text-text-interactive-base hover:bg-surface-base-hover"
                      onClick={() => setState({ form: { kind: "story" }, errs: { ...state.errs, form: "" } })}
                    >
                      <Icon name="plus-small" size="small" />
                      {language.t("p1.stories.story")}
                    </button>
                  </td>
                </tr>
              </Show>
            </tbody>
          </table>
        </Show>
      </div>
      <Show when={state.form}>
        {(form) => (
          <Form
            kind={form().kind}
            story={form().story}
            task={form().task}
            people={state.people}
            mods={state.mods}
            busy={state.busy.form}
            err={state.errs.form}
            onSave={save}
            onClose={() => setState("form", undefined)}
          />
        )}
      </Show>
    </P1Pop>
  )
}

/** One task, indented under its story with a connector line. */
function Row(props: {
  task: Task
  story: Story
  people: Choice[]
  mods: Choice[]
  readonly: boolean
  busy?: boolean
  err?: string
  sure: boolean
  name: (id: number) => string
  act: (run: () => Promise<unknown>) => Promise<boolean>
  onEdit: () => void
  onRemove: () => void
}) {
  const p1 = useP1()
  const language = useLanguage()
  const set = (id: number, value: string | number) => () =>
    change(p1.server(), p1.token(), props.story.project, props.task.id, id, value, language.locale())
  const cell = "px-3 py-1.5 align-middle"
  return (
    <>
      <tr
        class="border-b border-border-weaker-base hover:bg-surface-base-hover"
        classList={{ "opacity-60": props.busy }}
      >
        <td class={`${cell} pl-[50px] py-2`}>
          <div class="relative flex items-start gap-2 min-w-0 pl-4">
            <span
              class="absolute left-0 -top-4 h-7 w-3 border-l border-b border-border-weak-base rounded-bl-md"
              aria-hidden="true"
            />
            <span class="mt-1">
              <TaskIcon />
            </span>
            <Edit
              value={props.task.name}
              readonly={props.readonly}
              busy={props.busy}
              wrap
              class="text-13-regular text-text-strong"
              onSave={(next) => props.act(set(field.name, next))}
            >
              {props.task.name}
            </Edit>
            <Show when={props.busy}>
              <Spinner class="size-3.5 shrink-0" />
            </Show>
          </div>
          <div class="mt-1.5 pl-10">
            <Pick
              items={props.mods}
              picked={[String(props.task.module)]}
              readonly={props.readonly}
              onPick={(id) => props.act(set(field.module, Number(id)))}
            >
              <Show
                when={props.task.area}
                fallback={<span class="text-12-regular text-text-weak">{language.t("p1.stories.module")}</span>}
              >
                <Chip name={props.task.area} />
              </Show>
            </Pick>
          </div>
        </td>
        <td class={cell}>
          <Pick
            items={props.people}
            picked={[String(props.task.owner)]}
            people
            readonly={props.readonly}
            onPick={(id) => props.act(set(field.owner, Number(id)))}
          >
            <Person name={props.task.person || props.name(props.task.owner)} />
          </Pick>
        </td>
        <td class={`${cell} text-right text-text-weaker`}>—</td>
        <td class={cell}>
          <div class="flex items-center justify-end gap-1 tabular-nums">
            <Edit
              value={String(props.task.spent)}
              kind="number"
              readonly={props.readonly}
              busy={props.busy}
              class="tabular-nums"
              align
              onSave={(next) =>
                props.act(() =>
                  spend(
                    p1.server(),
                    p1.token(),
                    {
                      project: props.story.project,
                      task: props.task.id,
                      user: p1.user(),
                      from: props.task.spent,
                      to: parseFloat(next) || 0,
                    },
                    language.locale(),
                  ),
                )
              }
            >
              {props.task.spent.toFixed(1)}h
            </Edit>
            <span class="text-text-weaker">/</span>
            <Edit
              value={String(props.task.remain)}
              width="w-14"
              kind="number"
              readonly={props.readonly}
              busy={props.busy}
              class="tabular-nums"
              align
              onSave={(next) => props.act(set(field.remain, Math.round(tenth(next) * 60)))}
            >
              {props.task.remain.toFixed(1)}h
            </Edit>
          </div>
        </td>
        <td class={cell}>
          <Edit
            value={String(props.task.finish)}
            kind="number"
            readonly={props.readonly}
            busy={props.busy}
            onSave={(next) => props.act(set(field.finish, percent(next)))}
          >
            <Bar value={props.task.finish} />
          </Edit>
        </td>
        <td class={`${cell} pr-4`}>
          <Show when={!props.readonly}>
            <Actions sure={props.sure} onEdit={props.onEdit} onRemove={props.onRemove} />
          </Show>
        </td>
      </tr>
      <Show when={props.err}>
        <Problem text={props.err ?? ""} />
      </Show>
    </>
  )
}

/** A value that turns into a box to type in when clicked; Enter or leaving saves, Escape cancels. */
function Edit(props: {
  value: string
  kind?: "text" | "number"
  readonly?: boolean
  busy?: boolean
  class?: string
  width?: string
  align?: boolean
  wrap?: boolean
  onSave: (next: string) => unknown
  children: JSX.Element
}) {
  const [on, setOn] = createSignal(false)
  const done = (next: string) => {
    setOn(false)
    if (next.trim() === props.value.trim()) return
    void props.onSave(next.trim())
  }
  return (
    <Show
      when={on()}
      fallback={
        <button
          type="button"
          disabled={props.readonly || props.busy}
          class={`min-w-0 max-w-full px-1.5 -mx-1.5 py-0.5 rounded-md text-left disabled:cursor-default ${props.class ?? ""}`}
          classList={{
            "hover:bg-surface-base-hover cursor-text": !props.readonly,
            "text-right": props.align,
            truncate: !props.wrap && props.kind !== "number",
            "line-clamp-2 break-words": props.wrap,
          }}
          onClick={() => setOn(true)}
        >
          {props.children}
        </button>
      }
    >
      <input
        ref={(el) =>
          queueMicrotask(() => {
            el.focus()
            el.select()
          })
        }
        type="text"
        inputMode={props.kind === "number" ? "decimal" : undefined}
        class={`h-7 px-1.5 -mx-1.5 rounded-md bg-background-base outline-none ${ring} ${props.class ?? ""} ${props.width ?? (props.kind === "number" ? "w-20" : "w-full")}`}
        classList={{ "text-right": props.align || props.kind === "number" }}
        value={props.value}
        onInput={(event) => props.kind === "number" && (event.currentTarget.value = decimal(event.currentTarget.value))}
        onKeyDown={(event) => {
          if (event.key === "Enter") done(event.currentTarget.value)
          if (event.key === "Escape") setOn(false)
        }}
        onBlur={(event) => on() && done(event.currentTarget.value)}
      />
    </Show>
  )
}

/** A cell that opens the searchable list under it: people or modules. */
function Pick(props: {
  items: Choice[]
  picked: string[]
  people?: boolean
  many?: boolean
  bare?: boolean
  readonly: boolean
  onPick: (choice: string) => unknown
  children: JSX.Element
}) {
  const [at, setAt] = createSignal<DOMRect>()
  return (
    <>
      <button
        type="button"
        disabled={props.readonly}
        class="max-w-full rounded-md text-left disabled:cursor-default"
        classList={{
          "px-1.5 -mx-1.5 py-0.5 hover:bg-surface-base-hover": !props.bare && !props.readonly,
          [ring]: !!at() && !props.bare,
        }}
        onClick={(event) => setAt(event.currentTarget.getBoundingClientRect())}
      >
        {props.children}
      </button>
      <Show when={at()}>
        {(rect) => (
          <Menu
            at={rect()}
            items={props.items}
            picked={props.picked}
            many={!!props.many}
            people={!!props.people}
            clear={false}
            onPick={(choice) => {
              setAt(undefined)
              if (!props.many && props.picked.includes(choice)) return
              void props.onPick(choice)
            }}
            onClose={() => setAt(undefined)}
          />
        )}
      </Show>
    </>
  )
}

function Person(props: { name: string }) {
  return <span class="block truncate text-text-strong">{props.name}</span>
}

function Chip(props: { name: string }) {
  return (
    <span class="h-6 px-2 inline-flex items-center rounded-full border border-border-weaker-base bg-background-base text-12-regular text-text-base whitespace-nowrap">
      {props.name}
    </span>
  )
}

/** A % finish bar: blue for a story, rolled up from its tasks, green for a task, matching their icons. */
function Bar(props: { value: number; story?: boolean }) {
  const pct = () => Math.max(0, Math.min(100, props.value))
  return (
    <span class="inline-flex items-center gap-2 whitespace-nowrap">
      <span class="h-1.5 w-14 shrink-0 rounded-full bg-background-base overflow-hidden">
        <span
          class="block h-full rounded-full"
          classList={{ "bg-surface-info-strong": props.story, "bg-surface-success-strong": !props.story }}
          style={{ width: `${pct()}%` }}
        />
      </span>
      <span
        class="shrink-0 min-w-9 whitespace-nowrap text-12-regular tabular-nums"
        classList={{ "text-text-strong": props.story, "text-text-weak": !props.story }}
      >
        {pct()}%
      </span>
    </span>
  )
}

/** A row's Edit and Delete buttons; Delete asks once more before it goes. */
function Actions(props: { sure: boolean; onEdit: () => void; onRemove: () => void }) {
  const language = useLanguage()
  return (
    <div class="flex items-center justify-end gap-0.5">
      <button
        type="button"
        aria-label={language.t("p1.stories.edit")}
        title={language.t("p1.stories.edit")}
        class="size-7 rounded-md inline-flex items-center justify-center text-icon-weak hover:bg-surface-base-hover hover:text-icon-base"
        onClick={props.onEdit}
      >
        <Icon name="pencil-line" size="small" />
      </button>
      <Trash
        sure={props.sure}
        label={language.t(props.sure ? "p1.stories.sure" : "p1.stories.delete")}
        onClick={props.onRemove}
      />
    </div>
  )
}

function Trash(props: { sure: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      class="h-7 rounded-md inline-flex items-center justify-center gap-1 text-12-medium"
      classList={{
        "w-7 text-icon-weak hover:bg-surface-base-hover hover:text-icon-base": !props.sure,
        "px-2 bg-surface-critical-weak text-text-diff-delete-base": props.sure,
      }}
      onClick={props.onClick}
    >
      <Icon name="trash" size="small" />
      <Show when={props.sure}>{props.label}</Show>
    </button>
  )
}

function Problem(props: { text: string }) {
  return (
    <tr>
      <td colSpan={6} class="px-5 pb-2 pl-12 text-12-regular text-text-diff-delete-base">
        {props.text}
      </td>
    </tr>
  )
}

type Value = { name: string; owner: number; modules: number[]; hours: number }

/**
 * The popup for a new or changed story or task. People and SiCode's agents fill the same fields,
 * so a story or task can be written, then reworked, in one place.
 */
function Form(props: {
  kind: "story" | "task"
  story?: Story
  task?: Task
  people: Choice[]
  mods: Choice[]
  busy?: boolean
  err?: string
  onSave: (value: Value) => void
  onClose: () => void
}) {
  const p1 = useP1()
  const language = useLanguage()
  const old = props.kind === "task" ? props.task : props.story
  const start = (() => {
    if (props.task)
      return { name: props.task.name, owner: props.task.owner, modules: [props.task.module], hours: props.task.remain }
    if (props.story && props.kind === "story")
      return {
        name: props.story.name,
        owner: props.story.owner,
        modules: areas(props.story, props.mods).map((item) => item.id),
        hours: props.story.target,
      }
    if (props.story)
      return {
        name: "",
        owner: props.story.owner,
        modules: areas(props.story, props.mods)
          .slice(0, 1)
          .map((item) => item.id),
        hours: 0,
      }
    return { name: "", owner: Number(p1.user()) || 0, modules: [] as number[], hours: 0 }
  })()
  const [state, setState] = createStore({ ...start, hours: String(start.hours) })
  const dropped = () => props.kind === "story" && start.modules.some((id) => !state.modules.includes(id))
  const person = () =>
    props.people.find((item) => item.id === state.owner)?.name || (old && "person" in old ? old.person : "")
  const submit = () =>
    props.onSave({
      name: state.name.trim(),
      owner: state.owner,
      modules: state.modules.filter(Boolean),
      hours: tenth(state.hours),
    })
  const grow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }
  const box = "min-h-9 px-2.5 py-1 flex items-center rounded-md border border-border-weak-base bg-background-base"
  const title = old
    ? props.kind === "story"
      ? "p1.stories.form.editstory"
      : "p1.stories.form.edittask"
    : props.kind === "story"
      ? "p1.stories.form.newstory"
      : "p1.stories.form.newtask"
  return (
    <P1Pop
      name="stories-form"
      x={window.innerWidth / 2}
      y={Math.max(48, window.innerHeight / 2 - 240)}
      width={560}
      min={{ w: 420, h: 300 }}
      onClose={props.onClose}
    >
      <div data-drag class="shrink-0 px-5 pt-4 pb-3 border-b border-border-weaker-base cursor-move select-none">
        <div class="text-14-medium text-text-strong">{language.t(title)}</div>
        <Show when={props.kind === "task" && props.story}>
          {(story) => (
            <div class="mt-0.5 text-12-regular text-text-weak truncate">
              {language.t("p1.stories.form.in", { name: story().name })}
            </div>
          )}
        </Show>
      </div>
      <div class="flex-1 min-h-0 overflow-auto px-5 py-4 flex flex-col gap-4">
        <Field label={language.t("p1.stories.form.name")}>
          <textarea
            ref={(el) =>
              queueMicrotask(() => {
                grow(el)
                el.focus()
              })
            }
            rows={1}
            class="w-full px-2.5 py-2 rounded-md border border-border-weak-base bg-background-base text-14-medium text-text-strong outline-none resize-none focus:border-border-interactive-base"
            placeholder={language.t(props.kind === "story" ? "p1.stories.name" : "p1.stories.taskname")}
            value={state.name}
            onInput={(event) => {
              setState("name", event.currentTarget.value.replace(/\n/g, " "))
              grow(event.currentTarget)
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return
              event.preventDefault()
              submit()
            }}
          />
        </Field>
        <div class="grid grid-cols-2 gap-4">
          <Field label={language.t("p1.stories.form.owner")}>
            <div class={box}>
              <Pick
                items={props.people}
                picked={[String(state.owner)]}
                people
                readonly={false}
                onPick={(id) => setState("owner", Number(id))}
              >
                <Show
                  when={state.owner}
                  fallback={<span class="text-13-regular text-text-weak">{language.t("p1.stories.owner")}</span>}
                >
                  <Person name={person()} />
                </Show>
              </Pick>
            </div>
          </Field>
          <Field label={language.t(props.kind === "story" ? "p1.stories.form.target" : "p1.stories.form.hours")}>
            <input
              type="text"
              inputMode="decimal"
              class="h-9 w-full px-2.5 rounded-md border border-border-weak-base bg-background-base text-13-regular text-text-strong outline-none tabular-nums focus:border-border-interactive-base disabled:opacity-60"
              value={state.hours}
              onInput={(event) => setState("hours", (event.currentTarget.value = decimal(event.currentTarget.value)))}
              onKeyDown={(event) => event.key === "Enter" && submit()}
            />
          </Field>
        </div>
        <Field label={language.t(props.kind === "story" ? "p1.stories.form.modules" : "p1.stories.form.module")}>
          <div class={box}>
            <Pick
              items={props.mods}
              picked={state.modules.map(String)}
              many={props.kind === "story"}
              readonly={false}
              onPick={(ids) => setState("modules", ids.split(",").filter(Boolean).map(Number))}
            >
              <span class="flex flex-wrap gap-1">
                <For
                  each={props.mods.filter((item) => state.modules.includes(item.id))}
                  fallback={<span class="text-13-regular text-text-weak">{language.t("p1.stories.modules")}</span>}
                >
                  {(item) => <Chip name={item.name} />}
                </For>
              </span>
            </Pick>
          </div>
          <Show when={dropped()}>
            <p class="mt-1.5 text-12-regular text-text-weak">{language.t("p1.stories.form.dropped")}</p>
          </Show>
        </Field>
      </div>
      <div class="shrink-0 px-5 py-3 flex items-center gap-3 border-t border-border-weaker-base">
        <span class="flex-1 min-w-0 text-12-regular text-text-diff-delete-base">{props.err}</span>
        <Show when={props.busy}>
          <Spinner class="size-4" />
        </Show>
        <Button variant="ghost" size="large" onClick={props.onClose}>
          {language.t("p1.form.cancel")}
        </Button>
        <Button variant="primary" size="large" disabled={props.busy} onClick={submit}>
          {language.t(old ? "p1.stories.form.save" : "p1.stories.create")}
        </Button>
      </div>
    </P1Pop>
  )
}

function Field(props: { label: string; children: JSX.Element }) {
  return (
    <label class="flex flex-col gap-1.5 min-w-0">
      <span class="text-12-medium text-text-weak">{props.label}</span>
      {props.children}
    </label>
  )
}

/** What was typed, kept to digits and one decimal point. */
function decimal(value: string) {
  const [whole, ...rest] = value.replace(/[^0-9.]/g, "").split(".")
  return rest.length ? `${whole}.${rest.join("")}` : whole
}

/** Hours to one decimal. */
function tenth(value: string) {
  return Math.max(0, Math.round((parseFloat(value) || 0) * 10) / 10)
}

function percent(value: string) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)))
}
