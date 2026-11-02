import { call } from "./api"
import type { Choice } from "./points"

/**
 * P1's saved searches on the requirement list, as P1's web app keeps them: each is a set of field conditions
 * stored on the server, and the list asks for one by id. 0 is none, -10 the user's ad-hoc search, which Search
 * saves the conditions into, and anything above 0 a search saved by name, private or public.
 */
export type Query = { id: number; name: string; open: boolean }

export const none = 0
export const adhoc = -10

/** A field a condition can be set on, with the editor P1 gives its control type. */
export type Field = { id: number; name: string; type: number }
export type Editor = "text" | "number" | "date" | "pick" | "one" | "yes"

/** A condition as it is edited: the field and what was entered for it. */
export type Row = {
  field: Field
  words?: string
  picks?: string[]
  from?: string
  to?: string
  yes?: "yes" | "no" | ""
}

/** The editor P1 uses for a field: its own few system fields first, then by control type. */
export function editor(field: Field): Editor {
  if (field.id === 1106 || field.id === 1110) return "pick"
  if (field.id === 1112) return "text"
  if (field.type === 1 || field.type === 2) return "number"
  if (field.type === 3) return "date"
  if ([4, 7, 8, 33].includes(field.type)) return "pick"
  if (field.type === 9) return "one"
  if (field.type === 14) return "yes"
  return "text"
}

/**
 * The condition P1 stores for a row, or none while the row is still empty, as P1's handleCondition builds it.
 * A single choice is matched by its name, as P1 matches a combobox.
 */
export function condition(row: Row, choices: Choice[] = []) {
  const base = { FieldId: row.field.id, FieldType: row.field.type }
  const kind = editor(row.field)
  if (kind === "text") return row.words?.trim() ? { ...base, Words: row.words.trim(), OnlyEmpty: false } : undefined
  if (kind === "yes") return row.yes ? { ...base, ...(row.yes === "yes" ? { Yes: true } : { No: true }) } : undefined
  if (kind === "pick") return row.picks?.length ? { ...base, ChoiceIds: row.picks, NotInclude: false } : undefined
  if (kind === "one") {
    const name = choices.find((item) => String(item.id) === row.picks?.[0])?.name
    return name ? { ...base, Words: name, NotInclude: false } : undefined
  }
  if (kind === "number") {
    const from = Number(row.from) || 0
    const to = Number(row.to) || 0
    return from || to ? { ...base, OnlyEmpty: false, From: from, To: to } : undefined
  }
  return row.from || row.to
    ? { ...base, From: row.from ?? "", To: row.to ?? "", Mode: 0, AroundDays: 0, OffsetDays: 0 }
    : undefined
}

/** A stored condition back into a row for its field. */
export function row(field: Field, data: Record<string, unknown>, choices: Choice[] = []): Row {
  const kind = editor(field)
  const text = (value: unknown) => (value === undefined || value === null ? "" : String(value))
  if (kind === "yes") return { field, yes: data.Yes ? "yes" : data.No ? "no" : "" }
  if (kind === "pick") return { field, picks: (Array.isArray(data.ChoiceIds) ? data.ChoiceIds : []).map(text) }
  if (kind === "one") {
    const found = choices.find((item) => item.name === text(data.Words))
    return { field, picks: found ? [String(found.id)] : [] }
  }
  if (kind === "number" || kind === "date") {
    const date = (value: unknown) => text(value).slice(0, 10)
    return kind === "date"
      ? { field, from: date(data.From), to: date(data.To) }
      : { field, from: Number(data.From) ? text(data.From) : "", to: Number(data.To) ? text(data.To) : "" }
  }
  return { field, words: text(data.Words) }
}

/** The searches saved for a project, by name, as P1's FindQueryList sends them. */
export function readQueries(data: unknown): Query[] {
  const body = record(data) && record(data.Data) ? data.Data : data
  const list = record(body) && Array.isArray(body.QueryItemList) ? body.QueryItemList : []
  return list
    .filter(record)
    .flatMap((item) => {
      const info = record(item.GeneralInfo) ? item.GeneralInfo : undefined
      const id = Number(info?.QueryId)
      if (!info || !(id > 0)) return []
      return [{ id, name: String(info.Name ?? ""), open: Number(info.QueryType) === 2 }]
    })
    .toSorted((a, b) => a.name.localeCompare(b.name))
}

/** The fields a project's searches can use. */
export function readFields(data: unknown): Field[] {
  const body = record(data) && record(data.Data) ? data.Data : data
  const list = record(body) && Array.isArray(body.FieldList) ? body.FieldList : []
  return list
    .filter(record)
    .map((item) => ({ id: Number(item.FieldID), name: String(item.FieldName ?? ""), type: Number(item.FieldControlType) || 0 }))
    .filter((item) => item.id > 0 && item.name)
}

/** A saved search's formula and conditions. */
export function readQuery(data: unknown) {
  const body = record(data) && record(data.Data) ? data.Data : data
  const info = record(body) && record(body.GeneralInfo) ? body.GeneralInfo : {}
  const list = record(body) && Array.isArray(body.Conditions) ? body.Conditions.filter(record) : []
  return { formula: String(info.Formula ?? ""), conditions: list }
}

export async function queries(base: string, token: string, project: number, locale: string) {
  return readQueries(await call(base, token, `/DevSpecAPI/FindQueryList?ProjectID=${project}`, locale))
}

export async function fields(base: string, token: string, project: number, locale: string) {
  return readFields(await call(base, token, `/DevSpecAPI/FindQuery?ProjectID=${project}`, locale))
}

export async function query(base: string, token: string, project: number, id: number, locale: string) {
  return readQuery(await call(base, token, `/DevSpecAPI/FindQuery?ProjectID=${project}&QueryID=${id}`, locale))
}

/**
 * Saves conditions as a search: into the ad-hoc one (-10), as a new named search (0), or over a saved one.
 * P1 answers with the search's id.
 */
export async function store(
  base: string,
  token: string,
  project: number,
  input: { id: number; name: string; open: boolean; formula: string; conditions: Record<string, unknown>[] },
  locale: string,
) {
  const type = input.id === adhoc ? 0 : input.open ? 2 : 1
  const data = await call(
    base,
    token,
    "/DevSpecAPI/FindQuery",
    locale,
    {
      ProjectId: project,
      IsTraceabilityReportQuery: 0,
      GeneralInfo: {
        QueryId: input.id,
        Name: input.id === adhoc ? "" : input.name,
        QueryType: type,
        Formula: input.formula,
        QueryAccessOption: input.open ? 1 : 0,
        IsTraceabilityReportQuery: 0,
      },
      Conditions: input.conditions,
    },
    "POST",
  )
  const body = record(data) && "Data" in data ? data.Data : data
  return Number(body) || input.id
}

export async function drop(base: string, token: string, project: number, id: number, locale: string) {
  await call(base, token, `/DevSpecAPI/FindQuery?ProjectID=${project}&QueryID=${id}`, locale, undefined, "DELETE")
}

/** Whether the user may save public searches in the project. */
export async function shared(base: string, token: string, project: number, user: string, locale: string) {
  const data = await call(base, token, "/DevSpecAPI/ReqProjectSetting", locale, {
    ProjectID: project,
    OperationType: 17,
    UserID: Number(user) || user,
  })
  const body = record(data) && "Data" in data ? data.Data : data
  return !!body && body !== "0"
}

/** The choices a pick field offers: P1's states, item types or the field's own choice list. */
export async function choices(base: string, token: string, project: number, field: Field, user: string, locale: string) {
  const text = (value: unknown) => (value === undefined || value === null ? "" : String(value))
  if (field.id === 1121) {
    const data = await call(base, token, "/DevSpecAPI/ReqProjectSetting", locale, {
      ProjectID: project,
      OperationType: 1,
      UserID: Number(user) || user,
    })
    const body = record(data) && record(data.Data) ? data.Data : data
    const list = record(body) && Array.isArray(body.ItemTypeList) ? body.ItemTypeList.filter(record) : []
    return list.map((item) => ({ id: Number(item.SpecTypeID), name: text(item.SpecTypeName) })).filter((item) => item.name)
  }
  const data = await call(base, token, `/DevSpecAPI/ReqField?ProjectID=${project}&FieldIDs=${field.id}`, locale)
  const body = record(data) && record(data.Data) ? data.Data : data
  const first = record(body) && Array.isArray(body.FieldList) && record(body.FieldList[0]) ? body.FieldList[0] : {}
  const list = Array.isArray(first.ChoiceList) ? first.ChoiceList.filter(record) : []
  return list
    .map((item) => ({ id: Number(item.ChoiceID), name: text(item.ChoiceName) }))
    .filter((item) => text(item.id) !== "" && Number.isFinite(item.id) && item.name)
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
