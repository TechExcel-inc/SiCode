import { call } from "./api"
import { sprint, type Choice, type Home } from "./points"

/**
 * A spec's stories and the tasks under them, as they live in its linked development project and as
 * P1's own story screens read and write them through DevTrack. Times are hours; P1 sends them as "1.5h".
 */

export type Task = {
  id: number
  name: string
  owner: number
  person: string
  module: number
  area: string
  points: number
  spent: number
  remain: number
  finish: number
}

export type Story = {
  id: number
  tag: string
  project: number
  sub: number
  name: string
  owner: number
  person: string
  module: number
  area: string
  points: number
  // Target time: the hours the story is planned to take, to one decimal.
  target: number
  spent: number
  remain: number
  finish: number
  tasks: Task[]
}

/** Hours from P1's "1.5h", "90m" or a plain number. */
export function hours(value: unknown) {
  const text = String(value ?? "").trim()
  const num = parseFloat(text)
  if (!Number.isFinite(num)) return 0
  if (/m$/i.test(text)) return num / 60
  return num
}

export function readStories(data: unknown): Story[] {
  return rows(data).map((row) => {
    const tasks = (Array.isArray(row.LinkedTasks) ? row.LinkedTasks : []).filter(record).map((item) => ({
      id: Number(item.IssueId) || 0,
      name: String(item.Title ?? ""),
      owner: Number(item.CurrentOwnerId) || 0,
      person: String(item.CurrentOwnerName ?? ""),
      module: Number(item.ImplementationModuleId) || 0,
      area: String(item.ImplementationModuleName ?? ""),
      points: Number(item.TaskPoints) || 0,
      spent: hours(item.TimeSpent),
      remain: left(item.TimeRemain, Number(item.TaskPoints) || 0, hours(item.TimeSpent)),
      finish: Number(item.FinishPercentage) || 0,
    }))
    return {
      id: Number(row.StoryItemId) || 0,
      tag: String(row.DisplayId ?? ""),
      project: Number(row.ProjectId) || 0,
      sub: Number(row.ParentSubProjectId) || 0,
      name: String(row.StoryTitle ?? ""),
      owner: Number(row.CurrentOwnerId) || 0,
      person: String(row.CurrentOwnerName ?? ""),
      module: Number(row.ImplementationModuleId) || 0,
      area: String(row.ImplementationModuleName ?? ""),
      points: Number(row.StoryPoints) || 0,
      target: planned(row),
      spent: hours(row.TimeSpent),
      // Its tasks' time once any has some; related-module tasks start with none, so the story's own counts until then.
      remain: tasks.some((task) => task.remain || task.spent)
        ? tasks.reduce((sum, task) => sum + task.remain, 0)
        : left(row.TimeRemain, planned(row), hours(row.TimeSpent)),
      finish: tasks.length ? rollup(tasks) : Number(row.FinishPercentage) || 0,
      tasks,
    }
  })
}

/** A story's % finish from its tasks: each task's % finish weighted by its hours, or evenly while none has any. */
export function rollup(tasks: { spent: number; remain: number; finish: number }[]) {
  const size = tasks.reduce((sum, task) => sum + task.spent + task.remain, 0)
  if (!size) return Math.round(tasks.reduce((sum, task) => sum + task.finish, 0) / tasks.length)
  return Math.round(tasks.reduce((sum, task) => sum + task.finish * (task.spent + task.remain), 0) / size)
}

/**
 * A story's target time in hours. P1 takes the estimated time in minutes but reads it back in seconds,
 * since its points are whole numbers; stories made before that fall back to their points.
 */
function planned(row: Record<string, unknown>) {
  const value = row.StoryEstimatedTime
  const time = typeof value === "number" ? value / 3600 : hours(value)
  return time || Number(row.StoryPoints) || 0
}

/** P1's story fields for a target time: the minutes, and the nearest whole points. */
export function aim(target: number) {
  return { StoryEstimatedTime: Math.round(target * 60), StoryPoints: Math.round(target) }
}

/**
 * Time left: what P1 says remains, or the points while nothing has been logged yet,
 * since a task's points are the hours it was planned to take.
 */
function left(value: unknown, points: number, spent: number) {
  const remain = hours(value)
  return remain || spent ? remain : points
}

/**
 * A story's applicable modules: its own and its tasks', since P1 keeps one module per story.
 * P1 sometimes leaves a story's module name out, so names come from the project's modules too.
 */
export function areas(story: Story, mods: Choice[] = []): Choice[] {
  const all = [
    { id: story.module, name: story.area },
    ...story.tasks.map((task) => ({ id: task.module, name: task.area })),
  ].map((item) => ({ id: item.id, name: item.name || mods.find((mod) => mod.id === item.id)?.name || "" }))
  return all.filter((item, index) => item.id && item.name && all.findIndex((other) => other.id === item.id) === index)
}

/** A DevTrack call that fails when its `{Success, Error}` envelope says so, returning `Data`. */
async function dev(base: string, token: string, path: string, locale: string, body?: unknown) {
  const data = await call(base, token, `/DevTrackApi/api/${path}`, locale, body)
  if (record(data) && data.Success === false) {
    const err = record(data.Error) ? data.Error.ErrorMessage : data.Message
    // Which call P1 refused, since its messages rarely say.
    throw new Error(`${String(err || "P1 refused the change")} (${path.split("?")[0]})`)
  }
  return record(data) && "Data" in data ? data.Data : data
}

export async function stories(base: string, token: string, project: number, spec: number, locale: string) {
  const list = rows(await dev(base, token, "Story/ListBySpec", locale, { SpecProjectId: project, SpecItemId: spec }))
  // The list leaves out each story's estimated time, so it comes from the story itself.
  const full = await Promise.all(
    list.map((row) =>
      dev(base, token, `Story/Get?projectId=${row.ProjectId}&storyId=${row.StoryItemId}`, locale)
        .then((got) => ({ ...row, StoryEstimatedTime: record(got) ? got.StoryEstimatedTime : undefined }))
        .catch(() => row),
    ),
  )
  return readStories(full)
}

/** The tasks AssignSpec made, by id; the story it made is marked as option 1. */
function made(data: unknown) {
  return (Array.isArray(data) ? data : [])
    .filter(record)
    .filter((item) => Number(item.Option) !== 1)
    .map((item) => Number(item.Id) || 0)
    .filter(Boolean)
}

/** Sets new tasks' exact time remaining, since P1 only takes whole points when making them. */
async function exact(base: string, token: string, project: number, ids: number[], minutes: number, locale: string) {
  const parts = spread(
    ids.map(() => ({ remain: 0 }) as Task),
    minutes,
  )
  for (const [index, id] of ids.entries())
    if (parts[index] % 60) await change(base, token, project, id, field.remain, parts[index], locale)
}

/** A new story for the spec in the development project's running sprint, with a task for each module. */
export async function create(
  base: string,
  token: string,
  input: { project: number; spec: number; home: Home; name: string; owner: number; target: number; modules: Choice[] },
  locale: string,
) {
  const target = input.home.dev
  if (!target) throw new Error("This project has no development project to hold stories")
  const sub = (await sprint(base, token, input.home, locale))?.SubProjectId ?? target.space
  const data = await dev(base, token, "Task/AssignSpec", locale, {
    SpecProjectId: input.project,
    SpecItemId: input.spec,
    AssignToProjectId: target.project,
    StoryCreation: { SubProjectId: sub, CurrentOwnerId: input.owner, ...aim(input.target) },
    // Modules are the story's related modules: their tasks carry no points, the story keeps its own.
    TaskCreations: input.modules.map((item) =>
      task(item.id, input.owner, input.modules.length > 1 ? `${input.name} – ${item.name}` : input.name, sub, 0),
    ),
  })
  const story = (Array.isArray(data) ? data : []).filter(record).find((item) => Number(item.Option) === 1)
  const id = Number(story?.Id) || 0
  // AssignSpec names the story after the spec; give it the name you typed and its target time.
  if (id)
    await dev(base, token, "Story/Update", locale, {
      StoryId: id,
      ProjectId: target.project,
      StoryTitle: input.name,
      CurrentOwnerId: input.owner,
      ...aim(input.target),
    })
  return id
}

/** A task for `Task/AssignSpec`, shaped as P1's web app sends it; points are whole, hours left are set after. */
function task(module: number, owner: number, title: string, sub: number, points: number) {
  return {
    ImplementModuleId: module,
    TemplateId: 0,
    SubProjectId: sub,
    OwnerId: owner,
    PriorityValue: 0,
    SpecPoints: Math.round(points),
    EstTotal: Math.round(points),
    Title: title,
    Description: "",
    PlanedStartDate: "",
    PlanedEndDate: "",
  }
}

/** A new task under a story. */
export async function add(
  base: string,
  token: string,
  input: { project: number; spec: number; story: Story; name: string; owner: number; module: number; points: number },
  locale: string,
) {
  // P1 reads a story part even when the task goes into an existing story, so its web app always sends one.
  const data = await dev(base, token, "Task/AssignSpec", locale, {
    SpecProjectId: input.project,
    SpecItemId: input.spec,
    AssignToProjectId: input.story.project,
    StoryId: input.story.id,
    StoryCreation: {
      CurrentStatus: 0,
      SubProjectId: input.story.sub,
      StoryPriority: 0,
      StoryPoints: 0,
      StoryEstimatedTime: 0,
      CurrentOwnerId: 0,
      PlanedStartDate: "",
      PlanedEndDate: "",
    },
    TaskCreations: [task(input.module, input.owner, input.name, input.story.sub, input.points)],
  })
  await exact(base, token, input.story.project, made(data), Math.round(input.points * 60), locale)
}

/** Changes a story's name, owner or target time (from `aim`); its other values go along so P1 has the whole story. */
export async function edit(
  base: string,
  token: string,
  story: Story,
  next: { StoryTitle?: string; CurrentOwnerId?: number; StoryPoints?: number; StoryEstimatedTime?: number },
  locale: string,
) {
  await dev(base, token, "Story/Update", locale, {
    StoryId: story.id,
    ProjectId: story.project,
    StoryTitle: story.name,
    CurrentOwnerId: story.owner,
    StoryPoints: story.points,
    ...next,
  })
}

/** Task fields by P1 id: title, owner, module, points, time spent and remaining (minutes), % finish. */
export const field = { name: 101, owner: 108, module: 810, points: 631, spent: 620, remain: 621, finish: 623 } as const

/**
 * A story's time remaining in minutes spread over its tasks: in step with what each has left,
 * or evenly when none has any, with the rounding left over going to the last.
 */
export function spread(tasks: Task[], minutes: number) {
  const left = tasks.reduce((sum, task) => sum + task.remain, 0)
  const parts = tasks.map((task) => Math.round((left ? task.remain / left : 1 / tasks.length) * minutes))
  return parts.map((part, index) =>
    index === parts.length - 1 ? minutes - parts.slice(0, -1).reduce((sum, x) => sum + x, 0) : part,
  )
}

/** Sets a story's time remaining through its tasks, since P1 keeps time on tasks. */
export async function budget(base: string, token: string, story: Story, hours: number, locale: string) {
  const parts = spread(story.tasks, Math.round(hours * 60))
  for (const [index, task] of story.tasks.entries())
    if (Math.round(task.remain * 60) !== parts[index])
      await change(base, token, story.project, task.id, field.remain, parts[index], locale)
}

export async function change(
  base: string,
  token: string,
  project: number,
  task: number,
  id: number,
  value: string | number,
  locale: string,
) {
  const data = await dev(base, token, "Task/Update", locale, {
    ProjectId: project,
    TaskId: task,
    FieldValues: [{ FieldId: id, FieldValue: value, Option: 0 }],
  })
  if (record(data) && data.Success === false) throw new Error(String(data.Reason || "P1 refused the change"))
}

/**
 * Sets a task's time spent. Projects that only take time through time entries refuse the field,
 * so the difference is logged as an entry instead.
 */
export async function spend(
  base: string,
  token: string,
  input: { project: number; task: number; user: string; from: number; to: number },
  locale: string,
) {
  const set = await change(base, token, input.project, input.task, field.spent, Math.round(input.to * 60), locale)
    .then(() => true)
    .catch(() => false)
  if (set) return
  const delta = Math.round((input.to - input.from) * 10) / 10
  if (delta <= 0) throw new Error("This project only adds time; enter more time than is already spent")
  const kinds = await dev(base, token, `timeTracking/TimeCagetories?projectId=${input.project}`, locale, {}).catch(
    () => [],
  )
  const kind = rows(kinds)[0]
  await dev(base, token, "timeTracking/AddTimeSpentItem", locale, {
    OwnerId: Number(input.user) || input.user,
    Date: new Date().toISOString().slice(0, 10),
    TimeHourlyRate: 0,
    CategoryId: Number(kind?.CategoryId ?? kind?.Id ?? kind?.ID) || 0,
    Note: "",
    ProjectId: input.project,
    TaskId: input.task,
    TimeValue: { Value: `${delta}h`, Option: 2 },
  })
}

export async function drop(base: string, token: string, project: number, task: number, locale: string) {
  await dev(base, token, "Task/Delete", locale, { ProjectId: project, TaskId: task })
}

/** Deletes a story after its tasks, as P1's planning screen does. */
export async function discard(base: string, token: string, story: Story, locale: string) {
  for (const task of story.tasks) await drop(base, token, story.project, task.id, locale)
  await dev(base, token, `Story/Delete?projectId=${story.project}&storyId=${story.id}`, locale)
}

function rows(data: unknown): Record<string, unknown>[] {
  const body = record(data) && "Data" in data ? data.Data : data
  return (Array.isArray(body) ? body : []).filter(record)
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
