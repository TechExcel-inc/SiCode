import { createSignal } from "solid-js"

// The layout owns project switching (it restores the last session); the title bar menu calls into it.
// `current` is the current project's folder, which stays put while a related project's session is on screen.
const [actions, setActions] = createSignal<{
  go: (directory: string) => void
  choose: () => void
  /** Opens Edit project (name, icon, run commands) for the current project. */
  edit: () => void
  current: () => string | undefined
}>()

export const projectActions = actions
export const setProjectActions = setActions
