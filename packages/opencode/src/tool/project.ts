import z from "zod"
import { Effect } from "effect"
import { Tool } from "./tool"
import { Question } from "../question"
import { Foreign } from "../project/foreign"
import DESCRIPTION from "./project.txt"

const parameters = z.object({
  project: z.string().describe("Folder of the other project, exactly as listed in the environment"),
  prompt: z.string().describe("The task for that project, complete enough to start a new session on"),
})

type Metadata = {
  project: string
  name: string
  /** Set when the person moved the work: the session created for it in that project. */
  session?: string
}

export const ProjectSwitchTool = Tool.define<typeof parameters, Metadata, Question.Service>(
  "project_switch",
  Effect.gen(function* () {
    const question = yield* Question.Service

    return {
      description: DESCRIPTION,
      parameters,
      execute: (params: z.infer<typeof parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const target = Foreign.find(params.project)
          if (!target) {
            throw new Error(
              `${params.project} is not another project. Projects: ${Foreign.projects().map((item) => item.worktree).join(", ") || "none"}`,
            )
          }
          const name = Foreign.name(target)
          const here = Foreign.here()
          const meta = { project: target.worktree, name }
          // The app starts the new session from the resolved folder, not from what the agent typed.
          yield* ctx.metadata({ metadata: meta })
          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: [
              {
                question: `This work is for ${name}, not ${here}. Start a session in ${name}?`,
                header: "Project",
                custom: false,
                options: [
                  { label: `Move to ${name}`, description: `Continue this work in a new session in ${name}` },
                  { label: `Keep in ${here}`, description: `Work on ${name} from this session` },
                ],
              },
            ],
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })
          const answer = answers[0] ?? []

          // The app answers ["moved", sessionID] once it has started the session in the other project.
          if (answer[0] === "moved") {
            return {
              title: `Moved to ${name}`,
              output: `The user moved this work to a new session in ${name} (${target.worktree}). Do not continue it here: make no more tool calls and reply in one short sentence that it continues in ${name}.`,
              metadata: { ...meta, session: answer[1] },
            }
          }
          // A client without the app's dock answers with the option label.
          if (answer[0]?.startsWith("Move")) {
            return {
              title: `Belongs in ${name}`,
              output: `The user wants this work done in a session in ${name}. Stop and ask them to start a session in ${target.worktree}.`,
              metadata: meta,
            }
          }

          Foreign.keep(ctx.sessionID, target.worktree)
          return {
            title: `Kept in ${here}`,
            output: `The user chose to keep this work in this session. Work on ${name} at ${target.worktree} from here: use absolute paths and follow its AGENTS.md.`,
            metadata: meta,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
