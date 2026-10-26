import { createStore } from "solid-js/store"

// The server agent that answers messages sent from the Design tab (packages/opencode/src/agent/agent.ts).
export const DESIGN_AGENT = "design"

// What the Design tab has open, shared with the chat beside it.
export const [design, setDesign] = createStore({
  doc: "",
  title: "",
  // Saves what the user typed but has not saved yet, so the agent reads the latest doc.
  flush: undefined as (() => Promise<void>) | undefined,
})
