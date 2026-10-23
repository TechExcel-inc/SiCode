import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { runCommands } from "../../src/session/system"
import { AppRun } from "../../src/tool/app-run"
import { Job } from "../../src/tool/job"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("run commands", () => {
  test("saving some commands keeps the others, and an empty value clears one", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)
    await Project.update({ projectID: project.id, commands: { start: "bun install", dev: "bun dev", port: 3000 } })
    // The workspace dialog only knows the startup script.
    await Project.update({ projectID: project.id, commands: { start: "bun i" } })
    expect(Project.get(project.id)?.commands).toEqual({ start: "bun i", dev: "bun dev", port: 3000 })
    await Project.update({ projectID: project.id, commands: { dev: "", build: "bun run build" } })
    expect(Project.get(project.id)?.commands).toEqual({ start: "bun i", port: 3000, build: "bun run build" })
    await Project.update({ projectID: project.id, commands: { port: 0 } })
    expect(Project.get(project.id)?.commands).toEqual({ start: "bun i", build: "bun run build" })
  })

  test("the agent is told which run commands the project has", async () => {
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(runCommands()).toEqual([])
        await Project.update({ projectID: project.id, commands: { dev: "bun dev", port: 4444, build: "bun run build" } })
        const [text] = runCommands()
        expect(text).toContain("dev server (port 4444), build")
        expect(text).not.toContain("install and reopen")
        expect(text).toContain("app_run")
      },
    })
  })

  test("the dev server is ready once its port answers, and a server that exits is caught", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const port = 20000 + Math.floor(Math.random() * 20000)
        const server = AppRun.start({
          sessionID: "ses_test",
          agent: "build",
          command: `${process.execPath} -e "Bun.serve({ port: ${port}, fetch: () => new Response('ok') }); console.log('listening')"`,
          description: "Dev server",
        })
        AppRun.remember(server.id)
        expect(await AppRun.ready(server.id, port, 20_000)).toBe("ready")
        expect(AppRun.running()?.id).toBe(server.id)
        Job.stop(server.id)

        const broken = AppRun.start({ sessionID: "ses_test", agent: "build", command: "exit 1", description: "Dev server" })
        expect(await AppRun.ready(broken.id, port + 1, 20_000)).toBe("ended")
      },
    })
  })
})
