import { KLOUD_API } from "@/ead/kloud-sign-in"

type Http = typeof fetch

/** Kloud's meeting server, where each company's subsystems (its P1 integrations among them) are listed. */
export const KLOUD_MEET = "https://wss.peertime.cn/MeetingServer"

/** Kloud's code for a P1 (ProjectOne) integration subsystem. */
const P1_INTEGRATION = 1

/** Most companies one person belongs to that are asked about. */
const MAX_COMPANIES = 40

/** A P1 server one of the person's Kloud companies is integrated with. */
export type P1Server = { url: string; name: string; company: string }

type Record_ = Record<string, unknown>
const record = (v: unknown): v is Record_ => typeof v === "object" && v !== null
const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v).trim() : "")

async function body(res: Response) {
  // Kloud's .NET API starts its JSON with a byte order mark.
  const raw = (await res.text()).replace(/^﻿/, "")
  return raw ? (JSON.parse(raw) as unknown) : undefined
}

/** A P1 server address as P1 sign-in expects it: scheme and host (and port), no trailing slash. */
export function normalizeServer(url: string) {
  const value = url.trim().replace(/\/+$/, "")
  if (!value) return ""
  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}

/** The P1 servers in a company's subsystem list (Kloud's subsystem/subsysmtem_list). */
export function readP1Servers(data: unknown, company: string): P1Server[] {
  const list = record(data) && Array.isArray(data.data) ? data.data : []
  return list
    .filter(record)
    .filter((item) => Number(item.type) === P1_INTEGRATION && text(item.apiUrl))
    .map((item) => ({ url: normalizeServer(text(item.apiUrl)), name: text(item.subSystemName) || "P1", company }))
}

/** Each server once, in the order first seen. */
export function uniqueServers(list: P1Server[]) {
  const seen = new Set<string>()
  return list.filter((item) => {
    const key = item.url.toLowerCase()
    if (!item.url || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * The P1 servers the person's Kloud companies are integrated with: Kloud predefines each P1 integration as a
 * subsystem of a company, so P1 Work can offer them instead of asking for a server address. Empty when there is
 * no Kloud login or Kloud can't be reached.
 */
export async function kloudP1Servers(kloudToken: string | undefined, http: Http, api = KLOUD_API, meet = KLOUD_MEET) {
  if (!kloudToken) return [] as P1Server[]
  const headers = { Accept: "application/json", UserToken: kloudToken }
  try {
    const profile = await body(await http(`${api}/User/UserProfile`, { headers }))
    const userId = record(profile) && record(profile.RetData) ? text(profile.RetData.UserID) : ""
    if (!userId || userId === "0") return []
    const schools = await body(await http(`${api}/School/UserSchoolList?userID=${encodeURIComponent(userId)}`, { headers }))
    const companies = (record(schools) && Array.isArray(schools.RetData) ? schools.RetData : [])
      .filter(record)
      .map((item) => ({ id: text(item.SchoolID), name: text(item.SchoolName) }))
      .filter((item) => item.id && item.id !== "0")
      .slice(0, MAX_COMPANIES)
    const lists = await Promise.all(
      companies.map((company) =>
        http(`${meet}/subsystem/subsysmtem_list?companyId=${encodeURIComponent(company.id)}`, { headers })
          .then(body)
          .then((data) => readP1Servers(data, company.name))
          .catch(() => [] as P1Server[]),
      ),
    )
    return uniqueServers(lists.flat())
  } catch {
    return []
  }
}
