export namespace Brand {
  export const app = "sicode"
  export const project = ".sicode"
  export const managed = "ai.sicode.managed"
  export const config = "sicode"
  export const db = "sicode.db"

  /** The names before SiCode: data is moved from them once, and projects that still use them are read. */
  export const legacy = {
    app: "kloudcode",
    project: ".kloudcode",
    config: "kloudcode",
    db: "kloudcode.db",
  }

  /** Project settings folders, the old name too. */
  export const projects = [project, legacy.project]
  /** Settings file names, old first so the current name wins when both exist. */
  export const configs = [legacy.config, config]

  export const isProject = (dir: string) => projects.some((name) => dir.endsWith(name))
  export const files = (dir: string) => configs.flatMap((name) => [`${dir}/${name}.json`, `${dir}/${name}.jsonc`])
}
