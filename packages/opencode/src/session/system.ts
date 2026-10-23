import { Context, Effect, Layer } from "effect"

import { Instance } from "../project/instance"
import { Foreign } from "../project/foreign"
import { Related } from "../project/related"
import { Project } from "../project/project"
import { Flag } from "../flag/flag"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_GPT from "./prompt/gpt.txt"
import PROMPT_KIMI from "./prompt/kimi.txt"

import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"

/** The other projects, so the agent can tell when work belongs in another project's session. */
export function others() {
  const related = Related.dirs()
  const linked = related.length
    ? [
        [
          `Related projects of ${Foreign.here()}, linked by the user so one session can change them together (for example a UI and its server):`,
          ...related.map((dir) => `  - ${Related.name(dir)}: ${dir}`),
          `Read and change files in these folders directly as part of this work, without project_switch. Each folder is its own git repository: run git commands in the folder you changed.`,
        ].join("\n"),
      ]
    : []
  if (!Foreign.enabled()) return linked
  const list = Foreign.projects()
    .filter((item) => !related.includes(item.worktree))
    .slice(0, 30)
  if (list.length === 0) return linked
  return [
    ...linked,
    [
      `This session works in the project ${Foreign.here()}. Other projects on this machine:`,
      ...list.map((item) => `  - ${Foreign.name(item)}: ${item.worktree}`),
      `When the user's request is for one of these projects rather than ${Foreign.here()}, call the project_switch tool before doing the work.`,
    ].join("\n"),
  ]
}

/** The desktop app shows images in replies as thumbnails that open large; terminals cannot. */
export function visuals(client: string) {
  if (client !== "desktop") return []
  return [
    [
      `The user reads your replies in the EAD SiCode desktop app, which shows images inside the conversation as thumbnails that open large on click.`,
      `When you show something visual (icon or logo options, diagrams, mockups, generated images), show it in your reply instead of opening a browser, a full-window page or an HTML preview file (for example in /tmp):`,
      `  - For SVG, put each complete <svg>...</svg> in its own \`\`\`svg code block. Each block appears as a picture, with its code one click away.`,
      `  - For image files, save them inside the project (for example under a designs/ folder) and reference them with markdown image syntax, such as ![Option A](designs/option-a.png). Images outside the project folder are not shown.`,
      `  - Images from http(s) URLs can be shown with the same syntax.`,
      `Label each option with a letter and a short name (for example "A. Hub & Spoke"). Several sizes or states of one option can sit side by side in the same reply.`,
      `After showing the options, ask the user which one they want with the question tool, one choice per option letter, and set each choice's image to that option's picture (its complete <svg>...</svg>, or its image path inside the project). The app shows those choices as picture cards the user can enlarge and pick with one click.`,
      `Before you show design options as SVG, check them with the design_review tool when it is available: a model that can see draws them as the app shows them and compares them with the person's image. Fix the options it marks "fix" and check again, at most two rounds, and show only options that pass.`,
    ].join("\n"),
  ]
}

/**
 * The desktop app shows the todo list as a step box above the input, one per request, and a list left with
 * open steps tells the user the session waits on them; so the list has to follow the requests.
 */
export function stepGuidance(client: string) {
  if (client !== "desktop") return []
  return [
    [
      `The desktop app shows your todo list as a step box above the user's input, one box per request. A list that still has pending or in-progress steps when you stop tells the user you are waiting for them.`,
      `  - When the user sends a new, different request, start a new list for it with todowrite. Do not carry over steps from an earlier request.`,
      `  - Before you end a reply, bring the list up to date: mark finished steps completed. If steps will not be done now (the user postponed or dropped them, or they turned out unnecessary), mark them cancelled.`,
      `  - When the user asks you to continue, keep the same list and carry on with its open steps.`,
    ].join("\n"),
  ]
}

/**
 * Check before claiming: like Claude Code, the agent proves a change with the project's own tests (and,
 * once the app can be started and looked at, on screen) and says plainly what it could not check.
 */
export function verification() {
  return [
    [
      `Check your work before you say it is done:`,
      `  - After changing code, run the tests that cover the change with the project's own test command: one targeted test file for a small change, the full suite before a commit. Run the project's type check too when it has one.`,
      `  - Report the result in one line ("Tests: 24 passed", or the failing test and its error). If a check fails, fix it or say so; do not end with "done" while a check fails.`,
      `  - When something cannot be checked (no tests cover it, it needs a sign-in, or it is a visible change you cannot look at), say exactly what was not checked instead of claiming it works.`,
      `  - Keep checks in proportion: do not run a long suite for a one-line text change.`,
      `Never write "fixed", "works" or "done" without a test result or another check behind it.`,
    ].join("\n"),
  ]
}

/** The run commands the user saved for the project (Edit project → Run), so the agent runs the app with them. */
export function runCommands() {
  const saved = Project.get(Instance.project.id)?.commands ?? {}
  const list = [
    saved.dev ? `dev server${saved.port ? ` (port ${saved.port})` : ""}` : "",
    saved.build ? "build" : "",
    saved.install ? "install and reopen" : "",
  ].filter(Boolean)
  if (list.length === 0) return []
  return [
    `This project has saved run commands: ${list.join(", ")}. Use the app_run tool to run them instead of guessing commands: dev before you look at a change in the browser, build and install when the user wants the app rebuilt.`,
  ]
}

export namespace SystemPrompt {
  export function provider(model: Provider.Model) {
    if (model.api.id.includes("gpt-4") || model.api.id.includes("o1") || model.api.id.includes("o3"))
      return [PROMPT_BEAST]
    if (model.api.id.includes("gpt")) {
      if (model.api.id.includes("codex")) {
        return [PROMPT_CODEX]
      }
      return [PROMPT_GPT]
    }
    if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
    if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
    if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
    if (model.api.id.toLowerCase().includes("kimi")) return [PROMPT_KIMI]
    return [PROMPT_DEFAULT]
  }

  export interface Interface {
    readonly environment: (model: Provider.Model) => string[]
    readonly skills: (agent: Agent.Info) => Effect.Effect<string | undefined>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/SystemPrompt") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const skill = yield* Skill.Service

      return Service.of({
        environment(model) {
          const project = Instance.project
          return [
            [
              `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
              `Here is some useful information about the environment you are running in:`,
              `<env>`,
              `  Working directory: ${Instance.directory}`,
              `  Workspace root folder: ${Instance.worktree}`,
              `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
              `  Platform: ${process.platform}`,
              `  Today's date: ${new Date().toDateString()}`,
              `</env>`,
            ].join("\n"),
            ...others(),
            ...visuals(Flag.OPENCODE_CLIENT),
            ...stepGuidance(Flag.OPENCODE_CLIENT),
            ...verification(),
            ...runCommands(),
          ]
        },

        skills: Effect.fn("SystemPrompt.skills")(function* (agent: Agent.Info) {
          if (Permission.disabled(["skill"], agent.permission).has("skill")) return

          const list = yield* skill.available(agent)

          return [
            "Skills provide specialized instructions and workflows for specific tasks.",
            "Use the skill tool to load a skill when a task matches its description.",
            // the agents seem to ingest the information about skills a bit better if we present a more verbose
            // version of them here and a less verbose version in tool description, rather than vice versa.
            Skill.fmt(list, { verbose: true }),
          ].join("\n")
        }),
      })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(Skill.defaultLayer))
}
