import { call } from "./api"

/** Spec points, as P1's points popover reads and saves them: one row per implementation module. */

export type Module = {
  module: number
  name: string
  owner: number
  person: string
  points: number
  tasks: number
  time: string
  finish: string
}
export type Choice = { id: number; name: string }
/** The P1 project (base family and space) a requirement belongs to, and its linked development project. */
export type Home = { base: number; space: number; dev?: { project: number; space: number } }

export function readModules(est: unknown, act: unknown): Module[] {
  const actual = new Map(rows(act).map((row) => [module(row), row]))
  return rows(est).flatMap((row) => {
    const id = module(row)
    if (!id) return []
    const done = actual.get(id) ?? {}
    const info = record(row.ModuleInfo) ? row.ModuleInfo : {}
    return [
      {
        module: id,
        name: String(info.ModuleName ?? ""),
        owner: Number(row.OwnerId) || 0,
        person: String(row.OwnerName ?? ""),
        points: Number(done.EstTotalPoints ?? row.EstTotalPoints) || 0,
        tasks: Number(done.TaskCount) || 0,
        time: done.TimeSpent || done.TimeRemain ? `${done.TimeSpent ?? "0h"}/${done.TimeRemain ?? "0h"}` : "",
        finish: String(done.FinishPercentage ?? ""),
      },
    ]
  })
}

export async function load(base: string, token: string, project: number, spec: number, home: Home, locale: string) {
  const query = `projectId=${project}&specId=${spec}&p1ProjectId=${home.base}&p1SpaceId=${home.space}`
  const [est, act] = await Promise.all([
    call(base, token, `/DevTrackApi/api/specPoints/estimatedPoints?${query}`, locale),
    call(base, token, `/DevTrackApi/api/specPoints/actualPoints?${query}`, locale).catch(() => undefined),
  ])
  return readModules(est, act)
}

const kept = new Map<string, Promise<unknown>>()

function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  const found = kept.get(key)
  if (found) return found as Promise<T>
  const next = run()
  kept.set(key, next)
  next.catch(() => kept.delete(key))
  return next
}

/** The modules points can go to, from the linked development project. */
export function modules(base: string, token: string, home: Home, locale: string) {
  if (!home.dev) return Promise.resolve([] as Choice[])
  const dev = home.dev.project
  return once(`${base}|modules|${dev}`, () =>
    call(base, token, `/DevTrackApi/api/Methodology/ImplementationModules?ProjectId=${dev}`, locale).then((data) =>
      rows(data).map((row) => ({ id: Number(row.ModuleID), name: String(row.ModuleName ?? "") })),
    ),
  )
}

/** The people who can own a module's points: the P1 project's development members. */
export function members(base: string, token: string, home: Home, locale: string) {
  return once(`${base}|members|${home.base}|${home.space}`, () =>
    call(
      base,
      token,
      `/DevTrackApi/api/projectone/P1ModuleMembers?projectId=${home.base}&spaceId=${home.space}&moduleType=1&pageSize=0&currentPage=0&orderBy=UserName&isDescending=false`,
      locale,
    ).then((data) => {
      const body = record(data) && record(data.Data) ? data.Data : {}
      return (Array.isArray(body.Members) ? body.Members : [])
        .filter(record)
        .map((row) => ({ id: Number(row.MemberId), name: String(row.MemberName ?? "") }))
    }),
  )
}

/** Where a module's new story goes: the development project's running sprint, else its space. */
export async function sprint(base: string, token: string, home: Home, locale: string) {
  const dev = home.dev
  if (!dev) return
  const data = await call(
    base,
    token,
    `/DevTrackApi/api/SubProject/SprintsInProcess?projectId=${dev.project}&spaceId=${dev.space}`,
    locale,
  ).catch(() => undefined)
  const first = rows(data)[0]
  const id = first ? Number(first.subprojectId ?? first.SubProjectId) : 0
  return { ProjectId: dev.project, SubProjectId: id || dev.space }
}

export async function save(
  base: string,
  token: string,
  input: { project: number; spec: number; home: Home; row: Module; moved: boolean },
  locale: string,
) {
  await call(base, token, "/DevTrackApi/api/specPoints/saveEstPoints", locale, {
    ProjectId: input.project,
    SpecId: input.spec,
    ModuleId: input.row.module,
    OwnerId: input.row.owner,
    Points: input.row.points,
    P1Project: { ProjectId: input.home.base, SpaceId: input.home.space },
    ...(input.moved ? { SubProject: await sprint(base, token, input.home, locale) } : {}),
  })
}

export async function remove(base: string, token: string, project: number, spec: number, module: number, locale: string) {
  await call(base, token, "/DevTrackApi/api/specPoints/removeEstPoints", locale, {
    ProjectId: project,
    SpecId: spec,
    ModuleId: module,
  })
}

function module(row: Record<string, unknown>) {
  const info = record(row.ModuleInfo) ? row.ModuleInfo : {}
  return Number(info.ModuleID ?? row.ImplementationModuleId) || 0
}

function rows(data: unknown): Record<string, unknown>[] {
  const body = record(data) && "Data" in data ? data.Data : data
  return (Array.isArray(body) ? body : []).filter(record)
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
