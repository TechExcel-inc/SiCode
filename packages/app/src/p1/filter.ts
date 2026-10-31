import type { Choice } from "./points"

/**
 * What the requirement list shows, as P1's filter keeps it. P1 filters and groups on the server:
 * the list request carries who owns or made a requirement, its states, its module owners and the grouping.
 */
export type Filter = {
  owners: number[]
  // Owners match who submitted a requirement instead of who owns it.
  submitter: boolean
  states: number[]
  modules: number[]
  // The field the list is grouped by: 0 for none, 1113 spec owner, 1604 module owner.
  group: number
  unlinked: boolean
  untested: boolean
}

export const blank: Filter = {
  owners: [],
  submitter: false,
  states: [],
  modules: [],
  group: 0,
  unlinked: false,
  untested: false,
}

export type Status = Choice & { closed: boolean }

/** Whether the filter narrows the list, for marking its button; the grouping marks its own. */
export function active(filter: Filter) {
  return !!(
    filter.owners.length ||
    filter.states.length ||
    filter.modules.length ||
    filter.unlinked ||
    filter.untested
  )
}

/**
 * The list request's filter fields. An empty condition makes P1 refuse some lists (grouping a whole space by
 * owner), yet grouping by module owner only works with one, so it goes empty only then.
 */
export function condition(filter: Filter) {
  const cond: Record<string, number[]> = {
    ...(filter.owners.length ? { [filter.submitter ? "CreatedByIDs" : "OwnerIDs"]: filter.owners } : {}),
    ...(filter.states.length ? { StateIDs: filter.states } : {}),
  }
  return {
    ...(Object.keys(cond).length || filter.group === 1604 ? { Condition: cond } : {}),
    ...(filter.modules.length ? { ModuleOwnerIDs: filter.modules } : {}),
    ...(filter.group ? { GroupByID: filter.group, SubGroupByID: 0 } : {}),
    ...(filter.unlinked ? { withoutReqLink: 1 } : {}),
    ...(filter.untested ? { WithoutTestTempLink: 1 } : {}),
  }
}

/** The people a requirement can be owned or submitted by; P1's "{All Members}" is no filter at all. */
export function readOwners(data: unknown): Choice[] {
  return list(data, "OwnerList")
    .map((row) => ({ id: Number(row.UserID), name: String(row.UserName ?? "") }))
    .filter((item) => Number.isFinite(item.id) && item.id !== -2 && item.name)
}

export function readStates(data: unknown): Status[] {
  return list(data, "StatusList")
    .map((row) => ({ id: Number(row.StateID), name: String(row.StateName ?? ""), closed: Number(row.IsClosed) === 1 }))
    .filter((item) => Number.isFinite(item.id) && item.name)
}

/** Picked states with P1's "{Open only}" and "{Closed only}" turned into the states they stand for. */
export function expand(ids: number[], states: Status[]) {
  const all = ids.flatMap((id) => {
    if (id === open) return states.filter((item) => !item.closed).map((item) => item.id)
    if (id === closed) return states.filter((item) => item.closed).map((item) => item.id)
    return [id]
  })
  return [...new Set(all)]
}

export const open = -100
export const closed = -101

function list(data: unknown, key: string) {
  const body = record(data) && record(data.Data) ? data.Data : data
  const rows = record(body) ? body[key] : body
  return (Array.isArray(rows) ? rows : []).filter(record)
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

/**
 * The weeks of a roadmap month ("202610") as P1 counts them: the 1st runs from the 1st to the first Sunday,
 * and each Monday starts the next. Dates are "MM/DD".
 */
export function weeks(month: string) {
  const year = Number(month.slice(0, 4))
  const index = Number(month.slice(4)) - 1
  const last = new Date(year, index + 1, 0).getDate()
  const starts = Array.from({ length: last }, (_, day) => day + 1).filter(
    (day) => day === 1 || new Date(year, index, day).getDay() === 1,
  )
  const date = (day: number) => `${String(index + 1).padStart(2, "0")}/${String(day).padStart(2, "0")}`
  return starts.map((day, at) => ({ from: date(day), to: date((starts[at + 1] ?? last + 1) - 1) }))
}

/**
 * What a weekly committed work group stands for. P1 buckets the month's work by priority order:
 * 0–9 is still to be committed, 10–19 the 1st week through 50–59 the 5th, and Others later months.
 */
export function bucket(name: string, month: string) {
  if (/(^|\D)0 - 9\b/.test(name)) return { kind: "commit" as const }
  if (/Others|其他/.test(name)) return { kind: "later" as const }
  const found = name.match(/([1-5])0 - \d9/)
  if (!found) return
  const index = Number(found[1]) - 1
  const week = weeks(month)[index]
  return { kind: "week" as const, index, from: week?.from ?? "", to: week?.to ?? "" }
}

/** The roadmap month a folder's weekly work is counted in: this month, kept within the folder's months. */
export function month(months: { start: string; end: string }, now = new Date()) {
  const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`
  if (months.end < today) return months.end
  if (months.start > today) return months.start
  return today
}
