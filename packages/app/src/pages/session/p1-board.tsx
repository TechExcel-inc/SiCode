import { For, Show, createMemo, onCleanup, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore } from "solid-js/store"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useLanguage } from "@/context/language"
import type { Row } from "@/p1/api"
import type { Story, Task } from "@/p1/stories"
import type { Choice } from "@/p1/points"
import { card, fit, mine, range, rank, width } from "@/p1/board"
import { StoryIcon, TaskIcon, Unlinked, Untested } from "./p1-icons"
import { Tip } from "./p1-tip"
import { Menu, P1Inline } from "./p1-inline"
import { KindTag } from "./p1-kind"

/**
 * One board column: its key, heading and cards, P1's group name when the board is grouped, and the person it
 * stands for when it is grouped by spec and story owner.
 */
export type Lane = { key: string; title: string; name?: string; who?: number; rows: Row[] }

/** A requirement's priority #, 0 when it has none. */
export const prio = (row: Row) => parseFloat(row.cells[1132] ?? "") || 0

/**
 * The requirement board: a column for each group, long columns spread to several cards across while there's
 * room, and cards whose priority #, title and owner edit in place. Grouped by priority #, cards drag
 * within and across columns, and a dropped card takes a priority # between its new neighbours in that group.
 */
export function P1Board(props: {
  lanes: Lane[]
  project: number
  folder: number
  sortable: boolean
  readonly: boolean
  opening: number
  saving: Record<number, boolean>
  onOpen: (id: number) => void
  /** Opens a spec on All Links, from a link check's flag. */
  onLinks?: (id: number) => void
  onMenu: (id: number, x: number, y: number) => void
  onEdited: (row: Row, col: number, text: string) => void
  onPoints: (id: number, x: number, y: number) => void
  // Each requirement's stories, shown under its card when the board is grouped by spec and story owner.
  tales?: Record<number, Story[]>
  // The people a story's owner is picked from, and a story's new owner.
  crew: Choice[]
  onOwner: (spec: number, story: Story, owner: number) => void
  // Whether each story shows its tasks, and a task's new owner.
  tasks: boolean
  // The requirements flagged as having no linked requirements, or no linked test cases.
  warn?: { links: number[]; tests: number[] }
  onTask: (spec: number, story: Story, task: Task, owner: number) => void
  onMove: (id: number, lane: string, at: number, value: number) => void
}) {
  const language = useLanguage()
  const [state, setState] = createStore({
    room: 0,
    typing: undefined as { id: number; col: number } | undefined,
    // The card being dragged: where the pointer holds it, its size, and the column and slot it would land in.
    // The story whose owner is being picked, under its owner's name.
    pick: undefined as { spec: number; story: Story; task?: Task; at: DOMRect } | undefined,
    drag: undefined as
      | { id: number; x: number; y: number; dx: number; dy: number; w: number; h: number; lane?: string; at: number }
      | undefined,
  })
  const layout = createMemo(() =>
    fit(
      props.lanes.map((lane) => lane.rows.length),
      state.room,
    ),
  )
  const watch = (el: HTMLElement) => {
    const observer = new ResizeObserver(() => setState("room", el.clientWidth - 32))
    observer.observe(el)
    onCleanup(() => observer.disconnect())
  }
  // A card's stories: the ones its column's person owns, or all of them when that person owns only the spec.
  const told = (id: number, who?: number) => {
    const list = props.tales?.[id]
    if (!list) return
    return mine(list, who)
  }
  const held = () => props.lanes.flatMap((lane) => lane.rows).find((row) => row.id === state.drag?.id)

  // Where the pointer would drop a card in a column: after every card above it, or left of it in its row.
  const slot = (lane: HTMLElement, x: number, y: number) =>
    [...lane.querySelectorAll<HTMLElement>("[data-card]")].filter((el) => {
      const rect = el.getBoundingClientRect()
      if (rect.bottom < y) return true
      if (rect.top > y) return false
      return lane.dataset.across === "1" ? rect.top + rect.height / 2 < y : rect.left + rect.width / 2 < x
    }).length

  // A drag starts once the pointer moves a few px, so a plain click still edits or opens. The card leaves the
  // page as it lifts, so the click that ends a drag lands on no card.
  const grab = (event: PointerEvent, row: Row, lane: string, index: number) => {
    if (!props.sortable || props.readonly || event.button !== 0 || state.typing) return
    if ((event.target as HTMLElement).closest("input, textarea, [data-component='p1-inline']")) return
    const el = event.currentTarget as HTMLElement
    const start = { x: event.clientX, y: event.clientY }
    let moved = false
    let frame = 0
    // Near a column's top or bottom edge, or the board's sides, the view scrolls toward the pointer.
    const roll = () => {
      const drag = state.drag
      if (!drag) return
      const box = document.querySelector<HTMLElement>(`[data-lane="${CSS.escape(drag.lane ?? "")}"] [data-cards]`)
      const rect = box?.getBoundingClientRect()
      if (box && rect && drag.y < rect.top + 48) box.scrollTop -= 10
      if (box && rect && drag.y > rect.bottom - 48) box.scrollTop += 10
      const view = el.closest<HTMLElement>("[data-scroll]")
      const edge = view?.getBoundingClientRect()
      if (view && edge && drag.x < edge.left + 48) view.scrollLeft -= 14
      if (view && edge && drag.x > edge.right - 48) view.scrollLeft += 14
      frame = requestAnimationFrame(roll)
    }
    const move = (next: PointerEvent) => {
      if (!moved && Math.hypot(next.clientX - start.x, next.clientY - start.y) < 5) return
      if (!moved) {
        moved = true
        const rect = el.getBoundingClientRect()
        setState("drag", {
          id: row.id,
          x: next.clientX,
          y: next.clientY,
          dx: start.x - rect.left,
          dy: start.y - rect.top,
          w: rect.width,
          h: rect.height,
          lane,
          at: index,
        })
        document.body.style.cursor = "grabbing"
        frame = requestAnimationFrame(roll)
      }
      const over = document.elementFromPoint(next.clientX, next.clientY)?.closest<HTMLElement>("[data-lane]")
      setState("drag", {
        x: next.clientX,
        y: next.clientY,
        lane: over?.dataset.lane,
        at: over ? slot(over, next.clientX, next.clientY) : 0,
      })
    }
    const stop = (drop: boolean) => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("keydown", key)
      cancelAnimationFrame(frame)
      document.body.style.cursor = ""
      const drag = state.drag
      setState("drag", undefined)
      if (!drop || !drag?.lane) return
      const target = props.lanes.find((item) => item.key === drag.lane)
      if (!target) return
      const rest = target.rows.filter((item) => item.id !== drag.id)
      if (drag.lane === lane && drag.at === index) return
      const value = rank(
        rest[drag.at - 1] && prio(rest[drag.at - 1]),
        rest[drag.at] && prio(rest[drag.at]),
        range(target.name ?? ""),
        prio(row),
      )
      props.onMove(drag.id, drag.lane, drag.at, value)
    }
    const up = () => stop(true)
    const key = (next: KeyboardEvent) => next.key === "Escape" && stop(false)
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("keydown", key)
  }

  return (
    <div ref={watch} data-component="p1-board" class="h-full p-4 flex gap-3 items-start">
      <For each={props.lanes}>
        {(lane, index) => {
          const count = () => layout().across[index()] ?? 1
          const over = () => state.drag?.lane === lane.key
          // Cards keep their place in the page while the slot moves, so the grid just shifts them around it.
          const order = (at: number) => (over() && at >= (state.drag?.at ?? 0) ? at + 1 : at)
          return (
            <div
              data-lane={lane.key}
              data-across={String(count())}
              class="shrink-0 max-h-full flex flex-col rounded-xl overflow-hidden bg-surface-base/60 border transition-colors"
              classList={{
                "border-border-interactive-base": over(),
                "border-transparent": !over(),
              }}
              style={{ width: `${width(count(), layout().size)}px` }}
            >
              <div class="shrink-0 px-3 py-2.5 flex items-start gap-2 border-b border-border-weaker-base bg-surface-base">
                <span class="min-w-0 flex-1 line-clamp-3 text-13-medium text-text-strong">{lane.title}</span>
                <span class="shrink-0 mt-px text-12-regular text-text-weak tabular-nums">{lane.rows.length}</span>
              </div>
              <div
                data-cards
                class="min-h-12 overflow-y-auto overflow-x-hidden p-2 grid gap-2 content-start"
                style={{
                  "grid-template-columns": count() ? `repeat(${count()}, minmax(0, 1fr))` : "minmax(0, 1fr)",
                }}
              >
                <Show when={over()}>
                  <div
                    data-slot
                    class="rounded-lg border-2 border-dashed border-border-interactive-base bg-surface-interactive-weak/40"
                    style={{ height: `${state.drag?.h ?? 0}px`, order: state.drag?.at ?? 0 }}
                  />
                </Show>
                <For each={lane.rows.filter((row) => row.id !== state.drag?.id)}>
                  {(row, at) => (
                    <Card
                      row={row}
                      stories={told(row.id, lane.who)}
                      style={{ order: order(at()) }}
                      sortable={props.sortable && !props.readonly}
                      opening={props.opening === row.id}
                      saving={!!props.saving[row.id]}
                      typing={state.typing?.id === row.id ? state.typing.col : undefined}
                      project={props.project}
                      folder={props.folder}
                      onType={(col) => setState("typing", { id: row.id, col })}
                      onDone={(col, text) => {
                        setState("typing", undefined)
                        if (text !== undefined) props.onEdited(row, col, text)
                      }}
                      onOpen={() => props.onOpen(row.id)}
                      onMenu={(x, y) => props.onMenu(row.id, x, y)}
                      onPoints={(x, y) => props.onPoints(row.id, x, y)}
                      onGrab={(event) =>
                        grab(
                          event,
                          row,
                          lane.key,
                          lane.rows.findIndex((item) => item.id === row.id),
                        )
                      }
                    />
                  )}
                </For>
                {/* A card dragged out of every column waits faded in its own place. */}
                <Show when={state.drag && !state.drag.lane && lane.rows.some((row) => row.id === state.drag?.id)}>
                  <div
                    class="rounded-lg border border-dashed border-border-weak-base"
                    style={{
                      height: `${state.drag?.h ?? 0}px`,
                      order: lane.rows.findIndex((row) => row.id === state.drag?.id),
                    }}
                  />
                </Show>
              </div>
            </div>
          )
        }}
      </For>
      <Show when={state.pick}>
        {(pick) => (
          <Menu
            at={pick().at}
            items={props.crew}
            picked={[String((pick().task ?? pick().story).owner)]}
            many={false}
            people
            clear={false}
            onPick={(id) => {
              const done = pick()
              setState("pick", undefined)
              if (!Number(id) || Number(id) === (done.task ?? done.story).owner) return
              if (done.task) return props.onTask(done.spec, done.story, done.task, Number(id))
              props.onOwner(done.spec, done.story, Number(id))
            }}
            onClose={() => setState("pick", undefined)}
          />
        )}
      </Show>
      <Show when={state.drag && held()}>
        {(row) => (
          <Portal>
            <div
              class="fixed z-[1000] pointer-events-none"
              style={{
                left: `${(state.drag?.x ?? 0) - (state.drag?.dx ?? 0)}px`,
                top: `${(state.drag?.y ?? 0) - (state.drag?.dy ?? 0)}px`,
                width: `${state.drag?.w ?? card}px`,
                transform: "rotate(2deg) scale(1.03)",
              }}
            >
              <Card
                row={row()}
                stories={told(row().id, props.lanes.find((lane) => lane.key === state.drag?.lane)?.who)}
                lifted
                sortable
                opening={false}
                saving={false}
                project={props.project}
                folder={props.folder}
                onType={() => undefined}
                onDone={() => undefined}
                onOpen={() => undefined}
                onMenu={() => undefined}
                onPoints={() => undefined}
                onGrab={() => undefined}
              />
            </div>
          </Portal>
        )}
      </Show>
    </div>
  )

  /**
   * A story's or task's chip: its name on up to two lines, then its owner (who can be changed) and its % finish,
   * which gives way to its time spent and left while the pointer is on it. Clicking it opens the spec's stories.
   */
  function Chip(chip: { spec: number; story: Story; task?: Task; onOpen: (x: number, y: number) => void }) {
    const item = () => chip.task ?? chip.story
    const picking = () => state.pick?.story.id === chip.story.id && state.pick?.task?.id === chip.task?.id
    const finish = () => Math.max(0, Math.min(100, item().finish))
    return (
      <div
        role="button"
        tabIndex={0}
        data-action={chip.task ? "p1-task" : "p1-story"}
        class="group/chip w-full flex flex-col gap-1 rounded-md px-2 py-1.5 hover:bg-surface-base-hover text-12-regular leading-4 text-left cursor-pointer"
        classList={{ "bg-surface-base": !chip.task, "bg-surface-base/50": !!chip.task }}
        onClick={(event) => chip.onOpen(event.clientX, event.clientY)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return
          const rect = event.currentTarget.getBoundingClientRect()
          chip.onOpen(rect.left, rect.bottom)
        }}
      >
        <span class="w-full flex items-start gap-2">
          <span class="shrink-0 flex h-4 items-center [&>svg]:size-3.5">
            <Show when={chip.task} fallback={<StoryIcon />}>
              <TaskIcon />
            </Show>
          </span>
          <span class="min-w-0 flex-1 line-clamp-2" classList={{ "text-text-base": !chip.task, "text-text-weak": !!chip.task }}>
            <Show when={!chip.task}>
              <KindTag type={chip.story.type} />
            </Show>
            {item().name}
          </span>
        </span>
        <span class="w-full flex items-center gap-2">
          <button
            type="button"
            data-action={chip.task ? "p1-task-owner" : "p1-story-owner"}
            class="min-w-0 truncate rounded px-1 -mx-1 text-text-weak group-hover/chip:text-text-base hover:!text-text-strong hover:bg-surface-raised-base-hover disabled:hover:bg-transparent transition-colors"
            classList={{ "!text-text-strong": picking() }}
            disabled={props.readonly}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              setState("pick", { spec: chip.spec, story: chip.story, task: chip.task, at: event.currentTarget.getBoundingClientRect() })
            }}
          >
            {item().person || language.t("p1.group.unassigned")}
          </button>
          <span
            class="ml-auto shrink-0 items-center gap-2 tabular-nums text-text-strong group-hover/chip:hidden"
            classList={{ flex: !picking(), hidden: picking() }}
          >
            <span class="h-1 w-10 rounded-full bg-background-base overflow-hidden">
              <span
                class="block h-full rounded-full"
                classList={{ "bg-surface-info-strong": !chip.task, "bg-surface-success-strong": !!chip.task }}
                style={{ width: `${finish()}%` }}
              />
            </span>
            <span class="min-w-8 text-right">{finish()}%</span>
          </span>
          <span class="ml-auto shrink-0 tabular-nums text-text-strong group-hover/chip:inline" classList={{ hidden: !picking() }}>
            {item().spent.toFixed(1)}h<span class="text-text-weak"> / </span>
            {item().remain.toFixed(1)}h
          </span>
        </span>
      </div>
    )
  }

  /**
   * A requirement's card: its ID (opens the editor), priority #, title and owner, edited in place, and its spec
   * points in hours, which open its stories.
   */
  function Card(card: {
    row: Row
    stories?: Story[]
    style?: JSX.CSSProperties
    lifted?: boolean
    sortable: boolean
    opening: boolean
    saving: boolean
    typing?: number
    project: number
    folder: number
    onType: (col: number) => void
    onDone: (col: number, text?: string) => void
    onOpen: () => void
    onMenu: (x: number, y: number) => void
    onPoints: (x: number, y: number) => void
    onGrab: (event: PointerEvent) => void
  }) {
    const points = () => Math.round((parseFloat(card.row.points) || 0) * 10) / 10
    // A field: its text as a button that starts editing, or P1's inline editor while it is being edited.
    const Edit = (field: { col: number; text: string; class: string; children: JSX.Element }) => (
      <Show
        when={card.typing === field.col}
        fallback={
          <button
            type="button"
            data-action={`p1-card-${field.col}`}
            class={`min-w-0 text-left rounded-md px-1 -mx-1 hover:bg-surface-base-hover disabled:hover:bg-transparent ${field.class}`}
            disabled={props.readonly}
            onClick={() => card.onType(field.col)}
          >
            {field.children}
          </button>
        }
      >
        <div data-cell class={`min-w-0 ${field.class}`}>
          <P1Inline
            project={card.project}
            id={card.row.id}
            col={field.col}
            text={field.text}
            folder={card.folder}
            status={card.row.cells[1114] ?? card.row.status}
            onDone={(text) => card.onDone(field.col, text)}
          />
        </div>
      </Show>
    )
    return (
      <div
        data-card={card.row.id}
        class="p-3 rounded-lg bg-background-base border flex flex-col gap-1.5 select-none"
        classList={{
          "border-border-weaker-base hover:border-border-base": !card.lifted,
          "cursor-grab": card.sortable && !card.lifted,
          "border-border-interactive-base": card.lifted,
          "opacity-60": card.saving,
        }}
        style={{
          ...card.style,
          ...(card.lifted ? { "box-shadow": "0 18px 40px rgb(0 0 0 / 0.45), 0 2px 6px rgb(0 0 0 / 0.3)" } : {}),
        }}
        onPointerDown={(event) => card.onGrab(event)}
        onContextMenu={(event) => {
          event.preventDefault()
          card.onMenu(event.clientX, event.clientY)
        }}
      >
        <div class="h-6 flex items-center justify-between gap-2 text-12-regular">
          <div class="min-w-0 flex items-center gap-1.5">
            <button
              type="button"
              data-action="p1-requirement"
              class="shrink-0 text-12-medium text-text-interactive-base rounded-md px-1 -mx-1 hover:bg-surface-base-hover hover:underline underline-offset-2"
              onClick={() => card.onOpen()}
            >
              {card.row.type || "Spec"} <span class="font-mono">{card.row.id}</span>
            </button>
            {/* The link checks' warnings: no linked requirements, no linked test cases. */}
            <For each={(["links", "tests"] as const).filter((kind) => props.warn?.[kind].includes(card.row.id))}>
              {(kind) => (
                <button
                  type="button"
                  class="relative group/tip inline-flex"
                  aria-label={language.t(`p1.warn.${kind}`)}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => props.onLinks?.(card.row.id)}
                >
                  <Show when={kind === "links"} fallback={<Untested />}>
                    <Unlinked />
                  </Show>
                  <Tip text={language.t(`p1.warn.${kind}`)} side="left" />
                </button>
              )}
            </For>
            <Show when={card.opening || card.saving}>
              <Spinner class="size-3.5" />
            </Show>
          </div>
          <Edit col={1132} text={card.row.cells[1132] ?? ""} class="shrink-0 w-20 flex justify-end text-text-weak">
            <span class="tabular-nums">
              P# <span class="text-text-strong">{card.row.cells[1132] || "—"}</span>
            </span>
          </Edit>
        </div>
        <Edit col={1101} text={card.row.title} class="w-full text-13-medium text-text-strong">
          <span class="line-clamp-3">{card.row.title}</span>
        </Edit>
        {/* Its stories as chips, each with its tasks under it when they are on; a chip opens the spec's stories. */}
        <Show when={card.stories?.length}>
          <div class="pt-0.5 flex flex-col gap-1.5">
            <For each={card.stories}>
              {(story) => (
                <div class="flex flex-col gap-1">
                  <Chip spec={card.row.id} story={story} onOpen={card.onPoints} />
                  <Show when={props.tasks && story.tasks.length}>
                    <div class="ml-3 pl-2 border-l border-border-weaker-base flex flex-col gap-1">
                      <For each={story.tasks}>
                        {(task) => <Chip spec={card.row.id} story={story} task={task} onOpen={card.onPoints} />}
                      </For>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
        <div
          class="min-h-6 flex items-center justify-between gap-2 text-12-regular text-text-weak"
          classList={{ "pt-1.5 mt-0.5 border-t border-border-weaker-base": !!card.stories?.length }}
        >
          <Edit col={1113} text={card.row.owner} class="flex-1 truncate">
            <span class="block truncate">{card.row.owner || language.t("p1.group.unassigned")}</span>
          </Edit>
          {/* Spec points in hours, as the list shows them; they open the spec's stories and their points. */}
          <button
            type="button"
            data-action="p1-points"
            class="shrink-0 rounded-md px-1 -mx-1 tabular-nums text-text-interactive-base hover:bg-surface-base-hover underline-offset-2 hover:underline"
            onClick={(event) => card.onPoints(event.clientX, event.clientY)}
          >
            {points().toFixed(1)}h
          </button>
        </div>
      </div>
    )
  }
}
