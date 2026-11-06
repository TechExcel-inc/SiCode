import { createSignal } from "solid-js"

/**
 * Whether EAD Pilot is showing a view that wants the whole window (the PFM mind map). The Pilot panel then covers
 * the window, and the layout lifts the containment and stacking that would otherwise keep it inside the page.
 */
export const [full, setFull] = createSignal(false)
