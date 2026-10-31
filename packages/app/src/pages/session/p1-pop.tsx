import { For, onCleanup, onMount, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore } from "solid-js/store"
import { useP1, type Box } from "@/p1/settings"

const gap = 24

/**
 * A popup you can move by any `data-drag` part (its header) and resize from its edges and corners.
 * Where you leave it and how big you make it are kept by `name`, so it opens there next time.
 * The first time it opens centered on the click, clear of the window's edges.
 */
const open: symbol[] = []

/**
 * Takes a place on the stack of popups and pickers: each sits above the one opened before it, so its backdrop
 * catches any click outside it and closes it before anything underneath can open another.
 */
export function layer() {
  const me = Symbol()
  open.push(me)
  onCleanup(() => open.splice(open.indexOf(me), 1))
  return { z: 40 + open.length * 10, top: () => open.at(-1) === me }
}

export function P1Pop(props: {
  name: string
  x: number
  y: number
  width: number
  min?: { w: number; h: number }
  onClose: () => void
  children: JSX.Element
}) {
  const p1 = useP1()
  const least = () => props.min ?? { w: 360, h: 200 }
  const fit = (box: Box): Box => {
    const w = Math.max(least().w, Math.min(box.w, window.innerWidth - gap * 2))
    const h = box.h === undefined ? undefined : Math.max(least().h, Math.min(box.h, window.innerHeight - gap * 2))
    return {
      w,
      h,
      x: Math.max(gap, Math.min(box.x, window.innerWidth - w - gap)),
      y: Math.max(gap, Math.min(box.y, window.innerHeight - (h ?? least().h) - gap)),
    }
  }
  const kept = p1.box(props.name)
  const [box, setBox] = createStore<Box>(fit(kept ?? { x: props.x - props.width / 2, y: props.y + 12, w: props.width }))
  let el: HTMLDivElement | undefined
  const stack = layer()

  onMount(() => {
    // A popup that grew with its content still has to fit the window.
    const rect = el?.getBoundingClientRect()
    if (rect && rect.bottom > window.innerHeight - gap)
      setBox("y", Math.max(gap, window.innerHeight - rect.height - gap))
    // Escape closes only the popup on top, such as a form opened from another popup.
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && stack.top()) props.onClose()
    }
    window.addEventListener("keydown", key)
    onCleanup(() => window.removeEventListener("keydown", key))
  })

  const track = (event: PointerEvent, step: (dx: number, dy: number, from: Box) => Box) => {
    event.preventDefault()
    event.stopPropagation()
    const rect = el?.getBoundingClientRect()
    const from = { ...box, h: box.h ?? rect?.height }
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
    const move = (next: PointerEvent) =>
      setBox(fit(step(next.clientX - event.clientX, next.clientY - event.clientY, from)))
    const up = () => {
      target.removeEventListener("pointermove", move)
      target.removeEventListener("pointerup", up)
      target.removeEventListener("pointercancel", up)
      document.body.style.cursor = ""
      p1.place(props.name, { ...box })
    }
    document.body.style.cursor = getComputedStyle(target).cursor
    target.addEventListener("pointermove", move)
    target.addEventListener("pointerup", up)
    target.addEventListener("pointercancel", up)
  }

  const edges = [
    { side: "e", class: "top-2 bottom-2 -right-1 w-2 cursor-ew-resize" },
    { side: "w", class: "top-2 bottom-2 -left-1 w-2 cursor-ew-resize" },
    { side: "s", class: "left-2 right-2 -bottom-1 h-2 cursor-ns-resize" },
    { side: "n", class: "left-2 right-2 -top-1 h-2 cursor-ns-resize" },
    { side: "se", class: "-right-1 -bottom-1 size-4 cursor-nwse-resize" },
    { side: "sw", class: "-left-1 -bottom-1 size-4 cursor-nesw-resize" },
    { side: "ne", class: "-right-1 -top-1 size-4 cursor-nesw-resize" },
    { side: "nw", class: "-left-1 -top-1 size-4 cursor-nwse-resize" },
  ]
  const size = (side: string) => (dx: number, dy: number, from: Box) => {
    const h = from.h ?? least().h
    const w = side.includes("e") ? from.w + dx : side.includes("w") ? from.w - dx : from.w
    const tall = side.includes("s") ? h + dy : side.includes("n") ? h - dy : h
    const width = Math.max(least().w, w)
    const height = Math.max(least().h, tall)
    return {
      w: width,
      h: height,
      x: side.includes("w") ? from.x + from.w - width : from.x,
      y: side.includes("n") ? from.y + h - height : from.y,
    }
  }

  return (
    <Portal>
      <div class="fixed inset-0" style={{ "z-index": stack.z }} onClick={() => props.onClose()} />
      <div
        ref={el}
        data-component="p1-pop"
        class="fixed flex flex-col rounded-xl"
        style={{
          "z-index": stack.z + 1,
          left: `${box.x}px`,
          top: `${box.y}px`,
          width: `${box.w}px`,
          height: box.h === undefined ? undefined : `${box.h}px`,
          "max-height": `calc(100vh - ${gap * 2}px)`,
          border: "1px solid var(--border-strong-base)",
          background: "var(--surface-raised-stronger-non-alpha)",
          "box-shadow": "var(--shadow-lg-border-base), 0 24px 64px rgb(0 0 0 / 0.5), 0 4px 16px rgb(0 0 0 / 0.3)",
        }}
        onPointerDown={(event) => {
          const target = event.target as HTMLElement
          if (!target.closest("[data-drag]")) return
          if (target.closest("button, input, select, textarea, a, [contenteditable='true']")) return
          track(event, (dx, dy, from) => ({ ...from, h: box.h, x: from.x + dx, y: from.y + dy }))
        }}
      >
        <div class="flex-1 min-h-0 flex flex-col rounded-xl overflow-hidden">{props.children}</div>
        <For each={edges}>
          {(edge) => (
            <div class={`absolute z-10 ${edge.class}`} onPointerDown={(event) => track(event, size(edge.side))} />
          )}
        </For>
      </div>
    </Portal>
  )
}
