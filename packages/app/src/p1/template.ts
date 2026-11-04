import { call } from "./api"
import { encode64, layouts, readValues, type Choice, type Field, type Page, type State } from "./form"

/**
 * P1's New Template dialog for a test case, opened from a spec's All Links: the tabs P1's admin picked for new test
 * cases, laid out as designed, the state buttons, the fields each state makes required, read-only or hidden, and a
 * submit that creates the test case under the spec and links it.
 */

export type Rules = { required: number[]; readonly: number[]; hidden: number[] }
export type Values = Record<number, string>

/** Fields P1 draws with its own controls; the rest follow their type. */
export const fields = {
  state: 1008,
  owner: 1010,
  setup: 1014,
  test: 1015,
  title: 1101,
  text: 1102,
  expected: 1106,
  parent: 1166,
  feature: [1167, 1168, 1169, 1174, 1175],
}
// Environment variables: a tab of P1's own that new test cases can carry.
export const env = 106

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)
const text = (value: unknown) => (value === undefined || value === null ? "" : String(value))
const unwrap = (data: unknown) => (record(data) && "Data" in data && data.Data !== undefined ? data.Data : data)
const list = (data: unknown, key?: string) => {
  const found = key && record(data) ? data[key] : data
  return (Array.isArray(found) ? found : []).filter(record)
}
const ids = (value: unknown) =>
  text(value)
    .split(",")
    .map((item) => Number(item.split("-").at(-1)))
    .filter((id) => id > 0)

/** Rich text fields: P1's type 6, plus the description and expected result. */
export function rich(field: Field) {
  return field.type === 6 || field.id === fields.text || field.id === fields.expected
}

/** Choice fields: P1's select types. */
export function select(field: Field) {
  return [7, 8, 9, 10].includes(field.type)
}

/**
 * The tabs for a new test case: `TestTemplatePage`'s function 1 names them in order, each found among the GUI pages
 * with its fields; the environment variable tab has no fields but is P1's own. Field names come from the template's
 * field list when a page leaves them out.
 */
export function readPages(data: unknown): Page[] {
  const body = unwrap(data)
  const page = record(body) && record(body.TestTemplatePage) ? body.TestTemplatePage : {}
  const named = new Map(
    list(record(body) ? body.TestTemplateField : undefined).map((item) => [
      Number(item.id ?? item.FieldID),
      { name: text(item.name ?? item.FieldName), type: Number(item.type ?? item.FieldType) || 0 },
    ]),
  )
  const all = list(page, "GUIPages").flatMap((group) => list(group, "Pages"))
  const order = text(list(page, "GUIFunctionPages").find((item) => Number(item.FunctionID) === 1)?.FunctionPage)
    .split(",")
    .map(Number)
    .filter((id) => id)
  const chosen = order.length ? order : all.filter((item) => list(item, "Fields").length).map((item) => Number(item.PageID))
  return [...new Set(chosen)].flatMap((id) => {
    const found = all.find((item) => Number(item.PageID) === id && (list(item, "Fields").length || id === env))
    if (!found) return []
    return [
      {
        id,
        name: text(found.PageName),
        parent: id,
        fields: list(found, "Fields").flatMap((item) => {
          const field = Number(item.DataFieldID ?? item.FieldID)
          if (!field) return []
          const known = named.get(field)
          return [
            {
              id: field,
              name: text(item.FieldName) || known?.name || "",
              type: Number(item.FieldType ?? item.FieldTypeID ?? known?.type) || 0,
            },
          ]
        }),
      },
    ]
  })
}

/** The state buttons: transitions when the project's workflow uses them, otherwise every state. */
export function readStates(data: unknown): State[] {
  const body = unwrap(data)
  const info = record(body) && record(body.TempDetailPageInfo) ? body.TempDetailPageInfo : {}
  const flow = record(info.WorkflowSetting) && !!info.WorkflowSetting.EnableStateTransition
  const raw = flow
    ? list(record(info.TransitionSet) ? info.TransitionSet.Transitions : undefined)
    : list(record(info.StateSet) ? info.StateSet.StateDefs : undefined)
  const seen = new Set<number>()
  return raw.flatMap((item) => {
    const id = Number(flow ? item.NextStateID : item.StateID)
    if (!id || seen.has(id)) return []
    seen.add(id)
    return [
      {
        id,
        name: text(item.StateName ?? item.StatusName ?? item.NextStateName),
        transition: Number(item.TransitionID) || 0,
        closed: !!item.IsClosed || Number(item.IsActive) === 0,
      },
    ]
  })
}

/** Which fields the chosen state makes required, read-only or hidden, across the dialog's tabs. */
export function readRules(data: unknown): Rules {
  const pages = list(unwrap(data), "Pages")
  return {
    required: [...new Set(pages.flatMap((page) => ids(page.MandatoryIDs)))],
    readonly: [...new Set(pages.flatMap((page) => ids(page.ReadonlyIDs)))],
    hidden: [...new Set(pages.flatMap((page) => ids(page.InvisibleIDs)))],
  }
}

/** A choice field's choices from `TestTemplate/TemplateField`. */
export function readChoices(data: unknown): Choice[] {
  const body = unwrap(data)
  const first = Array.isArray(body) && record(body[0]) && Array.isArray(body[0].ChoiceList) ? body[0].ChoiceList : body
  return list(first).flatMap((item) => {
    const id = Number(item.ChoiceID ?? item.Id)
    return id ? [{ id, name: text(item.ChoiceName ?? item.Name) }] : []
  })
}

/** Who can own a test case in the library's space. */
export function readOwners(data: unknown): Choice[] {
  const body = record(data) && Array.isArray(data.OwnerList) ? data.OwnerList : unwrap(data)
  return list(body).flatMap((item) => {
    const id = Number(record(item.MemberId) ? item.MemberId.Id : (item.UserID ?? item.MemberId))
    return id ? [{ id, name: text(item.MemberName ?? item.UserName) }] : []
  })
}

/**
 * The body `TestTemplate/NewEx` takes: one single-key object per filled field, times in seconds, rich text in
 * base64, choices and owners by id, and the spec it's created under.
 */
export function body(input: {
  project: number
  folder: number
  id: number
  values: Values
  pages: Page[]
  spec: { project: number; id: number }
}) {
  const all = input.pages.flatMap((page) => page.fields)
  const sent = all.flatMap((field): Record<number, string | number>[] => {
    if (fields.feature.includes(field.id)) return []
    if (field.id === fields.parent) return [{ [field.id]: `${input.spec.project}:${input.spec.id}` }]
    const value = input.values[field.id] ?? ""
    if (!value) return []
    if (rich(field)) return [{ [field.id]: encode64(value) }]
    if (field.id === fields.state || field.id === fields.owner || select(field) || field.id === fields.setup || field.id === fields.test)
      return Number(value) ? [{ [field.id]: Number(value) }] : []
    return [{ [field.id]: value }]
  })
  // The state is always sent, even when no tab shows it.
  const state = Number(input.values[fields.state]) || 0
  const extra: Record<number, string | number>[] = state && !sent.some((item) => fields.state in item) ? [{ [fields.state]: state }] : []
  return {
    projectId: input.project,
    folderId: input.folder,
    preAllocatedTempId: input.id,
    fields: [...new Map([...sent, ...extra].map((item) => [Object.keys(item)[0], item])).values()],
    specProjectId: input.spec.project,
    reqID: input.spec.id,
  }
}

/** Everything the dialog opens with: tabs laid out, states, the first state's rules, owners and a reserved id. */
export async function open(
  base: string,
  token: string,
  test: { project: number; space: number },
  spec: { project: number; id: number },
  user: string,
  locale: string,
) {
  const [init, detail, reserved, owners, source] = await Promise.all([
    call(base, token, "/DevTestApi/api/TestTemplate/TestInitDataEx", locale, {
      testTemplateProjectID: test.project,
      testTaskProjectID: 0,
      testTemplateFieldIDs: "1001,1008,1010,1101",
      isTemplateFolder: 0,
    }),
    call(base, token, "/DevTestApi/api/P1Project/GetInitDetailPageProjectData", locale, {
      TempProjectId: test.project,
      TemplateID: 0,
      opType: 2,
      isFolderAccess: 0,
    }),
    call(
      base,
      token,
      `/DevTestApi/api/TestTemplate/GetPreAllocatedTemplateID?ProjectID=${test.project}&forcePreAllocated=1`,
      locale,
    ),
    call(
      base,
      token,
      `/DevTestApi/api/TestTemplate/GetTemplateOwnerList?ProjectId=${test.project}&SpaceId=${test.space}&IncludeGroupFolder=1`,
      locale,
    ).catch(() => undefined),
    // The spec's title and description start the new test case, as P1 fills them in.
    call(base, token, "/DevSpecAPI/ReqItemEx", locale, {
      ProjectID: spec.project,
      IssueID: spec.id,
      FieldIDs: [1101, 1102],
      NeedFolderInfo: 0,
      SupportFieldID: 1,
    }).catch(() => undefined),
  ])
  const states = readStates(detail)
  const first = states[0]
  const found = readValues(source)
  const [pages, rules] = await Promise.all([
    layouts(base, token, test.project, readPages(init), locale, 102),
    access(base, token, test.project, first?.id ?? 0, user, locale).catch(
      () => ({ required: [], readonly: [], hidden: [] }) as Rules,
    ),
  ])
  const picks = pages.flatMap((page) => page.fields).filter((field) => select(field) && !fields.feature.includes(field.id))
  const choices = Object.fromEntries(
    await Promise.all(
      picks.map(async (field) => [
        field.id,
        await call(base, token, "/DevTestApi/api/TestTemplate/TemplateField", locale, {
          projectId: test.project,
          fieldIds: String(field.id),
        })
          .then(readChoices)
          .catch(() => [] as Choice[]),
      ]),
    ),
  ) as Record<number, Choice[]>
  return {
    pages,
    states,
    rules,
    owners: readOwners(owners),
    choices,
    id: Number(text(unwrap(reserved))) || 0,
    values: {
      [fields.title]: found[1101]?.value ?? "",
      [fields.text]: found[1102]?.html ?? "",
      ...(first ? { [fields.state]: String(first.id) } : {}),
    } as Values,
  }
}

/** The rules for a state, asked again whenever another state is picked. */
export async function access(base: string, token: string, project: number, state: number, user: string, locale: string) {
  return readRules(
    await call(base, token, "/DevTestApi/api/TestTemplate/TemplateFieldAccessControl", locale, {
      projectId: project,
      IssueId: 0,
      stateId: state,
      opType: 5,
      userId: Number(user) || 0,
    }),
  )
}

/**
 * Creates the test case under the spec and links it, as P1's New Template does. NewEx records the spec as the test
 * case's parent requirement; the link of type 13 sent after it is the one P1's "no linked test cases" check counts,
 * so both are needed (All Links shows the test case once). P1 answers with its id in `Message`.
 */
export async function create(base: string, token: string, input: Parameters<typeof body>[0], locale: string) {
  const data = await call(base, token, "/DevTestApi/api/TestTemplate/NewEx", locale, body(input))
  if (record(data) && Number(data.StatusCode ?? 0) !== 0)
    throw new Error(text(data.Message) || "Could not create the test case")
  const id = Number(record(data) ? data.Message : data) || input.id
  await call(base, token, "/DevSpecAPI/ReqAllLink", locale, {
    ProjectID: input.spec.project,
    ItemID: input.spec.id,
    LinkedProjectID: input.project,
    LinkedItemIDs: String(id),
    LinkTypeID: 13,
    LinkReferenceTypeID: 0,
    ActionType: 1,
    NotRemoveOld: 1,
  })
  return id
}
