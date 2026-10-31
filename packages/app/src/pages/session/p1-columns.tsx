import { For, Show, createMemo, onCleanup, onMount } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useLanguage } from "@/context/language"
import { defaults, keep, pinned, type Column } from "@/p1/columns"
import { useP1 } from "@/p1/settings"
import { Frame } from "./p1-item"

const ease = "cubic-bezier(0.2, 0.8, 0.2, 1)"

/**
 * P1's Customize dialog for the requirement list. Drag a field from the left into the list on the right,
 * drag to reorder, drag one back to remove it; + and × do the same with a click, and Alt+↑/↓ moves a field.
 * While you drag, the list opens a space where the field will land and the other fields slide out of its way.
 */
export function P1Columns(props: {
  project: number
  chosen: Column[]
  pool: Column[]
  onClose: () => void
  onSaved: (list: Column[]) => void
}) {
  const p1 = useP1()
  const language = useLanguage()
  const [state, setState] = createStore({
    list: [...props.chosen],
    find: "",
    busy: false,
    err: "",
    // The field being dragged, where the pointer is, and where it would land: a slot in the list, or out of it.
    drag: undefined as
      | { item: Column; from: "pool" | "list"; x: number; y: number; dx: number; dy: number; w: number; settle: boolean }
      | undefined,
    to: undefined as number | undefined,
    out: false,
    // A field that just landed, to flash it.
    landed: 0,
  })
  const left = createMemo(() => {
    const query = state.find.trim().toLowerCase()
    return props.pool
      .filter((item) => !state.list.some((other) => other.id === item.id))
      .filter((item) => !query || item.name.toLowerCase().includes(query))
      .toSorted((a, b) => a.name.localeCompare(b.name))
  })
  // The list as it will be if you let go now, with the dragged field in its new place.
  const shown = createMemo(() => {
    const drag = state.drag
    if (!drag) return state.list
    const rest = state.list.filter((item) => item.id !== drag.item.id)
    const at = state.to ?? (drag.from === "list" && !state.out ? state.list.findIndex((item) => item.id === drag.item.id) : -1)
    if (at < 0) return rest
    return [...rest.slice(0, at), drag.item, ...rest.slice(at)]
  })
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err))
  let pool: HTMLElement | undefined
  let list: HTMLDivElement | undefined

  // Changes the list and slides each field from where it was to where it now is.
  const flip = (change: () => void) => {
    const rows = () => Array.from(list?.querySelectorAll<HTMLElement>("[data-column]") ?? [])
    const before = new Map(rows().map((row) => [row.dataset.column, row.getBoundingClientRect().top]))
    change()
    rows().forEach((row) => {
      const was = before.get(row.dataset.column)
      if (was === undefined) return
      const dy = was - row.getBoundingClientRect().top
      if (Math.abs(dy) < 1) return
      row.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], { duration: 180, easing: ease })
    })
  }
  const land = (id: number) => {
    setState("landed", id)
    setTimeout(() => state.landed === id && setState("landed", 0), 900)
  }
  const put = (item: Column, at: number) => {
    const rest = state.list.filter((other) => other.id !== item.id)
    flip(() => setState("list", [...rest.slice(0, at), item, ...rest.slice(at)]))
    land(item.id)
    queueMicrotask(() => list?.querySelector(`[data-column="${item.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }))
  }
  const drop = (item: Column) => {
    if (item.id === pinned) return
    flip(() => setState("list", (all) => all.filter((other) => other.id !== item.id)))
  }

  const grab = (event: PointerEvent, item: Column, from: "pool" | "list") => {
    if (event.button !== 0 || state.drag || (event.target as HTMLElement).closest("button")) return
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const start = { x: event.clientX, y: event.clientY }
    // The window follows the pointer, not the field: the field moves in the list while you drag,
    // and moving it would drop a pointer capture and lose the release.
    event.preventDefault()
    const inside = (el: Element | undefined, x: number, y: number) => {
      const r = el?.getBoundingClientRect()
      return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
    }
    const move = (next: PointerEvent) => {
      if (!state.drag && Math.hypot(next.clientX - start.x, next.clientY - start.y) < 4) return
      if (!state.drag) {
        document.body.style.cursor = "grabbing"
        setState("drag", {
          item,
          from,
          x: next.clientX,
          y: next.clientY,
          dx: start.x - rect.left,
          dy: start.y - rect.top,
          w: rect.width,
          settle: false,
        })
      }
      setState("drag", { x: next.clientX, y: next.clientY })
      if (list && inside(list.parentElement ?? undefined, next.clientX, next.clientY)) {
        // Scroll the list when the pointer nears its top or bottom.
        const box = list.getBoundingClientRect()
        if (next.clientY > box.bottom - 40) list.scrollTop += 10
        if (next.clientY < box.top + 40) list.scrollTop -= 10
        // The slot among the other fields, by which half of a field the pointer is over; layout
        // positions, not on-screen ones, so fields still sliding don't make the slot flicker.
        const y = next.clientY - box.top + list.scrollTop
        const to = Array.from(list.querySelectorAll<HTMLElement>("[data-column]"))
          .filter((row) => row.dataset.column !== String(item.id))
          .filter((row) => row.offsetTop + row.offsetHeight / 2 < y).length
        if (to !== state.to || state.out) flip(() => setState({ to, out: false }))
        return
      }
      const out = from === "list" && item.id !== pinned && inside(pool, next.clientX, next.clientY)
      if (state.to !== undefined || out !== state.out) flip(() => setState({ to: undefined, out }))
    }
    const finish = () => {
      document.body.style.cursor = ""
      setState({ drag: undefined, to: undefined, out: false })
    }
    const stop = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", cancel)
      window.removeEventListener("blur", cancel)
      window.removeEventListener("keydown", key, true)
    }
    // Escape, losing the window or a cancelled pointer puts the field back where it was.
    const cancel = () => {
      stop()
      if (!state.drag) return
      flip(() => setState({ to: undefined, out: false }))
      finish()
    }
    const key = (next: KeyboardEvent) => {
      if (next.key !== "Escape") return
      next.preventDefault()
      next.stopPropagation()
      cancel()
    }
    const up = (next: PointerEvent) => {
      stop()
      if (!state.drag) return
      // Let go outside the list and outside the fields to remove: nothing changes.
      const over = (el?: Element) => {
        const r = el?.getBoundingClientRect()
        return !!r && next.clientX >= r.left && next.clientX <= r.right && next.clientY >= r.top && next.clientY <= r.bottom
      }
      if (!state.out && !over(list?.parentElement ?? undefined)) flip(() => setState("to", undefined))
      if (state.out) {
        drop(item)
        return finish()
      }
      const hole = list?.querySelector<HTMLElement>(`[data-column="${item.id}"]`)?.getBoundingClientRect()
      const order = shown()
      const moved = state.to !== undefined
      // The card glides into the space before the field takes it.
      if (hole) setState("drag", { settle: true, x: hole.left + state.drag.dx, y: hole.top + state.drag.dy })
      setTimeout(
        () => {
          if (moved) setState("list", order)
          finish()
          if (moved) land(item.id)
        },
        hole ? 160 : 0,
      )
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", cancel)
    window.addEventListener("blur", cancel)
    window.addEventListener("keydown", key, true)
  }

  const reset = async () => {
    setState({ busy: true, err: "" })
    const found = await defaults(p1.server(), p1.token(), props.project, language.locale()).catch((err: unknown) => {
      setState("err", message(err))
    })
    setState("busy", false)
    if (found?.length) flip(() => setState("list", found))
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
      if (event.key === "Escape" && !state.drag) props.onClose()
    }
    window.addEventListener("keydown", key)
    onCleanup(() => window.removeEventListener("keydown", key))
  })

  const hole = (item: Column) => state.drag?.item.id === item.id

  return (
    <Frame name="p1-columns" class="max-w-4xl h-[80vh]">
      <header class="shrink-0 px-6 py-4 flex items-center gap-3 border-b border-border-weaker-base">
        <div class="min-w-0 flex-1">
          <div class="truncate text-18-medium text-text-strong">{language.t("p1.act.customize")}</div>
          <div class="mt-0.5 text-12-regular text-text-weak">{language.t("p1.columns.hint")}</div>
        </div>
        <Button variant="ghost" size="large" disabled={state.busy} onClick={() => void reset()} data-action="p1-columns-reset">
          {language.t("p1.columns.reset")}
        </Button>
        <Button variant="ghost" size="large" onClick={() => props.onClose()}>
          {language.t("p1.form.cancel")}
        </Button>
        <Button variant="primary" size="large" disabled={state.busy} onClick={() => void submit()} data-action="p1-columns-submit">
          <Show when={state.busy}>
            <Spinner class="size-4" />
          </Show>
          {language.t("p1.form.submit")}
        </Button>
      </header>
      <Show when={state.err}>
        <p class="shrink-0 px-6 pt-3 text-12-regular text-text-diff-delete-base">{state.err}</p>
      </Show>
      <div class="flex-1 min-h-0 grid grid-cols-[2fr_3fr] gap-4 p-5 select-none">
        <section
          ref={pool}
          class="relative min-h-0 flex flex-col rounded-xl border-2 transition-colors duration-150"
          classList={{
            "border-transparent bg-background-base": !state.out,
            "border-dashed border-text-diff-delete-base bg-surface-base": state.out,
          }}
        >
          <div class="shrink-0 px-3 pt-3 pb-2 flex flex-col gap-2">
            <span class="px-1 text-12-medium text-text-weak">{language.t("p1.columns.available")}</span>
            <div class="h-9 px-2.5 flex items-center gap-2 rounded-lg bg-surface-base border border-border-weaker-base focus-within:border-border-interactive-base">
              <Icon name="magnifying-glass" size="small" class="shrink-0 text-icon-weak" />
              <input
                class="min-w-0 flex-1 bg-transparent text-13-regular text-text-strong outline-none placeholder:text-text-weak"
                value={state.find}
                placeholder={language.t("p1.columns.search")}
                onInput={(event) => setState("find", event.currentTarget.value)}
              />
            </div>
          </div>
          <div class="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
            <For each={left()}>
              {(item) => (
                <div
                  data-action="p1-columns-field"
                  class="group h-10 px-2.5 flex items-center gap-2.5 rounded-lg text-13-regular text-text-strong cursor-grab hover:bg-surface-base-hover"
                  classList={{ "opacity-40": hole(item) }}
                  onPointerDown={(event) => grab(event, item, "pool")}
                  onDblClick={() => put(item, state.list.length)}
                >
                  <Icon name="dot-grid" size="small" class="shrink-0 text-icon-weak" />
                  <span class="min-w-0 flex-1 truncate">{item.name}</span>
                  <button
                    type="button"
                    data-action="p1-columns-add"
                    aria-label={language.t("p1.columns.add")}
                    title={language.t("p1.columns.add")}
                    class="size-7 shrink-0 rounded-md flex items-center justify-center text-icon-base hover:bg-surface-raised-base-hover hover:text-icon-strong-base"
                    onClick={() => put(item, state.list.length)}
                  >
                    <Icon name="plus-small" size="small" />
                  </button>
                </div>
              )}
            </For>
          </div>
          <Show when={state.out}>
            <div class="absolute inset-x-0 bottom-4 flex justify-center pointer-events-none">
              <span class="h-8 px-3 rounded-full flex items-center gap-1.5 bg-surface-raised-stronger-non-alpha border border-border-strong-base text-12-medium text-text-diff-delete-base shadow-lg-border-base">
                <Icon name="trash" size="small" />
                {language.t("p1.columns.out")}
              </span>
            </div>
          </Show>
        </section>
        <section
          class="min-h-0 flex flex-col rounded-xl border-2 transition-colors duration-150"
          classList={{
            "border-transparent bg-background-base": state.to === undefined,
            "border-border-interactive-base bg-background-base": state.to !== undefined,
          }}
        >
          <div class="shrink-0 px-4 pt-3 pb-2 text-12-medium text-text-weak">
            {language.t("p1.columns.chosen", { count: state.list.length })}
          </div>
          <div ref={list} class="relative flex-1 min-h-0 overflow-y-auto px-2 pb-2">
            <For each={shown()}>
              {(item, index) => (
                <div
                  data-column={item.id}
                  tabindex="0"
                  class="group relative h-11 px-2 mb-1.5 flex items-center gap-2.5 rounded-lg text-13-regular outline-none focus-visible:shadow-[0_0_0_2px_var(--border-interactive-base)]"
                  classList={{
                    // The space where the dragged field will land.
                    "border-2 border-dashed border-border-interactive-base bg-surface-interactive-weak text-text-interactive-base":
                      hole(item),
                    "border border-border-weaker-base bg-surface-base text-text-strong cursor-grab hover:border-border-base":
                      !hole(item),
                    "shadow-[0_0_0_2px_var(--border-interactive-base)]": state.landed === item.id && !hole(item),
                  }}
                  style={{ transition: "box-shadow 600ms ease-out, background-color 150ms" }}
                  onPointerDown={(event) => grab(event, item, "list")}
                  onKeyDown={(event) => {
                    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return
                    event.preventDefault()
                    const at = index() + (event.key === "ArrowUp" ? -1 : 1)
                    if (at < 0 || at >= state.list.length) return
                    put(item, at)
                    queueMicrotask(() => list?.querySelector<HTMLElement>(`[data-column="${item.id}"]`)?.focus())
                  }}
                >
                  <Icon name="dot-grid" size="small" class="shrink-0" classList={{ "text-icon-weak group-hover:text-icon-base": !hole(item) }} />
                  <span
                    class="w-5 shrink-0 text-right text-12-medium tabular-nums"
                    classList={{ "text-text-weaker": !hole(item) }}
                  >
                    {index() + 1}
                  </span>
                  <span class="min-w-0 flex-1 truncate" classList={{ "text-14-medium": hole(item) }}>
                    {item.name}
                  </span>
                  <Show when={!hole(item)}>
                    <Show
                      when={item.id !== pinned}
                      fallback={
                        <span class="shrink-0 h-6 px-2 rounded-md flex items-center gap-1 bg-background-base text-11-medium text-text-weak">
                          <Icon name="pin" size="small" />
                          {language.t("p1.columns.pinned")}
                        </span>
                      }
                    >
                      <button
                        type="button"
                        aria-label={language.t("p1.columns.remove")}
                        title={language.t("p1.columns.remove")}
                        class="size-7 shrink-0 rounded-md flex items-center justify-center text-icon-weak hover:bg-surface-raised-base-hover hover:text-icon-strong-base"
                        onClick={() => drop(item)}
                      >
                        <Icon name="close-small" size="small" />
                      </button>
                    </Show>
                  </Show>
                </div>
              )}
            </For>
            <Show when={state.drag?.from === "pool" && state.to === undefined}>
              <div class="h-11 rounded-lg border-2 border-dashed border-border-weak-base flex items-center justify-center text-12-regular text-text-weak">
                {language.t("p1.columns.drop")}
              </div>
            </Show>
          </div>
        </section>
      </div>
      <Show when={state.drag}>
        {(drag) => (
          <Portal>
            <div
              class="fixed z-[60] pointer-events-none h-11 px-2 flex items-center gap-2.5 rounded-lg border bg-surface-raised-stronger-non-alpha text-13-medium text-text-strong"
              classList={{
                "border-border-interactive-base": !state.out,
                "border-text-diff-delete-base": state.out,
              }}
              style={{
                left: `${drag().x - drag().dx}px`,
                top: `${drag().y - drag().dy}px`,
                width: `${drag().w}px`,
                transform: drag().settle ? "none" : "rotate(-1.5deg) scale(1.03)",
                transition: drag().settle ? `left 160ms ${ease}, top 160ms ${ease}, transform 160ms ${ease}` : "transform 120ms ease-out",
                "box-shadow": drag().settle
                  ? "0 2px 6px rgb(0 0 0 / 0.25)"
                  : "0 18px 44px rgb(0 0 0 / 0.5), 0 3px 10px rgb(0 0 0 / 0.3)",
                opacity: state.out ? 0.85 : 1,
              }}
            >
              <Icon name="dot-grid" size="small" class="shrink-0 text-icon-base" />
              <Show when={state.to !== undefined}>
                <span class="w-5 shrink-0 text-right text-12-medium tabular-nums text-text-interactive-base">
                  {(state.to ?? 0) + 1}
                </span>
              </Show>
              <span class="min-w-0 flex-1 truncate">{drag().item.name}</span>
              <Show when={state.out}>
                <Icon name="trash" size="small" class="shrink-0 text-text-diff-delete-base" />
              </Show>
            </div>
          </Portal>
        )}
      </Show>
    </Frame>
  )
}
