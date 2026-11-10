import { eadApi } from "./urls"

type Http = typeof fetch

/**
 * SiCode signs in with the Kloud master account. Kloud handles its subsystems, so a SiCode session is the
 * parent Kloud user's session: EAD Pilot (and later P1) sign on through it, and there is one Sign out.
 *
 * 1. Kloud checks the account and returns a Kloud login.
 * 2. EAD Pilot's server trades that login for an EAD Pilot session (POST /auth/kloud): Kloud confirms who it
 *    is, adds them to Kloud's SiCode subsystem and gives EAD Pilot only their verified email and phone.
 */

/** Kloud's PeerTime API, where Kloud accounts sign in. */
export const KLOUD_API = "https://api.peertime.cn/peertime/V1"

/** Kloud's web app: account sign-up and password reset live there now that accounts are Kloud's. */
export const KLOUD_WEB = "https://kloud.cn"

/** Tells EAD Pilot the sign-in comes from SiCode, so it uses Kloud's SiCode subsystem. */
const CLIENT_HEADER = { "X-EAD-Client": "sicode" }

const KLOUD_TOKEN_KEY = "sicode.kloud.token"

type KloudLoginResult = { RetCode?: number; ErrorMessage?: string; RetData?: { UserToken?: string } | null }
type EadAuthResult = { success?: boolean; token?: string; message?: string }

/** Kloud's API answers base64 the way its web app sends it (encryptOption=1). */
function base64(value: string) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(value)))
}

async function json<T>(res: Response): Promise<T> {
  // Kloud's .NET API starts its JSON with a byte order mark.
  const text = (await res.text()).replace(/^﻿/, "")
  return (text ? JSON.parse(text) : {}) as T
}

/** Signs in to Kloud with the Kloud account (email, phone or login name) and returns the Kloud login. */
export async function kloudLogin(identifier: string, password: string, http: Http, api = KLOUD_API) {
  const query = new URLSearchParams({
    login: identifier.trim(),
    password: base64(password),
    encryptOption: "1",
    DeviceType: "1",
    DeviceName: base64("EAD SiCode"),
  })
  // The account goes in the query. The body is only there so the request carries a Content-Length: the
  // desktop app's HTTP client sends none for a POST without a body, and Kloud's server then answers 411.
  const res = await http(`${api}/Login?${query.toString()}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: "{}",
  }).catch((err) => {
    throw new Error(err instanceof Error ? err.message : "Load failed")
  })
  const data = await json<KloudLoginResult>(res).catch(() => ({}) as KloudLoginResult)
  const token = data.RetData?.UserToken
  if (!res.ok || data.RetCode !== 0 || !token) {
    throw new Error(data.ErrorMessage || `Kloud sign-in failed (HTTP ${res.status})`)
  }
  return token
}

/** Trades a Kloud login for an EAD Pilot session (single sign-on). */
export async function eadFromKloud(kloudToken: string, http: Http) {
  const res = await http(`${eadApi()}/auth/kloud`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...CLIENT_HEADER },
    body: JSON.stringify({ kloudToken }),
  }).catch((err) => {
    throw new Error(err instanceof Error ? err.message : "Load failed")
  })
  const data = await json<EadAuthResult>(res).catch(() => ({}) as EadAuthResult)
  if (!res.ok || !data.success || !data.token) {
    throw new Error(data.message || `EAD Pilot sign-in failed (HTTP ${res.status})`)
  }
  return data.token
}

/** Signs in to SiCode: Kloud first, then EAD Pilot through it. Keeps the Kloud login for later single sign-on. */
export async function signInWithKloud(identifier: string, password: string, http: Http) {
  const kloudToken = await kloudLogin(identifier, password, http)
  const eadToken = await eadFromKloud(kloudToken, http)
  saveKloudToken(kloudToken)
  return { kloudToken, eadToken }
}

export function saveKloudToken(token: string) {
  try {
    localStorage.setItem(KLOUD_TOKEN_KEY, token)
  } catch {
    // Storage blocked: the Kloud login lasts for this window only.
  }
}

export function kloudToken(): string | undefined {
  try {
    return localStorage.getItem(KLOUD_TOKEN_KEY) ?? undefined
  } catch {
    return undefined
  }
}

/** Part of SiCode's one Sign out. */
export function clearKloudToken() {
  try {
    localStorage.removeItem(KLOUD_TOKEN_KEY)
  } catch {
    // nothing to clear
  }
}
