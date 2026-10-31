import { call, lang } from "./api"
import { client } from "./http"

/**
 * P1's link to Kloud, read the way P1's web app reads it: the P1 server says which Kloud company it is linked to
 * and where Kloud lives, a P1 sign-in is swapped for a Kloud token, and each P1 attachment finds its Kloud
 * document through a binding id.
 */
export type Kloud = { company: number; api: string; web: string }

/**
 * The Kloud company and hosts from P1's integration info; none when the P1 server isn't linked to Kloud. P1's web
 * config puts its formal Kloud sites (jiaxing, almteam) on company 6708 whatever the server says, and the Kloud user
 * a token belongs to follows the company, so SiCode does the same.
 */
export function readKloud(data: unknown, server = ""): Kloud | undefined {
  const info = record(data) && record(data.Data) ? data.Data : data
  if (!record(info) || !record(info.KloudServer)) return
  const formal = server.includes("jiaxing") || server.includes("almteam")
  const company = formal ? 6708 : Number(info.SubSystemId) || 0
  const api = text(info.KloudServer.SubDomain_PeertimeApi)
  const web = text(info.KloudServer.SubDomain_KloudWeb)
  if (!company || !api || !web) return
  return { company, api: `https://${api}/peertime/V1/`, web: `https://${web}/` }
}

/** The id P1 binds an attachment version to its Kloud document with. */
export function unique(project: number, item: number, file: number, version: number) {
  return `projectOne+${project}+${item}+${file}+${version}`
}

/** Each binding's Kloud document, by binding id. */
export function readLinks(data: unknown): Record<string, number> {
  const list = record(data) && Array.isArray(data.RetData) ? data.RetData.filter(record) : []
  return Object.fromEntries(
    list
      .filter((item) => Number(item.AttachmentID) > 0)
      .map((item) => [text(item.UniqueID), Number(item.AttachmentID)]),
  )
}

/**
 * LiveDoc's viewer on the lesson Kloud made for a document, signed in with a viewer token, as P1's Edit LiveDoc
 * opens it. LiveDoc's `attachment/{id}` page would make that lesson itself and then switch to this page, showing the
 * viewer twice.
 */
export function viewer(kloud: Kloud, token: string, lesson: number, id: number, title: string, locale: string) {
  return `${kloud.web}docview/${lesson}?languageid=${lang(locale)}&title=${encodeURIComponent(title)}&needClearSessionStorage=1&Type=${id}&token=${encodeURIComponent(token)}`
}

/** A blank LiveDoc page, opened out of sight once so LiveDoc's scripts are already loaded when a document opens. */
export function warm(kloud: Kloud) {
  return `${kloud.web}blank/page`
}

const kept = new Map<string, { at: number; value: Promise<unknown> }>()
// Kloud info and tokens are asked for again after ten minutes, or at once after a failure.
function once<T>(key: string, run: () => Promise<T>) {
  const hit = kept.get(key)
  if (hit && Date.now() - hit.at < 600_000) return hit.value as Promise<T>
  const value = run()
  kept.set(key, { at: Date.now(), value })
  value.catch(() => kept.delete(key))
  return value
}

export function kloud(base: string, token: string, locale: string) {
  return once(`${base}|kloud`, async () =>
    readKloud(await call(base, token, "/DevTrackApi/api/integration/IntegrationInfoWithPeertime", locale), base),
  )
}

/**
 * Swaps the P1 sign-in for a Kloud token, as P1 does: a viewer token (temp) signs LiveDoc's viewer in once, and a
 * lasting one (`getKloudPermanentToken`) signs Kloud's own API calls.
 */
async function exchange(found: Kloud, p1: string, user: string, temp: boolean) {
  const data = await send(found, p1, "P1Integration/ExchangeToken", {
    P1Token: p1,
    UniqueID: `${found.company}-${user}`,
    Phone: "",
    Email: "",
    LoginName: "",
    IsTempToken: temp ? 1 : 0,
  })
  const value = record(data) ? text(data.RetData) : ""
  if (!value) throw new Error("Kloud did not give a token")
  return value
}

/** The lasting Kloud token, kept for ten minutes. */
export function lasting(found: Kloud, p1: string, user: string, fresh = false) {
  const key = `${found.api}|lasting|${found.company}|${user}|${p1}`
  if (fresh) kept.delete(key)
  return once(key, () => exchange(found, p1, user, false))
}

// One unused viewer token is kept ready, so a document opens without waiting for one. Each open takes it and the next
// is fetched at once; one kept over three minutes is swapped for a new one before it can go stale.
const spare = new Map<string, { at: number; value: Promise<string> }>()
const slot = (found: Kloud, p1: string, user: string) => `${found.api}|viewer|${found.company}|${user}|${p1}`

export function prepare(found: Kloud, p1: string, user: string) {
  const name = slot(found, p1, user)
  const hit = spare.get(name)
  if (hit && Date.now() - hit.at < 180_000) return
  const value = exchange(found, p1, user, true)
  spare.set(name, { at: Date.now(), value })
  value.catch(() => {
    if (spare.get(name)?.value === value) spare.delete(name)
  })
}

export function take(found: Kloud, p1: string, user: string) {
  prepare(found, p1, user)
  const name = slot(found, p1, user)
  const value = spare.get(name)!.value
  spare.delete(name)
  prepare(found, p1, user)
  return value
}

/** Kloud's temporary lesson on a document, which LiveDoc's viewer opens on, made as P1's Edit LiveDoc makes it. */
export async function lesson(found: Kloud, token: string, id: number, title: string) {
  const name = btoa(String.fromCharCode(...new TextEncoder().encode(title)))
  const data = await send(
    found,
    token,
    `Lesson/AddTempLessonWithOriginalDocument?attachmentID=${id}&Title=${encodeURIComponent(name)}`,
    {},
    false,
  )
  const item = record(data) && Number(data.RetCode) === 0 && record(data.RetData) ? Number(data.RetData.ItemID) : 0
  if (!item) throw new Error(record(data) ? text(data.ErrorMessage) || "Kloud did not open the document" : "")
  return item
}

export async function links(found: Kloud, p1: string, ids: string[]) {
  if (!ids.length) return {}
  return readLinks(
    await send(found, p1, `P1Integration/LinkedAttachmentInfo?uniqueIDs=${encodeURIComponent(ids.join(","))}`),
  )
}

// Kloud's P1 calls carry the P1 token, as P1's request layer adds it; Kloud's own calls carry a Kloud token alone.
async function send(found: Kloud, token: string, path: string, body?: unknown, bearer = true) {
  const res = await client()(`${found.api}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      UserToken: token,
      ...(bearer ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = (await res.json().catch(() => undefined)) as unknown
  if (!res.ok)
    throw new Error(record(data) ? text(data.ErrorMessage ?? data.Message) || res.statusText : res.statusText)
  if (record(data) && Number(data.RetCode) < 0)
    throw new Error(text(data.ErrorMessage) || `Kloud error ${data.RetCode}`)
  return data
}

const text = (value: unknown) => (value === undefined || value === null ? "" : String(value))

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
