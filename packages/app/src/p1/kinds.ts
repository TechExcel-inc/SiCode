import { call } from "./api"
import type { Home } from "./points"

/**
 * A story's type, matching P1's implementation module types, so specs, stories, tasks and points can be grouped
 * by the kind of work. P1 saves it on the story as `StoryType`.
 */
export const kinds = [
  { id: 1, key: "development" },
  { id: 2, key: "design" },
  { id: 3, key: "test" },
  { id: 4, key: "management" },
  { id: 5, key: "others" },
] as const

export type Kind = (typeof kinds)[number]["key"]

/** The type's key for a stored value, or none when it isn't one of the five. */
export function kind(value: unknown) {
  return kinds.find((item) => item.id === Number(value))?.key
}

// P1 keeps which kind of non-development work a module is in this system setting's note, until its API has a field.
const setting = 80300

/**
 * Each module's type by module id: Development when P1 marks it as a development module, otherwise the type kept
 * in system setting 80300. Modules whose type is unknown are left out.
 */
export async function types(base: string, token: string, home: Home, locale: string) {
  if (!home.dev) return {} as Record<number, number>
  const [mods, kept] = await Promise.all([
    call(base, token, `/DevTrackApi/api/Methodology/ImplementationModules?ProjectId=${home.dev.project}`, locale),
    call(base, token, "/DevTrackApi/api/Admin/GetSystemSettingValue", locale, { settingId: setting }).catch(
      () => undefined,
    ),
  ])
  return read(mods, kept)
}

export function read(mods: unknown, kept: unknown) {
  const map = note(kept)
  return Object.fromEntries(
    rows(mods).flatMap((row) => {
      const id = Number(row.ModuleID) || 0
      const flag = row.IfNonDevModule
      const type = flag === false || flag === 0 || flag === "0" ? 1 : kind(map[id]) ? Number(map[id]) : 0
      return id && type ? [[id, type]] : []
    }),
  ) as Record<number, number>
}

/** The type most of a story's modules have, the first module's on a tie, or none while none is known. */
export function guess(ids: number[], map: Record<number, number>) {
  const known = ids.map((id) => map[id]).filter(Boolean)
  const count = (type: number) => known.filter((item) => item === type).length
  return known.reduce((best, type) => (count(type) > count(best) ? type : best), known[0] ?? 0)
}

function note(data: unknown): Record<string, unknown> {
  const body = record(data) && "Data" in data ? data.Data : data
  const text = record(body) ? String(body.SettingNote ?? "") : ""
  const parsed = (() => {
    if (!text) return undefined
    try {
      return JSON.parse(text) as unknown
    } catch {
      return undefined
    }
  })()
  return record(parsed) && record(parsed.implementationModuleTypes) ? parsed.implementationModuleTypes : {}
}

function rows(data: unknown): Record<string, unknown>[] {
  const body = record(data) && "Data" in data ? data.Data : data
  return (Array.isArray(body) ? body : []).filter(record)
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
