import z from "zod"
import { Effect } from "effect"
import { Instance } from "../project/instance"
import { Project } from "../project/project"
import { Shell } from "@/shell/shell"
import { Tool } from "./tool"
import { Job } from "./job"
import DESCRIPTION from "./app-run.txt"

/**
 * Runs the app with the commands the user saved for the project (Edit project → Run): the dev server,
 * the build, and installing the new build. It never runs anything else. Builds and installs run in
 * the background like the shell tool's background jobs; the dev server keeps running, one per project.
 */
export namespace AppRun {
  /** The dev server's job, by project folder. */
  const dev = new Map<string, string>()

  /** How long to wait for a dev server's port to answer. */
  const WAIT = 90_000

  export function commands() {
    return Project.get(Instance.project.id)?.commands ?? {}
  }

  const answers = (port: number) =>
    fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(2_000) }).then(
      () => true,
      () => false,
    )

  /** Waits until the port answers, or the job ends, or time runs out. */
  export async function ready(job: string, port: number, wait = WAIT) {
    const end = Date.now() + wait
    while (Date.now() < end) {
      if (await answers(port)) return "ready" as const
      if (!Job.running(job)) return "ended" as const
      await Bun.sleep(500)
    }
    return "slow" as const
  }

  export function running() {
    const id = dev.get(Instance.directory)
    return id && Job.running(id) ? Job.get(id) : undefined
  }

  export function start(input: { sessionID: string; agent: string; command: string; description: string }) {
    return Job.start({
      ...input,
      cwd: Instance.directory,
      shell: Shell.acceptable(),
      env: process.env,
    })
  }

  export function remember(job: string) {
    dev.set(Instance.directory, job)
  }
}

const parameters = z.object({
  action: z
    .enum(["dev", "build", "install", "stop"])
    .describe(
      "dev: start the dev server (or reuse the running one) and get its address; build: build the app; install: put the new build in place and open it; stop: stop the dev server",
    ),
})

export const AppRunTool = Tool.define(
  "app_run",
  Effect.succeed({
    description: DESCRIPTION,
    parameters,
    execute: (params: z.infer<typeof parameters>, ctx: Tool.Context) =>
      Effect.promise(async () => {
        const saved = AppRun.commands()
        const missing = (what: string) => ({
          title: `No ${what} command`,
          output: `This project has no saved ${what} command. Ask the user to add it in Edit project → Run (Suggest commands can fill it in), or run the command with the shell tool if they tell you what it is.`,
          metadata: {},
        })

        if (params.action === "stop") {
          const job = AppRun.running()
          if (!job) return { title: "Dev server not running", output: "No dev server is running for this project.", metadata: {} }
          Job.stop(job.id)
          return { title: "Stopping the dev server", output: `Stopping ${job.id}.`, metadata: { job: job.id } }
        }

        if (params.action === "dev") {
          if (!saved.dev) return missing("dev server")
          const url = saved.port ? `http://localhost:${saved.port}` : undefined
          const running = AppRun.running()
          if (running) {
            return {
              title: "Dev server already running",
              output: `The dev server is already running as ${running.id}${url ? ` at ${url}` : ""}.`,
              metadata: { job: running.id },
            }
          }
          const job = AppRun.start({
            sessionID: ctx.sessionID,
            agent: ctx.agent,
            command: saved.dev,
            description: "Dev server",
          })
          AppRun.remember(job.id)
          if (!saved.port) {
            await Bun.sleep(5_000)
            return {
              title: "Started the dev server",
              output: `Started the dev server as ${job.id}. No port is saved for it, so read its address from the output so far:\n${Job.tail(job.file)}`,
              metadata: { job: job.id },
            }
          }
          const state = await AppRun.ready(job.id, saved.port)
          const output = {
            ready: `The dev server is running at ${url} (${job.id}).`,
            ended: `The dev server stopped before it answered at ${url}. Its last output:\n${Job.tail(job.file)}`,
            slow: `The dev server (${job.id}) has not answered at ${url} yet. Its last output:\n${Job.tail(job.file)}`,
          }[state]
          return { title: state === "ready" ? `Dev server at ${url}` : "Dev server not ready", output, metadata: { job: job.id } }
        }

        const command = params.action === "build" ? saved.build : saved.install
        if (!command) return missing(params.action === "build" ? "build" : "install")
        const what = params.action === "build" ? "Build the app" : "Install and reopen the app"
        const job = AppRun.start({ sessionID: ctx.sessionID, agent: ctx.agent, command, description: what })
        return {
          title: what,
          output: `Started in the background as ${job.id}: \`${command}\`. You will get a message with the result when it ends; carry on with other work or end your reply meanwhile.`,
          metadata: { job: job.id },
        }
      }),
  }),
)
