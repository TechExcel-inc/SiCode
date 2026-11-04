import { For, Show, createMemo, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import type { Row } from "@/p1/api"
import type { Story } from "@/p1/stories"
import { board, calendar, current, today, total, type Band, type Card, type Day } from "@/p1/weekly"
import { SpecIcon } from "./p1-icons"

// P1's weekday header colours, Monday to Sunday, as its List by End Date board draws them.
const colors = ["#49c3d8", "#7280ff", "#d88cf6", "#ff7d9e", "#e99c38", "#ffc500", "#1fde70"]
const names = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const

// Owners whose band is folded, kept while the app runs.
const shut = new Set<number>()

const hours = (value: number) => `${Math.round(value * 10) / 10}h`

// A day's width, which every story card fills; To be planned cards take the same width.
const day = 264
const columns = `200px repeat(7, ${day}px)`

/**
 * The weekly board of a roadmap month: P1's List by End Date board for the stories of the folder's requirements.
 * One band per story owner, a column per weekday, each story on the day its end date falls and the rest in To be
 * planned. Dragging a story to a day sets its end date (and its owner, onto another owner's band); dropping it on
 * To be planned clears the date.
 */
export function P1Weekly(props: {
  month: string
  rows: Row[]
  tales: Record<number, Story[]>
  readonly: boolean
  onStory: (spec: number, story: Story, x: number, y: number) => void
  onMove: (spec: number, story: Story, change: { end: string; owner: number }) => void
}) {
  const language = useLanguage()
  const weeks = createMemo(() => calendar(props.month))
  const [state, setState] = createStore({
    week: current(calendar(props.month)),
    shut: [...shut],
    // The story being dragged, and the cell under it.
    drag: undefined as Card | undefined,
    over: "",
    // The width the board is seen at, which its bars keep to while it scrolls sideways.
    width: 0,
  })
  let el: HTMLDivElement | undefined
  onMount(() => {
    // The nearest parent that scrolls sideways is the frame the board is seen through.
    let frame = el?.parentElement
    while (frame && !/(auto|scroll)/.test(getComputedStyle(frame).overflowX)) frame = frame.parentElement
    if (!frame) return
    const seen = frame
    const watch = new ResizeObserver(() => setState("width", seen.clientWidth))
    watch.observe(seen)
    onCleanup(() => watch.disconnect())
  })
  // Bars stay in view: pinned to the left at the seen width.
  const pinned = () => (state.width ? { width: `${state.width}px` } : {})
  const week = () => weeks()[Math.min(state.week, weeks().length - 1)]
  const cards = createMemo(() =>
    props.rows.flatMap((row) => (props.tales[row.id] ?? []).map((story) => ({ spec: row.id, title: row.title, story }))),
  )
  const bands = createMemo(() => board(cards(), weeks(), week()))
  const sum = createMemo(() => ({
    owners: bands().length,
    stories: cards().length,
    spent: cards().reduce((all, card) => all + card.story.spent, 0),
    remain: cards().reduce((all, card) => all + card.story.remain, 0),
    points: cards().reduce((all, card) => all + card.story.points, 0),
  }))
  const now = today()
  const label = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`
  const toggle = (owner: number) => {
    if (shut.has(owner)) shut.delete(owner)
    else shut.add(owner)
    setState("shut", [...shut])
  }

  const drop = (band: Band, end: string) => {
    const card = state.drag
    setState({ drag: undefined, over: "" })
    if (!card || props.readonly) return
    if (card.story.end === end && card.story.owner === band.owner) return
    props.onMove(card.spec, card.story, { end, owner: band.owner })
  }
  // A cell takes a story while it's in the month and you may edit.
  const target = (key: string, band: Band, end: string, open: boolean) => ({
    onDragOver: (event: DragEvent) => {
      if (!open || props.readonly || !state.drag) return
      event.preventDefault()
      if (state.over !== key) setState("over", key)
    },
    onDragLeave: () => state.over === key && setState("over", ""),
    onDrop: (event: DragEvent) => {
      event.preventDefault()
      if (open) drop(band, end)
    },
  })

  const Story = (box: { card: Card }) => {
    const story = () => box.card.story
    return (
      <div
        draggable={!props.readonly}
        class="flex flex-col gap-1.5 p-2 rounded-md bg-[#ffffff] text-[#333333] shadow-[0_1px_3px_rgba(0,0,0,0.25)]"
        classList={{
          "cursor-grab active:cursor-grabbing": !props.readonly,
          "opacity-40": state.drag?.story.id === story().id,
        }}
        onDragStart={(event) => {
          event.dataTransfer?.setData("text/plain", String(story().id))
          setState("drag", box.card)
        }}
        onDragEnd={() => setState({ drag: undefined, over: "" })}
      >
        <div class="flex items-center gap-1 text-12-regular">
          <span class="shrink-0 size-4 flex [&>span]:!size-4">
            <SpecIcon name="spec" />
          </span>
          <button
            type="button"
            data-action="p1-weekly-story"
            class="font-mono text-[#1984c8] hover:underline"
            onClick={(event) => props.onStory(box.card.spec, story(), event.clientX, event.clientY)}
          >
            {story().tag || `#${story().id}`}
          </button>
          <span class="flex-1" />
          <span class="shrink-0 tabular-nums text-[#666]">
            {hours(story().spent)}/{hours(story().remain)}/{story().points}
          </span>
        </div>
        <div class="text-13-regular leading-snug line-clamp-3 break-words">{story().name}</div>
        <div class="flex items-center gap-2">
          <span class="flex-1 h-1.5 rounded-full bg-[#e8e8e8] overflow-hidden">
            <span class="block h-full bg-[#2d8cf0]" style={{ width: `${Math.min(100, story().finish)}%` }} />
          </span>
          <span class="shrink-0 text-11-regular tabular-nums text-[#666]">{Math.floor(story().finish)}%</span>
          {/* The story's status, light blue as P1's cards show it. */}
          <Show when={story().status}>
            <span class="shrink-0 max-w-28 truncate px-2 py-0.5 rounded bg-[#e2f7fa] text-11-medium text-[#1984c8]">
              {story().status}
            </span>
          </Show>
        </div>
      </div>
    )
  }

  const Header = () => (
    <div class="sticky top-11 z-[5] grid" style={{ "grid-template-columns": columns }}>
      <div class="h-9 flex items-center justify-center text-13-medium text-[#ffffff] bg-[#757486]">
        {language.t("p1.weekly.dates")}
      </div>
      <For each={week().days}>
        {(day, at) => (
          <div
            class="h-9 flex items-center justify-center gap-1.5 text-13-medium text-[#ffffff]"
            style={{ background: colors[at()], opacity: day.inside ? 1 : 0.55 }}
          >
            {language.t(`p1.weekly.${names[at()]}`)}
            <span class="text-12-regular opacity-85 tabular-nums">{label(day.date)}</span>
          </div>
        )}
      </For>
    </div>
  )

  const Cell = (box: { band: Band; day: Day }) => {
    const key = () => `${box.band.owner}:${box.day.date}`
    const list = () => box.band.days[box.day.date] ?? []
    return (
      <div
        class="min-w-0 min-h-36 p-2 flex flex-col gap-2 border-l border-[rgba(255,255,255,0.1)]"
        classList={{
          "bg-[rgba(255,255,255,0.2)]": box.day.inside,
          "bg-[rgba(232,232,232,0.45)]": !box.day.inside,
          "outline-1 outline-dashed -outline-offset-1 outline-[rgba(109,227,246,.85)]": box.day.date === now,
          "outline-2 outline-dashed -outline-offset-2 outline-[#3d78fb] bg-[rgba(255,255,255,0.3)]": state.over === key(),
        }}
        {...target(key(), box.band, box.day.date, box.day.inside)}
      >
        <For each={list()}>{(card) => <Story card={card} />}</For>
      </div>
    )
  }

  return (
    <div ref={el} data-component="p1-weekly" class="w-max min-w-full flex flex-col">
      {/* The month's summary and its weeks, as P1's Summary bar, kept in view as the board scrolls either way. */}
      <div
        class="sticky top-0 left-0 z-10 h-11 px-4 flex items-center gap-5 bg-[#1f2633] text-13-regular text-[#dfe6f0]"
        style={pinned()}
      >
        <span class="text-[#49c3d8] text-13-medium">{language.t("p1.weekly.summary")}</span>
        <span>{language.t("p1.weekly.owners", { count: sum().owners })}</span>
        <span>{language.t("p1.weekly.stories", { count: sum().stories })}</span>
        <span>
          {language.t("p1.weekly.spent")}: {hours(sum().spent)}
        </span>
        <span>
          {language.t("p1.weekly.remain")}: {hours(sum().remain)}
        </span>
        <span>
          {language.t("p1.weekly.points")}: {Math.round(sum().points * 10) / 10}
        </span>
        <span class="flex-1" />
        <div class="flex items-center gap-1">
          <button
            type="button"
            data-action="p1-weekly-prev"
            class="size-7 rounded-md flex items-center justify-center hover:bg-[rgba(255,255,255,0.1)] disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label={language.t("p1.weekly.prev")}
            disabled={state.week <= 0}
            onClick={() => setState("week", (at) => at - 1)}
          >
            <Icon name="chevron-left" size="small" />
          </button>
          <span class="min-w-44 text-center tabular-nums text-[#ffffff]">
            {week().from} – {week().to}
          </span>
          <button
            type="button"
            data-action="p1-weekly-next"
            class="size-7 rounded-md flex items-center justify-center hover:bg-[rgba(255,255,255,0.1)] disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label={language.t("p1.weekly.next")}
            disabled={state.week >= weeks().length - 1}
            onClick={() => setState("week", (at) => at + 1)}
          >
            <Icon name="chevron-right" size="small" />
          </button>
        </div>
      </div>
      <For each={bands()}>
        {(band) => {
          const open = () => !state.shut.includes(band.owner)
          const shown = () => week().days.flatMap((day) => band.days[day.date] ?? [])
          return (
            <section class="border-b border-[#2c3442]">
              <button
                type="button"
                data-action="p1-weekly-band"
                class="sticky left-0 w-full h-12 px-4 flex items-center gap-5 bg-[#222b38] text-left text-13-regular text-[#dfe6f0] hover:bg-[#283242]"
                style={pinned()}
                onClick={() => toggle(band.owner)}
              >
                <span class="shrink-0 w-3 text-[10px]">{open() ? "▼" : "▲"}</span>
                <span class="w-40 truncate text-14-medium text-[#ffffff]">
                  {band.person || language.t("p1.weekly.unassigned")}
                </span>
                <span>
                  {language.t("p1.weekly.spent")}: {hours(band.spent)}
                </span>
                <span>
                  {language.t("p1.weekly.remain")}: {hours(band.remain)}
                </span>
                <span>
                  {language.t("p1.weekly.points")}: {Math.round(band.points * 10) / 10}
                </span>
                <span>{language.t("p1.weekly.stories", { count: band.count })}</span>
              </button>
              <Show when={open()}>
                <div
                  class="bg-cover bg-center"
                  style={{ "background-image": "url(/p1/board.jpg)", "background-attachment": "fixed" }}
                >
                  <Header />
                  <div class="grid" style={{ "grid-template-columns": columns }}>
                    <div class="p-3 flex flex-col gap-2 bg-[#383e47] text-[#dfe6f0]">
                      <span class="text-12-medium tabular-nums">
                        {week().from} – {week().to}
                      </span>
                      <span class="text-12-regular tabular-nums text-[#aab4c3]">
                        {hours(total(shown()).spent)}/{hours(total(shown()).remain)} ·{" "}
                        {language.t("p1.weekly.stories", { count: total(shown()).count })}
                      </span>
                    </div>
                    <For each={week().days}>{(day) => <Cell band={band} day={day} />}</For>
                  </div>
                  {/* To be planned: stories with no end date, or one outside the month. */}
                  <div
                    class="grid border-t border-[rgba(255,255,255,0.1)]"
                    style={{ "grid-template-columns": "200px 1fr" }}
                  >
                    <div class="p-3 flex flex-col gap-1 bg-[#000000] text-[#dfe6f0]">
                      <span class="text-13-medium">{language.t("p1.weekly.later")}</span>
                      <span class="text-12-regular tabular-nums text-[#aab4c3]">
                        {hours(total(band.later).spent)}/{hours(total(band.later).remain)} ·{" "}
                        {language.t("p1.weekly.stories", { count: band.later.length })}
                      </span>
                    </div>
                    <div
                      class="min-w-0 min-h-24 p-2 flex flex-wrap gap-2 content-start bg-[rgba(0,0,0,0.45)]"
                      classList={{
                        "outline-2 outline-dashed -outline-offset-2 outline-[#3d78fb]":
                          state.over === `${band.owner}:later`,
                      }}
                      {...target(`${band.owner}:later`, band, "", true)}
                    >
                      <For each={band.later}>
                        {(card) => (
                          <div class="shrink-0" style={{ width: `${day - 16}px` }}>
                            <Story card={card} />
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </div>
              </Show>
            </section>
          )
        }}
      </For>
      <Show when={!bands().length}>
        <p class="p-6 text-13-regular text-text-weak">{language.t("p1.weekly.none")}</p>
      </Show>
    </div>
  )
}
