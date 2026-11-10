import type { Message, Part, SnapshotFileDiff } from "@opencode-ai/sdk/v2/client"
import { outputGroup, sessionOutputs, type Output } from "./agent-outputs"

export type TaskStep = { content: string; status: string }

export type TaskCode = { file: string; additions: number; deletions: number }

/**
 * One piece of work in a session: a checklist the AI wrote for a request, with its steps and what it
 * produced. A request that continues an earlier checklist joins that task instead of starting a new one.
 */
export type Task = {
  id: string
  title: string
  /** The user messages (requests) this task covers. */
  requests: string[]
  steps: TaskStep[]
  done: number
  finished: boolean
  cost: number
  /** Documents, images and pages the AI wrote for this task. */
  documents: Output[]
  /** Source files changed in the session's folder, from the engine's per-request diff. */
  code: TaskCode[]
  /** Code files the AI wrote outside the session's folder, which the per-request diff does not cover. */
  elsewhere: Output[]
  added: number
  removed: number
}

const CLOSED = new Set(["completed", "cancelled"])

/** The checklists a set of parts wrote, in order. */
function checklists(parts: Part[]): TaskStep[][] {
  return parts.flatMap((part) => {
    if (part.type !== "tool" || part.tool !== "todowrite" || part.state.status !== "completed") return []
    const todos = (part.state.input as { todos?: unknown }).todos
    if (!Array.isArray(todos)) return []
    return [
      todos.flatMap((item: { content?: unknown; status?: unknown }) =>
        typeof item?.content === "string" ? [{ content: item.content, status: String(item.status ?? "pending") }] : [],
      ),
    ]
  })
}

/** The work moved to a session in another project (project_switch answered "moved"): it goes on there. */
function moved(parts: Part[]) {
  return parts.some(
    (part) =>
      part.type === "tool" &&
      part.tool === "project_switch" &&
      part.state.status === "completed" &&
      typeof (part.state.metadata as { session?: unknown } | undefined)?.session === "string",
  )
}

/** Two checklists are the same task when at least half the steps of the shorter one appear in both. */
export function sameChecklist(a: TaskStep[], b: TaskStep[]) {
  if (a.length === 0 || b.length === 0) return false
  const words = new Set(a.map((step) => step.content.trim().toLowerCase()))
  const shared = b.filter((step) => words.has(step.content.trim().toLowerCase())).length
  return shared * 2 >= Math.min(a.length, b.length)
}

function requestTitle(message: Message, parts: Part[]) {
  if (message.role === "user" && message.summary?.title) return message.summary.title
  const text = parts
    .flatMap((part) => (part.type === "text" && !part.synthetic ? [part.text] : []))
    .join("\n")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean)
  if (!text) return ""
  return text.length > 80 ? `${text.slice(0, 79)}…` : text
}

/**
 * The tasks of a session, newest first. Each request (user message) whose replies wrote a checklist
 * is a task, titled by the request; a request with no checklist (a question, a one-line fix) is not.
 */
export function sessionTasks(messages: Message[], parts: Record<string, Part[] | undefined>): Task[] {
  const replies = new Map<string, Message[]>()
  for (const message of messages) {
    if (message.role !== "assistant") continue
    const list = replies.get(message.parentID) ?? []
    list.push(message)
    replies.set(message.parentID, list)
  }

  type Draft = { id: string; title: string; steps: TaskStep[]; requests: Message[]; answers: Message[] }
  const drafts: Draft[] = []
  for (const request of messages) {
    if (request.role !== "user") continue
    const answers = replies.get(request.id) ?? []
    const lists = checklists(answers.flatMap((answer) => parts[answer.id] ?? []))
    if (lists.length === 0) continue
    const last = drafts.at(-1)
    if (last && sameChecklist(last.steps, lists[0]!)) {
      last.steps = lists.at(-1)!
      last.requests.push(request)
      last.answers.push(...answers)
      continue
    }
    drafts.push({
      id: request.id,
      title: requestTitle(request, parts[request.id] ?? []),
      steps: lists.at(-1)!,
      requests: [request],
      answers,
    })
  }

  return drafts
    .map((draft) => {
      const outputs = sessionOutputs(draft.answers.flatMap((answer) => parts[answer.id] ?? []))
      const byFile = new Map<string, TaskCode>()
      for (const request of draft.requests) {
        const diffs: SnapshotFileDiff[] = request.role === "user" ? (request.summary?.diffs ?? []) : []
        for (const diff of diffs) {
          const row = byFile.get(diff.file) ?? { file: diff.file, additions: 0, deletions: 0 }
          row.additions += diff.additions ?? 0
          row.deletions += diff.deletions ?? 0
          byFile.set(diff.file, row)
        }
      }
      // Documents, images and pages are listed under documents, so code is source files only.
      const code = [...byFile.values()].filter((row) => outputGroup(row.file) === "code")
      // Steps left open when the work moved to another project's session are not waiting here.
      const steps = moved(draft.answers.flatMap((answer) => parts[answer.id] ?? []))
        ? draft.steps.map((step) => (CLOSED.has(step.status) ? step : { ...step, status: "cancelled" }))
        : draft.steps
      const inFolder = (path: string) => code.some((row) => path === row.file || path.endsWith(`/${row.file}`))
      return {
        id: draft.id,
        title: draft.title,
        requests: draft.requests.map((request) => request.id),
        steps,
        done: steps.filter((step) => step.status === "completed").length,
        finished: steps.every((step) => CLOSED.has(step.status)),
        cost: draft.answers.reduce((sum, answer) => sum + (answer.role === "assistant" ? answer.cost : 0), 0),
        documents: outputs.filter((item) => item.group !== "code"),
        code,
        elsewhere: outputs.filter((item) => item.group === "code" && !inFolder(item.path)),
        added: code.reduce((sum, row) => sum + row.additions, 0),
        removed: code.reduce((sum, row) => sum + row.deletions, 0),
      }
    })
    .reverse()
}

/** A request that asks the AI to go on with what it was doing, such as the Continue button's message. */
const CONTINUE = /^\s*(continue|go on|keep going|继续|繼續)/i

/**
 * The task the step box above the composer follows: the one the person's latest request belongs to. A new
 * request leaves an earlier unfinished task behind (it stays in the Tasks panel and in its reply) until
 * the AI writes the new request's own steps; a request to continue carries the newest task on.
 */
export function currentTask(messages: Message[], parts: Record<string, Part[] | undefined>): Task | undefined {
  const last = messages.findLast((message) => message.role === "user")
  if (!last) return
  const tasks = sessionTasks(messages, parts)
  const own = tasks.find((task) => task.requests.includes(last.id))
  if (own) return own
  const said = (parts[last.id] ?? []).flatMap((part) => (part.type === "text" && !part.synthetic ? [part.text] : []))
  if (CONTINUE.test(said.join("\n"))) return tasks[0]
}

export type BackgroundJob = { id: string; title: string; started: number; sessionID?: string }

/**
 * Work running on its own while the AI continues: today these are helper agents (the task tool),
 * each in a child session. Finished counts every helper agent that has ended.
 */
export function sessionBackground(parts: Part[]): { running: BackgroundJob[]; finished: number } {
  const running: BackgroundJob[] = []
  let finished = 0
  for (const part of parts) {
    if (part.type !== "tool" || part.tool !== "task") continue
    const state = part.state
    if (state.status === "completed" || state.status === "error") {
      finished += 1
      continue
    }
    if (state.status !== "running") continue
    const input = state.input as { description?: unknown }
    const metadata = (state.metadata ?? {}) as { sessionId?: unknown }
    running.push({
      id: part.id,
      title: state.title || (typeof input.description === "string" ? input.description : "Helper agent"),
      started: state.time.start,
      sessionID: typeof metadata.sessionId === "string" ? metadata.sessionId : undefined,
    })
  }
  return { running, finished }
}
