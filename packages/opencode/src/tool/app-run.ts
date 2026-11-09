import { existsSync } from "fs"
import path from "path"
import z from "zod"
import { Effect } from "effect"
import { suggestFrom } from "@opencode-ai/util/run-suggest"
import { Flag } from "@/flag/flag"
import { Question } from "../question"
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

  export const answers = (port: number) =>
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

  /** What the project's own files suggest, the same as Edit project → Run → Suggest commands. */
  export function suggest() {
    const dir = Instance.directory
    return suggestFrom(
      (file) =>
        Bun.file(path.join(dir, file))
          .text()
          .catch(() => ""),
      (file) => existsSync(path.resolve(dir, file)),
    )
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
    .enum(["dev", "build", "install", "deploy", "stop"])
    .describe(
      "dev: start the dev server (or reuse the running one) and get its address; build: build the app; install: put the new build in place and open it; deploy: deploy the app to its server; stop: stop the dev server",
    ),
})

const SAVE = "Save and run"

const LABELS = { dev: "Dev server", port: "Port", build: "Build", install: "Install and reopen", deploy: "Deploy" } as const

type Metadata = { job?: string }

async function run(params: z.infer<typeof parameters>, ctx: Tool.Context<Metadata>) {
  const saved = AppRun.commands()
  const missing = (what: string) => ({
    title: `No ${what} command`,
    output: `This project has no saved ${what} command, and its files do not suggest one. Ask the user to add it in Edit project → Run.`,
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
    // Another app on this port would answer for the dev server, and the AI would check the wrong app.
    if (saved.port && (await AppRun.answers(saved.port))) {
      return {
        title: `Port ${saved.port} is in use`,
        output: `Another app already answers at ${url}, so the dev server was not started. Tell the user: they can close that app or change the port in Edit project → Run. Do not check this address as the project's app.`,
        metadata: {},
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

  const command = { build: saved.build, install: saved.install, deploy: saved.deploy }[params.action]
  if (!command) return missing(params.action)
  const what = { build: "Build the app", install: "Install and reopen the app", deploy: "Deploy the app" }[params.action]
  const job = AppRun.start({ sessionID: ctx.sessionID, agent: ctx.agent, command, description: what })
  return {
    title: what,
    output: `Started in the background as ${job.id}: \`${command}\`. You will get a message with the result when it ends; carry on with other work or end your reply meanwhile.`,
    metadata: { job: job.id },
  }
}

export const AppRunTool = Tool.define<typeof parameters, Metadata, Question.Service>(
  "app_run",
  Effect.gen(function* () {
    const question = yield* Question.Service

    return {
      description: DESCRIPTION,
      parameters,
      execute: (params: z.infer<typeof parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          // Nothing saved for this action yet: the user approves what the project's files suggest, once.
          const asks = ["app", "cli", "desktop"].includes(Flag.OPENCODE_CLIENT) || Flag.OPENCODE_ENABLE_QUESTION_TOOL
          const found =
            asks && params.action !== "stop" && !AppRun.commands()[params.action]
              ? yield* Effect.promise(() => AppRun.suggest())
              : undefined
          if (found && params.action !== "stop" && found[params.action]) {
            const saved = AppRun.commands()
            const fresh = Object.fromEntries(
              (["dev", "port", "build", "install", "deploy"] as const).flatMap((key) =>
                found[key] && !saved[key] ? [[key, found[key]]] : [],
              ),
            )
            const lines = (["dev", "port", "build", "install", "deploy"] as const).flatMap((key) =>
              fresh[key] ? [`${LABELS[key]}: ${fresh[key]}`] : [],
            )
            const answers = yield* question.ask({
              sessionID: ctx.sessionID,
              questions: [
                {
                  question: `Save these run commands for this project?\n\n${lines.join("\n")}`,
                  header: "Run commands",
                  custom: false,
                  options: [
                    { label: SAVE, description: "SiCode uses them from now on. Edit them any time in Edit project → Run." },
                    { label: "Not now", description: "Nothing is saved and nothing runs." },
                  ],
                },
              ],
              tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
            })
            if (answers[0]?.[0] !== SAVE) {
              return {
                title: "Run commands not saved",
                output: "The user chose not to save these commands, so nothing ran. Do not run them another way or ask again.",
                metadata: {},
              }
            }
            yield* Effect.promise(() => Project.update({ projectID: Instance.project.id, commands: fresh }))
          }
          return yield* Effect.promise(() => run(params, ctx))
        }).pipe(Effect.orDie),
    }
  }),
)
