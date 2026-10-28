import type { MessageV2 } from "./message-v2"

/**
 * The EAD Pilot tools (the app's "eadpfm" MCP server: PFM map, EADs, tasks, jobs, test cases) are 42
 * tools, about 8k tokens of descriptions, and every model call would carry them. Most sessions are
 * ordinary coding and never use them (5 uses in 22 sessions in the week to 2026-10-25), so a session
 * gets them only when it works on EAD: the EAD panel's node context is on a message, a request names
 * EAD things, or the agent asked for them with the small loader tool.
 */
export namespace EadTools {
  export const SERVER = "eadpfm"
  export const LOADER = "ead_tools"
  export const DESCRIPTION =
    "Loads the EAD Pilot tools into this session: the PFM map and nodes, EADs, tasks, jobs, test cases and workflow context. Call it before any EAD Pilot work; the tools can be used from your next step."
  export const LOADED = "The EAD Pilot tools are loaded. They can be used from your next step."

  const WORDS = /eadpfm|pfm[ -]?(node|map)|ead[ -]?script|<pfm-node-context>/i

  /** True for a tool of the EAD Pilot MCP server, named "eadpfm_<tool>". */
  export function owns(key: string) {
    return key.startsWith(SERVER + "_")
  }

  /** True when this session works on EAD, so the EAD Pilot tools go with every call. */
  export function wanted(messages: MessageV2.WithParts[]) {
    return messages.some(
      (msg) =>
        (msg.info.role === "user" && WORDS.test(msg.info.system ?? "")) ||
        msg.parts.some(
          (part) =>
            (part.type === "tool" && (part.tool === LOADER || owns(part.tool))) ||
            (msg.info.role === "user" && part.type === "text" && !part.synthetic && WORDS.test(part.text)),
        ),
    )
  }
}
