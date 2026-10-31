import { call } from "./api"

/**
 * A roadmap month's workload and performance, as P1's requirement page shows it: the spec points finished
 * against the team's target, each member's points, workload and completion (`ReqWorkSummary`), their work
 * objective (WO) review scores (`p1MindSync`) and their monthly score out of 10 (`MonthlyTeamScoreReport`).
 */

/** Where the numbers come from: the requirement project and folder, and the P1 and development projects. */
export type Scope = {
  project: number
  folder: number
  base: number
  space: number
  dev: { project: number; space: number }
}

export type Member = {
  id: number
  name: string
  // Spec points assigned to the member and their target, and the same for task points.
  spec: number
  target: number
  task: number
  tasks: number
  // Workload against target (spec and task) and % complete, as P1 works them out.
  load: number
  work: number
  done: number
}

export type Summary = { points: number; finished: number; assigned: number; load: number; members: Member[] }

/** One tab of the report: the whole month (week 0) or one of its weeks, as YYYYMMDD days. */
export type Span = { week: number; from: number; to: number }

export function readSummary(data: unknown): Summary {
  const body = record(data) && record(data.Data) ? data.Data : record(data) ? data : {}
  const rows = Array.isArray(body.SpecWorkSummarys) ? body.SpecWorkSummarys.filter(record) : []
  return {
    points: num(body.AllSpecPoints),
    finished: num(body.AllSpecFinishPoints),
    assigned: num(body.AllAssignedSpecPoints),
    load: num(body.AllWorkload),
    members: rows
      .map((row) => ({
        id: num(row.UserID),
        name: String(row.UserName ?? ""),
        spec: num(row.AssignedSpecPoints),
        target: num(row.TargetSpecPoints),
        task: num(row.TaskPoints),
        tasks: num(row.TargetTaskPoints),
        load: num(row.Workload),
        work: num(row.TaskWorkload),
        done: num(row.Complete),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
}

/** Each member's monthly score out of 10, by member id, for a month like "202610". */
export function readScores(data: unknown, month: string) {
  const body = record(data) && record(data.Data) ? data.Data : {}
  const months = Array.isArray(body.MonthlyScores) ? body.MonthlyScores.filter(record) : []
  const found = months.find((item) => String(item.MonthId) === month)
  const people = Array.isArray(found?.PersonScores) ? found.PersonScores.filter(record) : []
  return Object.fromEntries(people.map((item) => [num(item.PersonId), num(item.AverageScore)])) as Record<
    number,
    number
  >
}

/** The team's standing: its members' average monthly score and the highest and lowest, out of 10. */
export function standing(scores: Record<number, number>, ids?: number[]) {
  const score = team(scores, ids) ?? team(scores)
  if (score === undefined) return
  const known = (ids ?? []).filter((id) => id in scores)
  const list = (known.length ? known : Object.keys(scores).map(Number)).map((id) => scores[id])
  return { score, high: Math.max(...list), low: Math.min(...list) }
}

/** The team's score: its members' average monthly score, to one decimal. */
export function team(scores: Record<number, number>, ids?: number[]) {
  const list = (ids ?? Object.keys(scores).map(Number)).filter((id) => id in scores).map((id) => scores[id])
  if (!list.length) return
  return Math.round((list.reduce((sum, value) => sum + value, 0) / list.length) * 10) / 10
}

/**
 * A week's WO score in %: the average of its reviewers' scores out of their full scores, counting reviewers
 * P1 lets score (report-to options 1 and 2) who have scored.
 */
export function achieved(reviewers: unknown) {
  const list = (Array.isArray(reviewers) ? reviewers : [])
    .filter(record)
    .filter((item) => [1, 2].includes(num(item.ReportToOption)) && num(item.Score))
    .map((item) => (num(item.Score) / (num(item.FullScore) || 10)) * 100)
  if (!list.length) return 0
  return Math.round((list.reduce((sum, value) => sum + value, 0) / list.length) * 10) / 10
}

/**
 * Members' WO scores for a tab, by member id. The month averages the weeks that have a score; a week takes the
 * review whose week starts that day, else the one P1 carries over from the week before the month.
 */
export function readReviews(data: unknown, span: Span) {
  const rows = (record(data) && Array.isArray(data.Data) ? data.Data : Array.isArray(data) ? data : []).filter(record)
  return Object.fromEntries(
    rows.map((row) => {
      const syncs = (Array.isArray(row.MindSyncs) ? row.MindSyncs : []).filter(record).map((sync) => {
        const goal = (Array.isArray(sync.WorkObjectives) ? sync.WorkObjectives : []).filter(record)[0]
        return { week: num(sync.WeekNo), day: num(goal?.WeekId), score: achieved(goal?.Reviewers) }
      })
      if (!span.week) {
        const scored = syncs.filter((sync) => sync.score)
        return [
          num(row.MemberId),
          scored.length ? round(scored.reduce((sum, sync) => sum + sync.score, 0) / scored.length) : 0,
        ]
      }
      const found = syncs.find((sync) => sync.day === span.from) ?? syncs.find((sync) => sync.week === 0)
      return [num(row.MemberId), found?.score ?? 0]
    }),
  ) as Record<number, number>
}

/**
 * Members whose WO is reviewed: they have a default WO template and have not turned review off
 * (preference 6 with text "1"). The rest show N/A.
 */
export function reviewed(prefs: unknown, templates: unknown) {
  const off = new Set(
    list(prefs)
      .filter((row) =>
        (Array.isArray(row.Preferences) ? row.Preferences : [])
          .filter(record)
          .some((pref) => num(pref.PrefId) === 6 && String(pref.PreferenceText ?? "") === "1"),
      )
      .map((row) => num(row.UserId)),
  )
  const seen = new Set(list(prefs).map((row) => num(row.UserId)))
  return list(templates)
    .filter((row) =>
      (Array.isArray(row.WorkObjectiveTemplates) ? row.WorkObjectiveTemplates : [])
        .filter(record)
        .some((item) => num(item.TemplateId)),
    )
    .map((row) => num(row.PersonId))
    .filter((id) => seen.has(id) && !off.has(id))
}

/**
 * The report's tabs for a month like "202610", as P1 counts them: the whole month, then its weeks, the 1st
 * running to the first Sunday and each Monday starting the next.
 */
export function spans(month: string): Span[] {
  const year = Number(month.slice(0, 4))
  const index = Number(month.slice(4)) - 1
  const last = new Date(year, index + 1, 0).getDate()
  const day = (date: number) => year * 10000 + (index + 1) * 100 + date
  const starts = Array.from({ length: last }, (_, at) => at + 1).filter(
    (date) => date === 1 || new Date(year, index, date).getDay() === 1,
  )
  return [
    { week: 0, from: day(1), to: day(last) },
    ...starts.map((date, at) => ({ week: at + 1, from: day(date), to: day((starts[at + 1] ?? last + 1) - 1) })),
  ]
}

/** The days P1's summary line counts a month over: from its first Monday to its last day. */
export function period(month: string) {
  const year = Number(month.slice(0, 4))
  const index = Number(month.slice(4)) - 1
  const first = new Date(year, index, 1).getDay()
  const last = new Date(year, index + 1, 0).getDate()
  const day = (date: number) => year * 10000 + (index + 1) * 100 + date
  return { week: 0, from: day(1 + [1, 0, 6, 5, 4, 3, 2][first]), to: day(last) }
}

/** The workload of `items` (requirement ids) over a span. */
export async function summary(base: string, token: string, place: Scope, items: number[], span: Span, locale: string) {
  const date = (value: number) => `${String(value).slice(0, 4)}-${String(value).slice(4, 6)}-${String(value).slice(6)}`
  const subs = await call(base, token, "/DevTrackApi/api/SubProject/QueryChildSubProjects", locale, {
    ProjectId: place.dev.project,
    SubProjectId: place.dev.space,
    QueryCondition: { PlanDateRange: { From: date(span.from), To: date(span.to) } },
  }).catch(() => [])
  const data = await call(base, token, "/DevSpecAPI/ReqWorkSummary", locale, {
    ProjectID: place.project,
    FolderID: place.folder,
    devTrackProjectID: place.dev.project,
    SpaceID: place.dev.space,
    SubprojectIDs: list(subs)
      .map((row) => num(row.SubProjectId))
      .filter(Boolean),
    ItemIDs: items,
    startDate: span.from,
    endDate: span.to,
    UserWorkSummary: 0,
  })
  return readSummary(data)
}

/** Members' monthly scores out of 10. */
export async function scores(base: string, token: string, place: Scope, month: string, locale: string) {
  const data = await call(
    base,
    token,
    `/DevTrackApi/api/P1HomeReports/MonthlyTeamScoreReport?projectId=${place.base}&spaceId=${place.space}&fresh=false`,
    locale,
  )
  return readScores(data, month)
}

/** Members' weekly WO reviews for a month, and who is reviewed at all. */
export async function reviews(base: string, token: string, place: Scope, ids: number[], month: string, locale: string) {
  const body = { ProjectId: place.base, SpaceId: place.space }
  const [syncs, prefs, templates] = await Promise.all([
    call(base, token, "/DevTrackApi/api/p1MindSync/batchGetWeeklyMindSyncs", locale, {
      ...body,
      MemberIds: ids,
      Year: month.slice(0, 4),
      Month: Number(month.slice(4)),
    }),
    call(base, token, "/DevTrackApi/api/P1UserPreference/batchGetPreferences", locale, {
      ProjectId: place.base,
      SubProjectId: place.space,
      UserIds: ids,
      PrefIds: [6],
    }),
    call(base, token, "/DevTrackApi/api/projectone/batchGetDefaultWOTemplates", locale, { ...body, UserIds: ids }),
  ])
  return { syncs, on: reviewed(prefs, templates) }
}

function round(value: number) {
  return Math.round(value * 10) / 10
}

function num(value: unknown) {
  const out = Number(value)
  return Number.isFinite(out) ? out : 0
}

function list(data: unknown) {
  const body = record(data) && "Data" in data ? data.Data : data
  return (Array.isArray(body) ? body : []).filter(record)
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
