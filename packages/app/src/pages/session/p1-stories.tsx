import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useLanguage } from "@/context/language"
import { brief, guess, type Guess } from "@/p1/estimate"
import { guess as suggest, kinds, types } from "@/p1/kinds"
import { plain, update } from "@/p1/form"
import { load, members, modules, type Choice, type Home, type Module } from "@/p1/points"
import { useP1 } from "@/p1/settings"
import {
  add,
  aim,
  areas,
  change,
  create,
  discard,
  drop,
  edit,
  field,
  least,
  mark,
  relate,
  spend,
  stories,
  type Story,
  type Task,
} from "@/p1/stories"
import { Menu, prime } from "./p1-inline"
import { Choose, Fold, Plus, Refresh, Spark, StoryIcon, TaskIcon } from "./p1-icons"
import { KindTag } from "./p1-kind"
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
  // Asks the AI a question; without it there is no AI estimate.
  ask?: (prompt: string, system: string) => Promise<string>
  x: number
  y: number
  /** A story to edit straight away: only its Edit story form shows, and closing it closes this. */
  story?: number
  /** The same, with the story already in hand (as the weekly board has it), so its form opens at once. */
  tale?: Story
  onClose: (changed: boolean) => void
}) {
  const p1 = useP1()
  const language = useLanguage()
  const [state, setState] = createStore({
    loading: true,
    // The AI's suggested points and story targets, while it is asked and once it answers.
    guessing: false,
    guess: undefined as Guess | undefined,
    err: "",
    list: [] as Story[],
    people: [] as Choice[],
    mods: [] as Choice[],
    // Each module's type by id, to suggest a story's type from its modules.
    types: {} as Record<number, number>,
    // The spec's module rows, where P1 keeps a story's related modules.
    rows: [] as Module[],
    hours: props.hours,
    // Saving rows by key ("s7" a story, "t70" a task, "spec", "form"), and their errors.
    busy: {} as Record<string, boolean>,
    errs: {} as Record<string, string>,
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
    const [list, rows] = await Promise.all([
      stories(host(), token(), props.project, props.spec, locale()).catch((err: unknown) => {
        setState("err", message(err))
      }),
      load(host(), token(), props.project, props.spec, props.home, locale()).catch(() => undefined),
    ])
    setState({ loading: false, ...(list ? { list: mark(list, p1.clocks()), err: "" } : {}), ...(rows ? { rows } : {}) })
    // Opened for one story: its form opens once the stories are read; a story that's gone closes this.
    if (props.story && !props.tale && !opened && list) {
      opened = true
      const story = state.list.find((item) => item.id === props.story)
      if (!story) return props.onClose(false)
      setState("form", { kind: "story", story })
    }
  }
  let opened = false

  // Just one story's form: asked for by id from the list, or handed over by the weekly board.
  const alone = () => !!props.story || !!props.tale
  onMount(() => {
    if (props.tale) {
      opened = true
      setState("form", { kind: "story", story: props.tale })
    }
    void read()
    void members(host(), token(), props.home, locale())
      .then((people) => setState("people", people))
      .catch(() => undefined)
    void modules(host(), token(), props.home, locale())
      .then((mods) => setState("mods", mods))
      .catch(() => undefined)
    void types(host(), token(), props.home, locale())
      .then((map) => setState("types", map))
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

  // Asks the AI, in a hidden session, for the spec's points and each story's target time from what P1 holds.
  // The answer is only shown; Apply saves it.
  const estimate = async () => {
    if (state.guessing) return
    setState({ guessing: true, guess: undefined, errs: { ...state.errs, guess: "" } })
    const found = await prime(host(), token(), props.project, props.spec, p1.user(), locale()).catch(() => undefined)
    const text = plain(found?.values[1102]?.html || found?.values[1102]?.value || "")
    const reply = await (props.ask ?? (async () => ""))(
      brief({ id: props.spec, title: props.title, text, points: state.hours }, state.list),
      "You estimate software work. Reply with one JSON object only, exactly in the shape asked for. No code fences, no commentary, no tools.",
    ).catch((err: unknown) => {
      setState("errs", "guess", message(err))
      return ""
    })
    const next = guess(reply, state.list)
    setState({ guessing: false, guess: next })
    if (!next && !state.errs.guess) setState("errs", "guess", language.t("p1.stories.ai.none"))
  }

  // Saves the suggestion: the spec's points, then each story's target time that differs.
  const apply = async () => {
    const found = state.guess
    if (!found) return
    setState("guess", undefined)
    if (found.points !== state.hours) await hours(String(found.points))
    for (const item of found.stories) {
      const story = state.list.find((one) => one.id === item.id)
      if (!story || story.target === item.hours) continue
      await act(`s${story.id}`, () => edit(host(), token(), story, aim(item.hours), locale()))
    }
  }

  // A story's own time spent or left, refusing less than its tasks' total.
  const grow = (story: Story, key: "spent" | "remain", hours: number) => {
    const floor = least(story, key)
    if (hours < floor) {
      setState("errs", `s${story.id}`, language.t("p1.stories.floor", { hours: floor.toFixed(1) }))
      return
    }
    // A story's own time is kept in SiCode for now, as P1 keeps none on stories.
    p1.clock(story.id, { spent: story.spent, remain: story.remain, [key]: hours })
    setState({ list: mark(state.list, p1.clocks()), changed: true, errs: { ...state.errs, [`s${story.id}`]: "" } })
  }

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

  // A story's related modules, saved as the spec's module rows; picking them makes no tasks.
  const related = (story: Story, ids: number[]) =>
    relate(
      host(),
      token(),
      { project: props.project, spec: props.spec, home: props.home, owner: story.owner, rows: state.rows, ids },
      locale(),
    )

  const save = async (value: Value) => {
    const form = state.form
    if (!form) return
    if (!value.name || !value.owner || !value.modules.length || (form.kind === "story" && !value.type)) {
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
            type: value.type,
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
        ...(value.type !== story.type ? { StoryType: value.type } : {}),
        ...(value.hours !== story.target ? aim(value.hours) : {}),
      }
      if (Object.keys(next).length) await edit(host(), token(), story, next, locale())
      await related(story, value.modules)
    })
    if (ok && alone()) return props.onClose(true)
    if (ok) setState("form", undefined)
  }

  const tool =
    "h-9 px-3 rounded-lg flex items-center gap-1.5 text-13-medium border border-border-weaker-base bg-background-base hover:bg-surface-base-hover disabled:opacity-50"
  const head = "relative px-3 py-2.5 text-12-medium text-text-weak text-left font-medium whitespace-nowrap"
  const cell = "px-3 py-2 align-top"

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

  const editor = () => (
    <Show when={state.form}>
      {(form) => (
        <Form
          kind={form().kind}
          story={form().story}
          task={form().task}
          people={state.people}
          mods={state.mods}
          types={state.types}
          rows={state.rows}
          busy={state.busy.form}
          err={state.errs.form}
          onSave={save}
          onClose={() => (alone() ? props.onClose(state.changed) : setState("form", undefined))}
        />
      )}
    </Show>
  )

  return (
    <Show when={!alone()} fallback={editor()}>
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
            {/* A spec's points are its stories' added up, shown only; a spec without stories keeps its own. */}
            <Show
              when={state.list.length}
              fallback={
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
              }
            >
              <span class="text-14-medium text-text-strong tabular-nums">
                {state.list.reduce((sum, story) => sum + story.target, 0).toFixed(1)}h
              </span>
            </Show>
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
      {/* The dialog's toolbar: add a story, fold or open every story, read again, and ask the AI for an estimate. */}
      <div
        data-component="p1-stories-bar"
        class="shrink-0 h-14 px-5 flex items-center gap-2 border-b border-border-weaker-base bg-[color-mix(in_srgb,var(--text-interactive-base)_7%,var(--background-base))]"
      >
        <Show when={!props.readonly && props.home.dev}>
          <button
            type="button"
            data-action="p1-stories-new"
            class={`${tool} text-text-strong`}
            onClick={() => setState({ form: { kind: "story" }, errs: { ...state.errs, form: "" } })}
          >
            <Plus />
            {language.t("p1.stories.story")}
          </button>
        </Show>
        <Show when={state.list.length}>
          <button
            type="button"
            data-action="p1-stories-fold"
            class={`${tool} text-text-base`}
            onClick={() => {
              const next = state.shut.length ? [] : state.list.map((story) => story.id)
              setState("shut", next)
              shut.set(props.spec, next)
            }}
          >
            <Icon name={state.shut.length ? "expand" : "collapse"} size="small" />
            {language.t(state.shut.length ? "p1.stories.open" : "p1.stories.fold")}
          </button>
        </Show>
        <button
          type="button"
          data-action="p1-stories-refresh"
          class={`${tool} w-9 px-0 justify-center text-icon-base`}
          aria-label={language.t("p1.refresh")}
          title={language.t("p1.refresh")}
          disabled={state.loading}
          onClick={() => void read()}
        >
          <Refresh />
        </button>
        <div class="flex-1" />
        <Show when={!props.readonly && props.ask}>
          <button
            type="button"
            data-action="p1-stories-ai"
            class="h-9 px-3.5 rounded-lg flex items-center gap-2 text-13-medium text-white bg-gradient-to-r from-[#6d5cf6] to-[#3b82f6] shadow-xs hover:brightness-110 disabled:opacity-60"
            disabled={state.guessing || state.loading}
            onClick={() => void estimate()}
          >
            <Show when={state.guessing} fallback={<Spark />}>
              <Spinner class="size-3.5" />
            </Show>
            {language.t(state.guessing ? "p1.stories.ai.busy" : "p1.stories.ai.estimate")}
          </button>
        </Show>
      </div>
      {/* The AI's suggestion, shown until you apply or dismiss it. */}
      <Show when={state.guess}>
        {(found) => (
          <div
            data-component="p1-stories-guess"
            class="shrink-0 px-5 py-3 flex items-start gap-3 border-b border-border-weaker-base bg-[color-mix(in_srgb,#6d5cf6_10%,var(--background-base))]"
          >
            <span class="mt-0.5 text-[#8b7cf8]">
              <Spark />
            </span>
            <div class="min-w-0 flex-1 flex flex-col gap-1.5">
              <div class="text-13-regular text-text-base">
                <span class="text-13-medium text-text-strong">
                  {language.t("p1.stories.ai.points", { hours: found().points.toFixed(1) })}
                </span>
                <Show when={found().why}>
                  <span class="text-text-weak"> · {found().why}</span>
                </Show>
              </div>
              <Show when={found().stories.length}>
                <div class="flex flex-wrap gap-1.5">
                  <For each={found().stories}>
                    {(item) => (
                      <span
                        class="max-w-80 h-6 px-2 rounded-md flex items-center gap-1.5 bg-background-base border border-border-weaker-base text-12-regular"
                        title={item.why}
                      >
                        <span class="min-w-0 truncate text-text-base">
                          <Show when={state.list.find((story) => story.id === item.id)}>
                            {(story) => (
                              <>
                                <KindTag type={story().type} />
                                {story().name}
                              </>
                            )}
                          </Show>
                        </span>
                        <span class="shrink-0 text-text-strong tabular-nums">{item.hours.toFixed(1)}h</span>
                      </span>
                    )}
                  </For>
                </div>
              </Show>
            </div>
            <div class="shrink-0 flex items-center gap-2">
              <Button variant="secondary" size="small" data-action="p1-stories-ai-dismiss" onClick={() => setState("guess", undefined)}>
                {language.t("p1.stories.ai.dismiss")}
              </Button>
              <Button variant="primary" size="small" data-action="p1-stories-ai-apply" onClick={() => void apply()}>
                {language.t("p1.stories.ai.apply")}
              </Button>
            </div>
          </div>
        )}
      </Show>
      <Show when={state.errs.guess}>
        <p class="shrink-0 px-5 pt-2 text-12-regular text-text-diff-delete-base">{state.errs.guess}</p>
      </Show>
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
                  const picked = () => areas(story, state.rows, state.mods)
                  return (
                    <>
                      <tr
                        class="border-b border-border-weaker-base bg-surface-base"
                        classList={{ "opacity-60": state.busy[key] }}
                      >
                        <td class={`${cell} pl-3`}>
                          <div class="flex items-start gap-1.5 min-w-0">
                            <button
                              type="button"
                              class="size-6 shrink-0 rounded-md flex items-center justify-center text-text-strong hover:bg-surface-base-hover"
                              aria-expanded={open()}
                              onClick={() => fold(story)}
                            >
                              <Fold open={open()} />
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
                                  <KindTag type={story.type} />
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
                                  onPick={(ids) =>
                                    act(key, () => related(story, ids.split(",").filter(Boolean).map(Number)))
                                  }
                                >
                                  <span class="group/mods inline-flex flex-wrap items-center gap-1">
                                    <For each={picked()}>{(item) => <Chip name={item.name} />}</For>
                                    <Show when={!props.readonly}>
                                      <span class="size-6 rounded-md flex items-center justify-center text-text-strong group-hover/mods:bg-surface-base-hover">
                                        <Choose />
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
                          {/* A story's time is its tasks': it can be raised, the extra shared over them, but not set
                          below their total. Without tasks it is set on the story itself. */}
                          <div class="h-6 flex items-center justify-end gap-1 tabular-nums">
                            <For each={["spent", "remain"] as const}>
                              {(part, index) => (
                                <>
                                  <Show when={index() > 0}>
                                    <span class="text-text-weaker">/</span>
                                  </Show>
                                  <Edit
                                    value={String(story[part])}
                                    width="w-14"
                                    kind="number"
                                    readonly={props.readonly}
                                    busy={state.busy[key]}
                                    class="tabular-nums"
                                    align
                                    onSave={(next) => grow(story, part, tenth(next))}
                                  >
                                    {story[part].toFixed(1)}h
                                  </Edit>
                                </>
                              )}
                            </For>
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
                                <span class="text-text-strong">
                                  <Plus />
                                </span>
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
            </tbody>
          </table>
        </Show>
      </div>
      {editor()}
    </P1Pop>
    </Show>
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
  const cell = "px-3 py-2 align-top"
  return (
    <>
      <tr
        class="border-b border-border-weaker-base hover:bg-surface-base-hover"
        classList={{ "opacity-60": props.busy }}
      >
        <td class={`${cell} pl-[50px]`}>
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
        <td class={`${cell} text-right text-text-weaker`}>
          <span class="h-6 inline-flex items-center">—</span>
        </td>
        <td class={cell}>
          <div class="h-6 flex items-center justify-end gap-1 tabular-nums">
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
  // Fills its box, as a form field does.
  wide?: boolean
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
          "w-full": !!props.wide,
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
        class="shrink-0 min-w-9 whitespace-nowrap text-13-regular tabular-nums"
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

type Value = { name: string; owner: number; modules: number[]; hours: number; type: number }

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
  // Each module's type by id; a story's type is suggested from its modules' until one is picked.
  types: Record<number, number>
  rows: Module[]
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
        modules: areas(props.story, props.rows, props.mods).map((item) => item.id),
        hours: props.story.target,
      }
    if (props.story)
      return {
        name: "",
        owner: props.story.owner,
        modules: areas(props.story, props.rows, props.mods)
          .slice(0, 1)
          .map((item) => item.id),
        hours: 0,
      }
    return { name: "", owner: Number(p1.user()) || 0, modules: [] as number[], hours: 0 }
  })()
  const [state, setState] = createStore({
    ...start,
    hours: String(start.hours),
    type: props.kind === "story" && !props.task ? (props.story?.type ?? 0) : 0,
    // A type picked by hand, or the story's own, which its modules no longer change.
    fixed: props.kind === "story" && !!props.story?.type,
  })
  createEffect(() => {
    if (props.kind !== "story" || state.fixed) return
    setState("type", suggest(state.modules, props.types))
  })
  // A story's modules are of its type: once it has one, only those are offered, while module types are known.
  const typed = () => props.kind === "story" && !!state.type && Object.keys(props.types).length > 0
  const offered = createMemo(() =>
    typed() ? props.mods.filter((item) => props.types[item.id] === state.type) : props.mods,
  )
  const person = () =>
    props.people.find((item) => item.id === state.owner)?.name || (old && "person" in old ? old.person : "")
  const submit = () =>
    props.onSave({
      name: state.name.trim(),
      owner: state.owner,
      modules: state.modules.filter(Boolean),
      hours: tenth(state.hours),
      type: state.type,
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
              <KindTag type={story().type} />
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
        <Show when={props.kind === "story"}>
          <Field label={language.t("p1.stories.form.type")}>
            <select
              data-action="p1-story-type"
              required
              class="h-9 w-full px-2 rounded-md border border-border-weak-base bg-background-base text-13-regular text-text-strong outline-none focus:border-border-interactive-base"
              classList={{ "text-text-weak": !state.type }}
              value={String(state.type)}
              onChange={(event) => {
                const type = Number(event.currentTarget.value)
                // Modules of another type no longer fit the story.
                setState({
                  type,
                  fixed: true,
                  modules: Object.keys(props.types).length
                    ? state.modules.filter((id) => props.types[id] === type)
                    : state.modules,
                })
              }}
            >
              <option value="0" disabled>
                {language.t("p1.stories.type")}
              </option>
              <For each={kinds}>
                {(item) => <option value={String(item.id)}>{language.t(`p1.kind.${item.key}`)}</option>}
              </For>
            </select>
          </Field>
        </Show>
        <Field label={language.t(props.kind === "story" ? "p1.stories.form.modules" : "p1.stories.form.module")}>
          <div class={box}>
            <Pick
              items={offered()}
              picked={state.modules.map(String)}
              many={props.kind === "story"}
              wide
              readonly={false}
              onPick={(ids) => setState("modules", ids.split(",").filter(Boolean).map(Number))}
            >
              <span class="w-full flex items-center gap-2">
                <span class="flex-1 min-w-0 flex flex-wrap gap-1">
                  <For
                    each={props.mods.filter((item) => state.modules.includes(item.id))}
                    fallback={<span class="text-13-regular text-text-weak">{language.t("p1.stories.modules")}</span>}
                  >
                    {(item) => <Chip name={item.name} />}
                  </For>
                </span>
                <Icon name="chevron-down" size="small" class="shrink-0 text-icon-weak" />
              </span>
            </Pick>
          </div>
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

