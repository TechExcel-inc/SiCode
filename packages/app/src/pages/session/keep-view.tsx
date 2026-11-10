import { createContext, createEffect, createSignal, on, onCleanup, Show, useContext, type ParentProps } from "solid-js"
import { useLayout } from "@/context/layout"

// A view left alone this long is put away, to give its memory back; the next visit reads it again.
const IDLE = 30 * 60_000

const Shown = createContext<() => boolean>(() => true)

/** Whether the view around this code is the one showing, so it can pause its timers and clear the top bar when not. */
export const useViewShown = () => useContext(Shown)

/**
 * Keeps a rail view loaded after the user leaves it, so coming back is instant and finds it as it was: filters, scroll
 * and open panels. It first loads on its first visit.
 */
export function KeepView(props: ParentProps<{ nav: string }>) {
  const layout = useLayout()
  const shown = () => layout.nav.current() === props.nav
  const [live, setLive] = createSignal(shown())
  let timer: ReturnType<typeof setTimeout> | undefined
  createEffect(
    on(shown, (now, before) => {
      if (timer) clearTimeout(timer)
      if (!now) {
        timer = setTimeout(() => setLive(false), IDLE)
        return
      }
      setLive(true)
      // A hidden view can't measure itself, so anything sized to it fits itself again now.
      if (before === false) requestAnimationFrame(() => window.dispatchEvent(new Event("resize")))
    }),
  )
  onCleanup(() => {
    if (timer) clearTimeout(timer)
  })
  return (
    <Show when={live()}>
      <div data-view={props.nav} classList={{ contents: shown(), hidden: !shown() }}>
        <Shown.Provider value={shown}>{props.children}</Shown.Provider>
      </div>
    </Show>
  )
}
