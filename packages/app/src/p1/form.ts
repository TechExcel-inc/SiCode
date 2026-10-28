import { call } from "./api"
import { decode64 } from "./doc"

/** The requirement form, read the way P1's edit and new dialogs read it. */

/** A field on a form page. `type` is P1's FieldType: 1 integer, 2 decimal, 3 date, 4/5 text, 6 rich text, 7/9/10 select, 8 multi-select, 14 checkbox. */
export type Field = { id: number; name: string; type: number }
export type Page = { id: number; name: string; fields: Field[] }
/** A field's value as P1 sends it: `value` text or number, `choice` the selected id(s), `html` decoded rich text. */
export type Value = { value: string; choice: string; html: string }
/** A state button: the state it moves to and the transition that does it (0 without transitions). */
export type State = { id: number; name: string; transition: number }
export type Rules = { readonly: number[]; hidden: number[]; required: number[]; locked: boolean }
export type Choice = { id: number; name: string }

/** Fields P1 never lets you type into. */
const fixed = [1103, 1104, 1106, 1107, 1108, 1109, 1110, 1111, 1112, 1144, 1601]
/** Field types the form doesn't edit: comments, static, attachment. */
const skipped = [13, 18, 23]

const SELECT = [7, 9, 10]

export function select(field: Field) {
  return SELECT.includes(field.type) || field.id === 1113 || field.id === 1145
}

export function rich(field: Field) {
  return field.type === 6
}

/** Title and rich text take a whole row; the rest sit two to a row. */
export function wide(field: Field) {
  return field.id === 1101 || rich(field)
}

export function fixedField(id: number) {
  return fixed.includes(id)
}

/** The pages with fields for a spec type, falling back to the default type -1. */
export function readPages(data: unknown, type: number): Page[] {
  const set = record(data) && record(data.GUIPageSet) ? data.GUIPageSet.GUIPages : record(data) ? data.GUIPages : undefined
  const list = (Array.isArray(set) ? set : []).filter(record)
  const found = list.find((item) => item.TypeID === type) ?? list.find((item) => item.TypeID === -1) ?? list[0]
  const pages = found && Array.isArray(found.Pages) ? found.Pages.filter(record) : []
  return pages.flatMap((page) => {
    const fields = (Array.isArray(page.Fields) ? page.Fields : []).filter(record).flatMap((field) => {
      const id = Number(field.DataFieldID ?? field.FieldID)
      const type = Number(field.FieldType)
      if (!id || skipped.includes(type)) return []
      return [{ id, name: String(field.FieldName ?? ""), type }]
    })
    if (!fields.length) return []
    return [{ id: Number(page.PageID), name: String(page.PageName ?? ""), fields }]
  })
}

export function readValues(data: unknown): Record<number, Value> {
  const list = record(data) && Array.isArray(data.Values) ? data.Values.filter(record) : []
  return Object.fromEntries(
    list.map((item) => [
      Number(item.ID),
      {
        value: item.Value === undefined || item.Value === null ? "" : String(item.Value),
        choice: item.ChoiceId === undefined || item.ChoiceId === null ? "" : String(item.ChoiceId),
        html: typeof item.ValueHTML === "string" && item.ValueHTML ? (decode64(item.ValueHTML) ?? "") : "",
      },
    ]),
  )
}

/** State buttons: the transitions out of the current state when the project uses them, otherwise every state. */
export function readStates(data: unknown): State[] {
  if (!record(data)) return []
  const set = record(data.TransitionSet) ? data.TransitionSet.Transition : data.Transition
  const moves = (Array.isArray(set) ? set : []).filter(record)
  if (moves.length)
    return moves.map((item) => ({
      id: Number(item.NextStateID),
      name: String(item.NextStateName ?? item.TransitionName ?? ""),
      transition: Number(item.TransitionID),
    }))
  const list = (Array.isArray(data.StatusList) ? data.StatusList : []).filter(record)
  return list.map((item) => ({ id: Number(item.StateID), name: String(item.StateName ?? ""), transition: 0 }))
}

/** Field rules for the shown pages: the default page (0) plus each page's own. */
export function readRules(data: unknown, pages: number[]): Rules {
  const list = record(data) && Array.isArray(data.Pages) ? data.Pages.filter(record) : []
  const used = list.filter((page) => page.PageID === 0 || pages.includes(Number(page.PageID)))
  const ids = (key: string) => [
    ...new Set(
      used.flatMap((page) =>
        String(page[key] ?? "")
          .split(",")
          .map(Number)
          .filter((id) => id > 0),
      ),
    ),
  ]
  return {
    readonly: ids("ReadonlyIDs"),
    hidden: ids("InvisibleIDs"),
    required: ids("MandatoryIDs"),
    locked: record(data) && Number(data.AllFieldReadonly) === 1,
  }
}

export function readChoices(data: unknown): Record<number, Choice[]> {
  const list = record(data) && Array.isArray(data.FieldList) ? data.FieldList.filter(record) : []
  return Object.fromEntries(
    list.map((field) => [
      Number(field.FieldID),
      (Array.isArray(field.ChoiceList) ? field.ChoiceList : [])
        .filter(record)
        .map((item) => ({ id: Number(item.ChoiceID), name: String(item.ChoiceName ?? "") })),
    ]),
  )
}

export function readOwners(data: unknown): Choice[] {
  const list = record(data) && Array.isArray(data.OwnerList) ? data.OwnerList.filter(record) : []
  return list.map((item) => ({ id: Number(item.UserID), name: String(item.UserName ?? "") }))
}

/** UTF-8 text as base64, the way P1 stores rich text. */
export function encode64(text: string) {
  const bytes = new TextEncoder().encode(text)
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
}

export function plain(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim()
}

/** One changed field in the `Values` list `PUT ReqItem` takes. */
export function entry(field: Field, next: Value) {
  if (rich(field)) return { ID: field.id, ValueHTML: encode64(next.html), Value: encode64(plain(next.html)) }
  if (select(field) || field.type === 8) return { ID: field.id, ChoiceId: field.type === 8 ? next.choice : Number(next.choice) || 0 }
  if (field.type === 1 || field.type === 2) return { ID: field.id, Value: Number(next.value) || 0 }
  return { ID: field.id, Value: next.value }
}

/** The flat body `POST ReqItem` takes for a new requirement. */
export function created(input: {
  project: number
  folder: number
  user: string
  name: string
  state?: State
  owner?: Choice
  fields: Field[]
  values: Record<number, Value>
}) {
  const at = (id: number) => input.values[id] ?? { value: "", choice: "", html: "" }
  const html = at(1102).html
  const month = new Date()
  const body: Record<string, unknown> = {
    ProjectID: input.project,
    FolderID: input.folder,
    IsTemplate: 0,
    TemplateName: "",
    TemplateID: 0,
    SpecType: -1,
    SystemTypeID: 1,
    ParentFeatureID: 0,
    ParentSpecID: 0,
    RefIDs: [],
    RoadmapMonth: `${month.getFullYear()}${String(month.getMonth() + 1).padStart(2, "0")}`,
    "Created by": input.name,
    "Created byID": Number(input.user) || input.user,
    "Assigned by": input.name,
    "Assigned byID": Number(input.user) || input.user,
    Title: at(1101).value,
    1101: at(1101).value,
    Status: input.state?.name ?? "",
    StatusID: input.state?.id ?? 0,
    "Spec Owner": input.owner?.name ?? "",
    "Spec OwnerID": input.owner?.id ?? 0,
    Description: encode64(plain(html)),
    DescriptionHTML: encode64(html),
    Points: Number(at(1131).value) || 0,
  }
  for (const field of input.fields) {
    if ([1101, 1102, 1114, 1113].includes(field.id) || fixedField(field.id)) continue
    const value = input.values[field.id]
    if (!value) continue
    const one = entry(field, value)
    body[field.id] = "ChoiceId" in one ? one.ChoiceId : "ValueHTML" in one ? one.ValueHTML : one.Value
  }
  if (input.state) body[1114] = input.state.id
  if (input.owner) body[1113] = input.owner.id
  return body
}

// What doesn't change while you work: a project's form layout, its new-item states, choice lists and owners.
// Kept per server and project so the second dialog opens without asking again; a failure isn't kept.
const kept = new Map<string, Promise<unknown>>()

function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  const found = kept.get(key)
  if (found) return found as Promise<T>
  const next = run()
  kept.set(key, next)
  next.catch(() => kept.delete(key))
  return next
}

function layout(base: string, token: string, project: number, id: number, locale: string) {
  return once(`${base}|layout|${project}`, () =>
    call(base, token, "/DevSpecAPI/ActionApi/InitProject/GetInitDetailPageProjectData", locale, {
      ProjectID: project,
      ModTypeID: 402,
      IssueId: id,
    }),
  )
}

/** Every field any spec type's pages show, so one read gets them whatever the requirement's type. */
function every(data: unknown) {
  const set = record(data) && record(data.GUIPageSet) ? data.GUIPageSet.GUIPages : undefined
  const types = (Array.isArray(set) ? set : []).filter(record).map((item) => Number(item.TypeID))
  return [...new Set(types.flatMap((type) => readPages(data, type).flatMap((page) => page.fields.map((f) => f.id))))]
}

/** Everything the edit form needs for one requirement, in two rounds of requests. */
export async function load(base: string, token: string, project: number, id: number, user: string, locale: string) {
  const init = await layout(base, token, project, id, locale)
  const data = await call(base, token, "/DevSpecAPI/ReqItemEx", locale, {
    ProjectID: project,
    IssueID: id,
    FieldIDs: [...new Set([1112, 1101, 1102, 1113, 1114, 1131, 1103, ...every(init)])],
    NeedFolderInfo: 0,
    SupportFieldID: 1,
  })
  const pages = readPages(init, record(data) ? Number(data.SpecTypeID ?? -1) : -1)
  const values = readValues(data)
  const state = Number(values[1114]?.choice) || 0
  const folder = record(data) ? Number(data.FolderID) || Number(values[1103]?.choice) || 0 : 0
  const [detail, found, more] = await Promise.all([
    call(base, token, "/DevSpecAPI/ActionApi/InitProject/GetItemDetailValueData", locale, {
      ProjectID: project,
      ModTypeID: 402,
      IssueID: id,
      StateID: state,
      EnableStateTransition: record(init) ? init.EnableStateTransition : 0,
    }),
    rules(base, token, project, id, state, 0, user, pages, locale),
    lists(base, token, project, folder, pages.flatMap((page) => page.fields), locale),
  ])
  return {
    pages,
    values,
    states: readStates(detail),
    access: record(detail) ? Number(detail.ItemAccessControl ?? 4) : 4,
    folder,
    update: record(data) ? Number(data.LastUpdateNo ?? 0) : 0,
    state,
    rules: found,
    ...more,
  }
}

/** The blank form for a new requirement in a folder, in two rounds of requests (one once they're kept). */
export async function blank(base: string, token: string, project: number, folder: number, user: string, locale: string) {
  const [init, moves] = await Promise.all([
    once(`${base}|new|${project}`, () =>
      call(base, token, "/DevSpecAPI/ReqAndKWInitData", locale, { ReqProjectID: project, ReqOperationType: 3, ReqFieldIDs: "" }),
    ),
    once(`${base}|moves|${project}|${folder}`, () =>
      call(base, token, `/DevSpecAPI/ReqTransitionList?ProjectID=${project}&StateID=-10&IssueID=0&FolderID=${folder}`, locale).catch(
        () => undefined,
      ),
    ),
  ])
  const pages = readPages(record(init) ? init.ReqProjectSettingData : undefined, -1)
  const found = readStates(moves)
  const states = found.length
    ? found
    : readStates(
        await once(`${base}|states|${project}`, () =>
          call(base, token, `/DevSpecAPI/ReqStatusList?ProjectID=${project}&SpecialID=-10`, locale),
        ),
      )
  // The transition P1 starts a default-type requirement with, else the first.
  const raw = record(moves) && Array.isArray(moves.Transition) ? moves.Transition.filter(record) : []
  const start = raw.find((item) => Number(item.InitSpecType) === -1)
  const first = states.find((item) => item.transition === Number(start?.TransitionID)) ?? states[0]
  const [ruled, more] = await Promise.all([
    once(`${base}|rules|${project}|${first?.id}|${first?.transition}`, () =>
      rules(base, token, project, 0, first?.id ?? -10, first?.transition ?? 0, user, pages, locale),
    ),
    lists(base, token, project, folder, pages.flatMap((page) => page.fields), locale),
  ])
  return { pages, states, first, rules: ruled, ...more }
}

/** Fetches what the dialogs need for a project ahead of time, so the first one opens quickly. */
export function warm(base: string, token: string, project: number, folder: number, id: number, user: string, locale: string) {
  void layout(base, token, project, id, locale).catch(() => undefined)
  void blank(base, token, project, folder, user, locale).catch(() => undefined)
}

export async function rules(
  base: string,
  token: string,
  project: number,
  id: number,
  state: number,
  transition: number,
  user: string,
  pages: Page[],
  locale: string,
) {
  const data = await call(base, token, "/DevSpecAPI/ReqProjectSetting", locale, {
    ProjectID: project,
    OperationType: 12,
    IssueID: id,
    StateID: state,
    TransitionID: transition,
    UserID: Number(user) || user,
  }).catch(() => undefined)
  return readRules(
    data,
    pages.map((page) => page.id),
  )
}

/** Choice lists for the select fields, and the owners who can take a requirement in this folder. */
export async function lists(base: string, token: string, project: number, folder: number, fields: Field[], locale: string) {
  const ids = fields.filter((field) => (select(field) || field.type === 8) && field.id !== 1113 && field.id !== 1114).map((f) => f.id)
  const [choices, owners] = await Promise.all([
    ids.length
      ? once(`${base}|choices|${project}|${ids.join(",")}`, () =>
          call(base, token, `/DevSpecAPI/ReqField?ProjectID=${project}&FieldIDs=${ids.join(",")}`, locale).then(readChoices),
        ).catch(() => ({}) as Record<number, Choice[]>)
      : Promise.resolve({} as Record<number, Choice[]>),
    once(`${base}|owners|${project}|${folder}`, () =>
      call(base, token, `/DevSpecAPI/ReqApplicableOwnerList?ProjectID=${project}&SubProjectId=${folder}`, locale).then(
        readOwners,
      ),
    ).catch(() => [] as Choice[]),
  ])
  return { choices, owners }
}

export async function update(
  base: string,
  token: string,
  input: { project: number; id: number; folder: number; update: number; values: unknown[] },
  locale: string,
) {
  await call(
    base,
    token,
    "/DevSpecAPI/ReqItem",
    locale,
    {
      ProjectID: input.project,
      ID: input.id,
      FolderID: input.folder,
      SupportFieldID: 1,
      LastUpdateNo: input.update,
      Values: input.values,
    },
    "PUT",
  )
}

/** Creates a requirement and returns its id. */
export async function create(base: string, token: string, body: Record<string, unknown>, locale: string) {
  const data = await call(base, token, "/DevSpecAPI/ReqItem", locale, body)
  return Number(typeof data === "string" ? data.replace(/"/g, "") : data) || 0
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
