import { onCleanup, onMount, type JSX } from "solid-js"
import { DockShell, DockTray } from "./dock-surface"

// How many question or permission prompts are on screen. While any is, <html> carries data-dock-prompt, so every
// other animation stops (dock-surface.css) and the prompt is the one thing that moves.
let open = 0

export function DockPrompt(props: {
  kind: "question" | "permission"
  header: JSX.Element
  children: JSX.Element
  footer: JSX.Element
  ref?: (el: HTMLDivElement) => void
  onKeyDown?: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent>
}) {
  const slot = (name: string) => `${props.kind}-${name}`

  onMount(() => {
    open++
    document.documentElement.dataset.dockPrompt = ""
  })
  onCleanup(() => {
    open = Math.max(0, open - 1)
    if (!open && typeof document !== "undefined") delete document.documentElement.dataset.dockPrompt
  })

  return (
    <div data-component="dock-prompt" data-kind={props.kind} ref={props.ref} onKeyDown={props.onKeyDown}>
      <DockShell data-slot={slot("body")}>
        <div data-slot={slot("header")}>{props.header}</div>
        <div data-slot={slot("content")}>{props.children}</div>
      </DockShell>
      <DockTray data-slot={slot("footer")}>{props.footer}</DockTray>
    </div>
  )
}
