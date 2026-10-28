import { describe, expect, test } from "bun:test"
import { EadTools } from "../../src/session/ead-tools"
import type { MessageV2 } from "../../src/session/message-v2"

const user = (text: string, system?: string) =>
  ({
    info: { id: "msg_u", role: "user", sessionID: "ses_1", system },
    parts: [{ id: "prt_u", type: "text", text, messageID: "msg_u", sessionID: "ses_1" }],
  }) as unknown as MessageV2.WithParts

const called = (name: string) =>
  ({
    info: { id: "msg_a", role: "assistant", sessionID: "ses_1" },
    parts: [{ id: "prt_a", type: "tool", tool: name, callID: "c1", messageID: "msg_a", sessionID: "ses_1", state: { status: "completed" } }],
  }) as unknown as MessageV2.WithParts

describe("EAD Pilot tools", () => {
  test("ordinary coding sessions go without them", () => {
    expect(EadTools.wanted([user("Add a fit-width toggle to the recording player")])).toBe(false)
    expect(EadTools.wanted([user("Deploy KloudMeet"), called("bash")])).toBe(false)
  })

  test("a message with the EAD panel's node context gets them", () => {
    const node = "<pfm-node-context>\nYou are currently working on the PFM node: Team Group\n</pfm-node-context>"
    expect(EadTools.wanted([user("Build this page", node)])).toBe(true)
  })

  test("a request that names EAD things gets them", () => {
    expect(EadTools.wanted([user("Update the PFM map for the login page")])).toBe(true)
    expect(EadTools.wanted([user("use eadpfm_list_jobs to see what is left")])).toBe(true)
  })

  test("once loaded or used, they stay for the session", () => {
    expect(EadTools.wanted([user("next step"), called(EadTools.LOADER)])).toBe(true)
    expect(EadTools.wanted([user("next step"), called("eadpfm_eadpfm_get_pfm_map")])).toBe(true)
  })

  test("only the EAD server's tools are held back", () => {
    expect(EadTools.owns("eadpfm_eadpfm_get_pfm_map")).toBe(true)
    expect(EadTools.owns("playwright_browser_click")).toBe(false)
  })
})
