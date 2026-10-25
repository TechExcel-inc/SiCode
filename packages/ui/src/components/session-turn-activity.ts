import type { Part as PartType, ToolPart, UserMessage } from "@opencode-ai/sdk/v2"

/**
 * Pure helpers for the "clean conversation" turn view: one checklist box per turn, one folded line
 * for the turn's actions, and the live lines that describe what the AI is doing right now.
 */

export type TurnStep = { content: string; status: string }

/** A request's first line, short enough for one line of the task box. */
export function taskLine(text: string) {
  const line = text.trim().split("\n")[0]?.trim() ?? ""
  if (!line) return
  return line.length > 60 ? line.slice(0, 57) + "..." : line
}

/** What the task box calls a request: the name the title model gave it, until then its first line. */
export function taskName(info: Pick<UserMessage, "summary"> | undefined, parts: readonly PartType[]) {
  const title = info?.summary?.title?.trim()
  if (title) return title
  const text = parts.find((part) => part.type === "text" && !part.synthetic && part.text.trim())
  return text?.type === "text" ? taskLine(text.text) : undefined
}

/** Tools that never show as a row: the checklist is drawn once per turn in the task box. */
export const CHECKLIST_TOOLS = new Set(["todowrite"])

/**
 * Tools whose row is the user-facing result and stays visible outside the fold: file edits show their
 * diff, and an answered question shows the user's answers.
 */
export const KEPT_TOOLS = new Set(["edit", "write", "apply_patch", "question"])

function running(part: ToolPart) {
  return part.state.status === "pending" || part.state.status === "running"
}

function steps(value: unknown): TurnStep[] | undefined {
  if (!Array.isArray(value)) return
  return value.flatMap((item: { content?: unknown; status?: unknown }) =>
    item && typeof item.content === "string" ? [{ content: item.content, status: String(item.status ?? "pending") }] : [],
  )
}

/** The steps one todowrite call wrote, preferring the tool's result over its input. */
export function checklistOf(part: PartType): TurnStep[] | undefined {
  if (part.type !== "tool" || !CHECKLIST_TOOLS.has(part.tool)) return
  const state = part.state as { metadata?: { todos?: unknown }; input?: { todos?: unknown } }
  const result = steps(state.metadata?.todos)
  if (result?.length) return result
  const input = steps(state.input?.todos)
  if (input?.length) return input
}

/** The turn's latest checklist: the last todowrite call (in order) that carries steps. */
export function latestChecklist(parts: readonly PartType[]): TurnStep[] | undefined {
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]
    if (!part) continue
    const list = checklistOf(part)
    if (list) return list
  }
}

export function checklistProgress(list: readonly TurnStep[]) {
  return { done: list.filter((step) => step.status === "completed").length, total: list.length }
}

/**
 * A reply's checklist folds to one line once the turn has stopped and every step is completed or
 * cancelled; while the AI works, or with any step still pending or in progress, it stays open.
 */
export function checklistFolds(list: readonly TurnStep[], working: boolean) {
  if (working || list.length === 0) return false
  return list.every((step) => step.status === "completed" || step.status === "cancelled")
}

/** True for a tool call that is folded into the turn's single "N actions" line. */
export function isFoldedAction(part: PartType) {
  if (part.type !== "tool") return false
  if (CHECKLIST_TOOLS.has(part.tool)) return false
  if (KEPT_TOOLS.has(part.tool)) return false
  return true
}

export type Folded<T> = { type: "item"; item: T } | { type: "actions"; items: T[] }

/**
 * Collapses every folded item into one "actions" entry placed where the first folded item was; all
 * other items keep their order around it.
 */
export function foldActions<T>(items: readonly T[], folded: (item: T) => boolean): Folded<T>[] {
  const result: Folded<T>[] = []
  let actions: { type: "actions"; items: T[] } | undefined
  for (const item of items) {
    if (!folded(item)) {
      result.push({ type: "item", item })
      continue
    }
    if (!actions) {
      actions = { type: "actions", items: [] }
      result.push(actions)
    }
    actions.items.push(item)
  }
  return result
}

export type CurrentAction = { key: string; params: Record<string, string> }

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function filename(value: unknown) {
  const path = text(value)
  if (!path) return
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

/** The i18n key and parameters describing one running tool call, e.g. "Reading agent-edits.tsx". */
export function describeAction(part: ToolPart): CurrentAction {
  const input = (part.state.input ?? {}) as Record<string, unknown>
  const title = text((part.state as { title?: unknown }).title)
  const pick = (key: string, value: string | undefined) =>
    value ? { key, params: { value } } : { key: `${key}.bare`, params: {} as Record<string, string> }
  switch (part.tool) {
    case "read":
      return pick("ui.sessionTurn.live.read", filename(input.filePath))
    case "list":
      return pick("ui.sessionTurn.live.list", filename(input.path))
    case "glob":
    case "grep":
      return pick("ui.sessionTurn.live.search", text(input.pattern))
    case "codesearch":
      return pick("ui.sessionTurn.live.search", text(input.query))
    case "websearch":
      return pick("ui.sessionTurn.live.searchWeb", text(input.query))
    case "webfetch":
      return pick("ui.sessionTurn.live.fetch", text(input.url))
    case "bash":
      return pick("ui.sessionTurn.live.run", text(input.description) ?? text(input.command) ?? title)
    case "edit":
    case "write":
      return pick("ui.sessionTurn.live.edit", filename(input.filePath))
    case "apply_patch":
      return pick("ui.sessionTurn.live.edit", undefined)
    case "task":
      return pick("ui.sessionTurn.live.delegate", text(input.description))
    case "todowrite":
      return pick("ui.sessionTurn.live.checklist", undefined)
    case "question":
      return pick("ui.sessionTurn.live.question", undefined)
    default:
      return { key: "ui.sessionTurn.live.tool", params: { value: title ?? part.tool } }
  }
}

/**
 * What the turn is doing now: the latest running tool call that is not a helper agent (helpers have
 * their own line), or a running helper when nothing else runs. Undefined means "Thinking".
 */
export function currentAction(parts: readonly PartType[]): CurrentAction | undefined {
  let helper: ToolPart | undefined
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]
    if (!part || part.type !== "tool" || !running(part)) continue
    if (part.tool === "task") {
      helper ??= part
      continue
    }
    return describeAction(part)
  }
  if (helper) return describeAction(helper)
}

/** Helper agents (task tool calls) still running in the turn. */
export function runningHelpers(parts: readonly PartType[]) {
  return parts.filter((part) => part.type === "tool" && part.tool === "task" && running(part)).length
}

/** Tool calls the turn has finished, helpers included: how far a long turn has come. */
export function doneActions(parts: readonly PartType[]) {
  return parts.filter((part) => part.type === "tool" && part.state.status === "completed").length
}

/** Elapsed time split for display: "45s", "2m 10s", "1h 3m". */
export function elapsedParts(ms: number): { key: string; params: Record<string, number> } {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return { key: "ui.sessionTurn.live.elapsed.hours", params: { hours, minutes } }
  if (minutes > 0) return { key: "ui.sessionTurn.live.elapsed.minutes", params: { minutes, seconds } }
  return { key: "ui.sessionTurn.live.elapsed.seconds", params: { seconds } }
}

/** The kinds of model failure the conversation explains in plain words. */
export type ErrorKind = "signin" | "tooLong" | "busy" | "unreachable" | "refused" | "failed"

/**
 * Sorts a failed reply's error into a kind a person can act on. `error` is the reply's error as the
 * server stored it; the provider's own text is only read for clues and is still shown under Details.
 */
export function errorKind(error: { name?: string; data?: { message?: unknown; statusCode?: unknown } } | undefined): ErrorKind {
  const name = error?.name ?? ""
  const text = String(error?.data?.message ?? "").toLowerCase()
  const status =
    typeof error?.data?.statusCode === "number"
      ? error.data.statusCode
      : Number(/^\W*(\d{3})\s/.exec(text)?.[1] ?? 0)
  if (name === "ProviderAuthError" || status === 401 || status === 403 || /unauthori[sz]ed|invalid api key|authentication/.test(text))
    return "signin"
  if (name === "ContextOverflowError" || /context[ _]length|context window|maximum context|too many tokens/.test(text)) return "tooLong"
  if (status === 429 || /rate limit|quota|insufficient|overloaded/.test(text)) return "busy"
  if (status >= 500 || /timed? ?out|econn|fetch failed|network|unavailable|could not reach/.test(text)) return "unreachable"
  if (status === 400 || /invalid_request|unsupported|not supported|bad request/.test(text)) return "refused"
  return "failed"
}
