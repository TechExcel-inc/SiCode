import { createStore } from "solid-js/store"

// The server agent that answers messages sent from the Design tab (packages/opencode/src/agent/agent.ts).
export const DESIGN_AGENT = "design"

// What the Design tab has open, shared with the chat beside it.
export const [design, setDesign] = createStore({
  // A doc is open; with none, the Design tab shows its gallery full width and no chat.
  open: false,
  doc: "",
  title: "",
  // The open doc is an image with nothing drawn yet: the chat asks what to draw.
  blank: false,
  // Saves what the user typed but has not saved yet, so the agent reads the latest doc.
  flush: undefined as (() => Promise<void>) | undefined,
  // A doc P1 Work just wrote; Design opens it once the tab is showing.
  pending: "",
})
