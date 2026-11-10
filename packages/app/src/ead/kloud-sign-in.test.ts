import { describe, expect, test } from "bun:test"
import { applyEnv, eadApi } from "./urls"
import { eadFromKloud, kloudLogin, KLOUD_API } from "./kloud-sign-in"

describe("SiCode signs in with the Kloud master account", () => {
  test("Kloud login sends the account the way Kloud's web app does and returns the Kloud login", async () => {
    let seen = ""
    const http = (async (url: string) => {
      seen = url
      return new Response("﻿" + JSON.stringify({ RetCode: 0, RetData: { UserToken: "kloud-token" } }))
    }) as typeof fetch
    expect(await kloudLogin(" pat@example.com ", "pässword", http)).toBe("kloud-token")
    const url = new URL(seen)
    expect(`${url.origin}${url.pathname}`).toBe(`${KLOUD_API}/Login`)
    expect(url.searchParams.get("login")).toBe("pat@example.com")
    expect(url.searchParams.get("encryptOption")).toBe("1")
    // base64 of the UTF-8 bytes
    expect(atob(url.searchParams.get("password")!)).toBe(String.fromCharCode(...new TextEncoder().encode("pässword")))
  })

  test("Kloud login always sends a body, so the desktop app's request has a Content-Length", async () => {
    let init: RequestInit | undefined
    const http = (async (_url: string, next?: RequestInit) => {
      init = next
      return new Response(JSON.stringify({ RetCode: 0, RetData: { UserToken: "kloud-token" } }))
    }) as typeof fetch
    await kloudLogin("pat", "secret", http)
    expect(init?.method).toBe("POST")
    expect(init?.body).toBe("{}")
  })

  test("a wrong password shows Kloud's own message", async () => {
    const http = (async (_url: string) =>
      new Response(JSON.stringify({ RetCode: -2003, ErrorMessage: "Invalid user name or password." }))) as typeof fetch
    await expect(kloudLogin("pat", "nope", http)).rejects.toThrow("Invalid user name or password.")
  })

  test("EAD Pilot signs on through the Kloud login, told it is SiCode", async () => {
    applyEnv("production")
    let call: { url: string; client?: string; body?: string } = { url: "" }
    const http = (async (url: string, init?: RequestInit) => {
      call = { url, client: (init?.headers as Record<string, string>)["X-EAD-Client"], body: String(init?.body) }
      return new Response(JSON.stringify({ success: true, token: "ead-token" }))
    }) as typeof fetch
    expect(await eadFromKloud("kloud-token", http)).toBe("ead-token")
    expect(call).toEqual({ url: `${eadApi()}/auth/kloud`, client: "sicode", body: JSON.stringify({ kloudToken: "kloud-token" }) })
  })

  test("EAD Pilot's reason comes through when it can't sign the person on", async () => {
    applyEnv("production")
    const http = (async (_url: string) =>
      new Response(
        JSON.stringify({ success: false, code: 403, message: "Verify your email or phone in your Kloud account, then sign in again." }),
      )) as typeof fetch
    await expect(eadFromKloud("kloud-token", http)).rejects.toThrow("Verify your email or phone")
  })
})
