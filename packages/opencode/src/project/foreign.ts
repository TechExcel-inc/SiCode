import { existsSync } from "fs"
import path from "path"
import { Flag } from "@/flag/flag"
import { Filesystem } from "@/util/filesystem"
import { Instance } from "./instance"
import { Project } from "./project"

/**
 * The other projects on this machine. A session works in its own project; when the work turns to
 * another one, the agent asks (project_switch) whether to move it to a session there.
 */
export namespace Foreign {
  /** project_switch asks through the question dock, which these clients show. */
  export function enabled() {
    return ["app", "cli", "desktop"].includes(Flag.OPENCODE_CLIENT) || Flag.OPENCODE_ENABLE_QUESTION_TOOL
  }

  /** Edits to another project are held until project_switch is answered: only where the app answers it. */
  export function guarded() {
    return ["app", "desktop"].includes(Flag.OPENCODE_CLIENT)
  }

  export function name(project: Pick<Project.Info, "name" | "worktree">) {
    return project.name || path.basename(project.worktree)
  }

  /** This session's project name. A folder outside git has no worktree, so its own name is used. */
  export function here() {
    return name({
      name: Instance.project.name,
      worktree: Instance.worktree === "/" ? Instance.directory : Instance.worktree,
    })
  }

  /** Known projects other than this session's, by folder: a stable order keeps the system prompt cacheable. */
  export function projects() {
    const id = Instance.project.id
    return Project.list()
      .filter((item) => item.id !== id && item.worktree !== "/" && existsSync(item.worktree))
      .toSorted((a, b) => a.worktree.localeCompare(b.worktree))
  }

  /** The other project a path belongs to; the deepest one when projects are nested. */
  export function owner(file: string) {
    return projects()
      .filter((item) => [item.worktree, ...item.sandboxes].some((dir) => Filesystem.contains(dir, file)))
      .toSorted((a, b) => b.worktree.length - a.worktree.length)[0]
  }

  /**
   * The other project the agent named: its folder, a path inside it, or its name (models often give the
   * name). A relative path is never resolved against the server's own folder.
   */
  export function find(input: string) {
    const list = projects()
    const key = input.trim().toLowerCase()
    return (
      list.find((item) => item.worktree === input) ??
      (path.isAbsolute(input)
        ? owner(input)
        : list.find((item) => name(item).toLowerCase() === key || path.basename(item.worktree).toLowerCase() === key))
    )
  }

  /** Projects the person chose to keep working on from a session, by session. */
  const kept = new Map<string, Set<string>>()

  export function keep(session: string, worktree: string) {
    kept.set(session, new Set([...(kept.get(session) ?? []), worktree]))
  }

  export function stays(session: string, worktree: string) {
    return kept.get(session)?.has(worktree) === true
  }
}
