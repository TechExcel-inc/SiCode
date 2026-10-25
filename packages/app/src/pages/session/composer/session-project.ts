import type { FilePartInput, Part, QuestionRequest, TextPartInput } from "@opencode-ai/sdk/v2"

export type ProjectSwitch = { project: string; prompt: string }

/** The project_switch call a question belongs to, or undefined for an ordinary question. */
export function projectSwitch(request: QuestionRequest, parts: Record<string, Part[] | undefined>) {
  const tool = request.tool
  if (!tool) return
  const part = parts[tool.messageID]?.find((item) => item.type === "tool" && item.callID === tool.callID)
  if (part?.type !== "tool" || part.tool !== "project_switch") return
  const input = part.state.input as Partial<ProjectSwitch>
  // The tool's metadata holds the project folder it resolved; the input may be only the project's name.
  const meta = "metadata" in part.state ? (part.state.metadata as { project?: unknown } | undefined) : undefined
  const project = typeof meta?.project === "string" && meta.project ? meta.project : input.project
  if (typeof project !== "string" || !project) return
  return { project, prompt: typeof input.prompt === "string" ? input.prompt : "" }
}

/** What the new session starts with: the person's own first message, or the agent's brief mid-conversation. */
export function carried(input: { fresh: boolean; parts: Part[]; prompt: string; from: string }) {
  if (!input.fresh) {
    return [{ type: "text" as const, text: `${input.prompt}\n\n(Continued from a session in ${input.from}.)` }]
  }
  return input.parts.flatMap((part): Array<TextPartInput | FilePartInput> => {
    if (part.type === "text" && !part.synthetic && part.text.trim()) return [{ type: "text", text: part.text }]
    if (part.type === "file") return [{ type: "file", mime: part.mime, url: part.url, filename: part.filename }]
    return []
  })
}

export type SessionSuggestion = { title: string; project?: string; reason?: string }

/** The suggest_session call a question belongs to, or undefined for any other question. */
export function sessionSuggestion(
  request: QuestionRequest,
  parts: Record<string, Part[] | undefined>,
): SessionSuggestion | undefined {
  const tool = request.tool
  if (!tool) return
  const part = parts[tool.messageID]?.find((item) => item.type === "tool" && item.callID === tool.callID)
  if (part?.type !== "tool" || part.tool !== "suggest_session") return
  const input = part.state.input as Partial<SessionSuggestion>
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined)
  return { title: text(input.title) ?? "", project: text(input.project), reason: text(input.reason) }
}

type Named = { name?: string; worktree: string }

const norm = (dir: string) => dir.replaceAll("\\", "/").replace(/\/+$/, "")
const folder = (dir: string) => norm(dir).split("/").at(-1) ?? ""

/**
 * The project a suggestion names, matched case-insensitively on its display name or folder name. Undefined
 * when nothing matches or the match is the current project: the new session then starts here.
 */
export function suggestedProject(name: string | undefined, projects: Named[], current: string) {
  const key = name?.trim().toLowerCase()
  if (!key) return
  const hit =
    projects.find((item) => item.name?.trim().toLowerCase() === key) ??
    projects.find((item) => folder(item.worktree).toLowerCase() === key)
  if (!hit || norm(hit.worktree) === norm(current)) return
  return { worktree: hit.worktree, name: hit.name?.trim() || folder(hit.worktree) }
}

export type SuggestionAction = "new" | "close" | "continue"
export type SuggestionButton = { action: SuggestionAction; key: string; params?: Record<string, string> }

/** The card's buttons: in another project the two "new session" buttons name it. */
export function suggestionButtons(project?: string): SuggestionButton[] {
  if (project) {
    return [
      { action: "new", key: "session.suggest.newIn", params: { project } },
      { action: "close", key: "session.suggest.newInClose", params: { project } },
      { action: "continue", key: "session.suggest.continue" },
    ]
  }
  return [
    { action: "new", key: "session.suggest.new" },
    { action: "close", key: "session.suggest.newClose" },
    { action: "continue", key: "session.suggest.continue" },
  ]
}

/** The reply the suggest_session tool reads: moved carries the new session and its folder. */
export function suggestionAnswer(choice: { moved: false } | { moved: true; sessionID: string; directory: string }) {
  if (!choice.moved) return [["continue"]]
  return [["moved", choice.sessionID, choice.directory]]
}

/** The user message that started the turn the suggestion was made in. */
export function suggestedMessage<M extends { id: string; role: string; parentID?: string }>(
  request: QuestionRequest,
  messages: M[],
): M | undefined {
  const assistant = request.tool ? messages.find((item) => item.id === request.tool!.messageID) : undefined
  const parent = assistant?.parentID ? messages.find((item) => item.id === assistant.parentID) : undefined
  if (parent?.role === "user") return parent
  return messages.findLast((item) => item.role === "user")
}
