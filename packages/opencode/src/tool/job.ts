import fs from "fs"
import path from "path"
import z from "zod"
import { Effect } from "effect"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { Tool } from "./tool"
import DESCRIPTION from "./job.txt"

/**
 * Shell commands that run in the background (long builds, dev servers): the shell tool starts them and
 * returns at once. When one ends, the session gets a short message with the exit code and the last
 * lines of output, which continues the agent's work: it wakes an idle session, and a busy one reads it
 * at its next step.
 */
export namespace Job {
  export type Info = {
    id: string
    sessionID: string
    agent: string
    command: string
    description: string
    cwd: string
    file: string
    started: number
    ended?: number
    code?: number | null
    stopped?: boolean
  }

  /** Lines of output kept in the message that says a job ended. */
  const TAIL = 30

  const jobs = new Map<string, Info>()
  const procs = new Map<string, ReturnType<typeof Bun.spawn>>()
  const state = { next: 0 }

  // Jobs end with SiCode: none keeps running after the server stops.
  process.once("exit", () => procs.forEach((proc) => kill(proc)))

  function kill(proc: ReturnType<typeof Bun.spawn>) {
    // The command runs in its own process group, so its children (a build's compilers, a dev
    // server's workers) stop with it.
    if (process.platform !== "win32" && proc.pid) {
      try {
        process.kill(-proc.pid, "SIGTERM")
        return
      } catch {}
    }
    proc.kill()
  }

  export function tail(file: string, lines = TAIL) {
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
    return text.trimEnd().split("\n").slice(-lines).join("\n")
  }

  export function duration(ms: number) {
    const total = Math.round(ms / 1000)
    const minutes = Math.floor(total / 60)
    return minutes > 0 ? `${minutes}m ${total % 60}s` : `${total}s`
  }

  /** What the session is told when a job ends. */
  export function notice(job: Info) {
    const took = duration((job.ended ?? Date.now()) - job.started)
    const how = job.stopped
      ? "was stopped"
      : job.code === 0
        ? "finished successfully"
        : `failed with exit code ${job.code ?? "unknown"}`
    const last = tail(job.file)
    return [
      `Background job ${job.id} ${how} after ${took}: \`${job.command}\` (${job.description}).`,
      last ? `Last lines of output:\n\`\`\`\n${last}\n\`\`\`` : "It printed nothing.",
      `Full output: ${job.file}`,
      `Continue the work that was waiting on this job, and tell the user the result.`,
    ].join("\n")
  }

  export function start(input: {
    sessionID: string
    agent: string
    command: string
    description: string
    cwd: string
    shell: string
    env: NodeJS.ProcessEnv
  }) {
    const id = `job-${++state.next}`
    const dir = path.join(Global.Path.data, "jobs")
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${Date.now()}-${id}.log`)
    const out = fs.openSync(file, "a")
    const proc = Bun.spawn({
      cmd: process.platform === "win32" ? [input.shell, "/c", input.command] : [input.shell, "-c", input.command],
      cwd: input.cwd,
      env: input.env,
      stdin: "ignore",
      stdout: out,
      stderr: out,
      detached: process.platform !== "win32",
    })
    fs.closeSync(out)
    const job: Info = {
      id,
      sessionID: input.sessionID,
      agent: input.agent,
      command: input.command,
      description: input.description,
      cwd: input.cwd,
      file,
      started: Date.now(),
    }
    jobs.set(id, job)
    procs.set(id, proc)
    // Runs later, outside the tool call: keep this project's context for the message it sends.
    const done = Instance.bind(async (code: number | null) => {
      procs.delete(id)
      job.ended = Date.now()
      job.code = code
      const { SessionPrompt } = await import("../session/prompt")
      await SessionPrompt.prompt({
        sessionID: input.sessionID as never,
        agent: input.agent,
        parts: [
          {
            type: "text",
            synthetic: true,
            text: notice(job),
            metadata: { job: { id, command: job.command, code, stopped: !!job.stopped, ms: job.ended - job.started } },
          },
        ],
      }).catch(() => undefined)
    })
    void proc.exited.then(done, () => done(null))
    return job
  }

  export function stop(id: string) {
    const proc = procs.get(id)
    const job = jobs.get(id)
    if (!proc || !job) return false
    job.stopped = true
    kill(proc)
    return true
  }

  export const get = (id: string) => jobs.get(id)
  export const running = (id: string) => procs.has(id)

  export function list(sessionID: string) {
    return [...jobs.values()].filter((job) => job.sessionID === sessionID)
  }
}

const parameters = z.object({
  action: z.enum(["list", "output", "stop"]).describe("list this session's jobs, read one job's output, or stop one"),
  id: z.string().optional().describe("The job id (for output and stop), for example job-1"),
  lines: z.number().optional().describe("How many of the last output lines to read (default 50)"),
})

export const JobTool = Tool.define(
  "job",
  Effect.succeed({
    description: DESCRIPTION,
    parameters,
    execute: (params: z.infer<typeof parameters>, ctx: Tool.Context) =>
      Effect.sync(() => {
        if (params.action === "list") {
          const list = Job.list(ctx.sessionID)
          const output = list.length
            ? list
                .map((job) => {
                  const state = Job.running(job.id)
                    ? `running for ${Job.duration(Date.now() - job.started)}`
                    : job.stopped
                      ? "stopped"
                      : `ended with exit code ${job.code ?? "unknown"}`
                  return `${job.id}: ${state} — \`${job.command}\` (${job.description})`
                })
                .join("\n")
            : "No background jobs in this session."
          return { title: "Background jobs", output, metadata: {} }
        }
        const job = params.id ? Job.get(params.id) : undefined
        if (!job || job.sessionID !== ctx.sessionID) {
          return { title: "No such job", output: `There is no background job ${params.id ?? ""} in this session.`, metadata: {} }
        }
        if (params.action === "stop") {
          const done = Job.stop(job.id)
          return {
            title: `Stopped ${job.id}`,
            output: done ? `Stopping ${job.id}; you will get its last output when it ends.` : `${job.id} had already ended.`,
            metadata: {},
          }
        }
        const output = Job.tail(job.file, params.lines ?? 50)
        return {
          title: `Output of ${job.id}`,
          output: output || "(no output yet)",
          metadata: {},
        }
      }),
  }),
)
