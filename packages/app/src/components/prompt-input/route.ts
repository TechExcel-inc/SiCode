import type { SessionRoute } from "@opencode-ai/sdk/v2/client"

/**
 * Whether a request is checked before it runs (the server's session.route): only plain text sent in a
 * top-level session that already has an earlier request. Commands go where they were typed.
 */
export function routable(input: { text: string; users: number; parentID?: string; oneTime?: boolean }) {
  if (input.parentID || input.oneTime || input.users === 0) return false
  const text = input.text.trim()
  return text.length > 0 && !text.startsWith("/")
}

/** The folder a moved request starts in: the other project's for where=project, else this session's. */
export function routeFolder(result: SessionRoute, here: string) {
  if (result.where === "project" && result.directory) return result.directory
  return here
}

/** The new task's name for the toast: the model's, else the request's first line. */
export function routeTitle(result: SessionRoute, text: string) {
  if (result.title?.trim()) return result.title.trim()
  const line = text.trim().split("\n")[0] ?? ""
  return line.length > 60 ? `${line.slice(0, 57)}...` : line
}
