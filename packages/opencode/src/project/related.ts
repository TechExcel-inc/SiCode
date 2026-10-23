import { existsSync } from "fs"
import path from "path"
import { Filesystem } from "@/util/filesystem"
import { Instance } from "./instance"
import { Project } from "./project"

/**
 * Folders the person linked to this project as related projects (a UI and its server, say). The
 * agent reads and changes them as part of this project: no external-folder prompt, no project_switch.
 */
export namespace Related {
  /** Read fresh each time: the app updates the list while sessions run. */
  export function dirs() {
    const id = Instance.project.id
    const here = Instance.worktree === "/" ? Instance.directory : Instance.worktree
    return (Project.get(id)?.related ?? []).filter((dir) => dir !== here && existsSync(dir)).toSorted()
  }

  export function contains(file: string) {
    return dirs().some((dir) => Filesystem.contains(dir, file))
  }

  export const name = (dir: string) => path.basename(dir)
}
