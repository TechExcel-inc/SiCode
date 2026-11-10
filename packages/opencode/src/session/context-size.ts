import { asSchema } from "ai"
import { Effect } from "effect"
import z from "zod"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { ProviderTransform } from "@/provider/transform"
import { Skill } from "@/skill"
import { ToolRegistry } from "@/tool/registry"
import { Token } from "@/util/token"
import { Session } from "."
import { Instruction } from "./instruction"
import type { SessionID } from "./schema"
import { SystemPrompt } from "./system"

const COMPACTION_BUFFER = 20_000
const INSTRUCTIONS = "Instructions from: "

/**
 * How the parts of a session's context window add up, measured the same way the next turn is built
 * (see `SessionPrompt` and `LLM`). Messages are not included: the app takes them from the last reply's
 * real token count, minus everything here.
 */
export namespace ContextSize {
  export const Item = z
    .object({ name: z.string(), tokens: z.number() })
    .meta({ ref: "ContextSizeItem" })
  export type Item = z.infer<typeof Item>

  export const Info = z
    .object({
      providerID: z.string(),
      modelID: z.string(),
      /** The model's context window; 0 when the model does not say. */
      limit: z.number(),
      systemPrompt: z.number(),
      systemTools: z.number(),
      mcpTools: z.number(),
      skills: z.number(),
      memoryFiles: z.number(),
      customAgents: z.number(),
      /** Space kept free so the conversation is compacted before it overflows; 0 when auto-compact is off. */
      autocompactBuffer: z.number(),
      mcpToolList: Item.array(),
      memoryFileList: Item.array(),
      customAgentList: Item.array(),
    })
    .meta({ ref: "ContextSize" })
  export type Info = z.infer<typeof Info>

  const schema = (value: unknown) => JSON.stringify(value ?? {})

  /** The buffer that `isOverflow` keeps free, as a share of the whole window. */
  export function buffer(cfg: Config.Info, model: Provider.Model) {
    if (cfg.compaction?.auto === false) return 0
    const context = model.limit.context
    if (!context) return 0
    const reserved = cfg.compaction?.reserved ?? Math.min(COMPACTION_BUFFER, ProviderTransform.maxOutputTokens(model))
    const usable = model.limit.input ? model.limit.input - reserved : context - ProviderTransform.maxOutputTokens(model)
    return Math.max(0, Math.min(context, context - usable))
  }

  /** Splits `instruction.system()` entries into memory files (by path) and other injected notes. */
  export function memory(entries: string[]) {
    const files: Item[] = []
    let other = 0
    for (const entry of entries) {
      if (!entry.startsWith(INSTRUCTIONS)) {
        other += Token.estimate(entry)
        continue
      }
      const line = entry.indexOf("\n")
      const name = line < 0 ? entry.slice(INSTRUCTIONS.length) : entry.slice(INSTRUCTIONS.length, line)
      files.push({ name, tokens: Token.estimate(entry) })
    }
    return { files, other }
  }

  export const compute = Effect.fn("ContextSize.compute")(function* (sessionID: SessionID) {
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const registry = yield* ToolRegistry.Service
    const mcp = yield* MCP.Service
    const instruction = yield* Instruction.Service
    const skill = yield* Skill.Service
    const sys = yield* SystemPrompt.Service
    const config = yield* Config.Service

    const session = yield* sessions.get(sessionID)
    const messages = yield* sessions.messages({ sessionID })
    const user = messages.findLast((item) => item.info.role === "user")?.info
    const choice =
      user?.role === "user" ? user.model : yield* provider.defaultModel()
    const model = yield* provider.getModel(ProviderID.make(choice.providerID), ModelID.make(choice.modelID))
    const agent = yield* agents.get(user?.role === "user" ? user.agent : yield* agents.defaultAgent())
    const cfg = yield* config.get()

    const disabled = (ids: string[]) =>
      Permission.disabled(ids, Permission.merge(agent.permission, session.permission ?? []))
    const off = (id: string, blocked: Set<string>) =>
      (user?.role === "user" && user.tools?.[id] === false) || blocked.has(id)

    // System prompt: the agent's own prompt or the provider prompt, plus the environment block.
    const [env, skillPrompt, entries] = yield* Effect.all([
      Effect.sync(() => sys.environment(model)),
      sys.skills(agent),
      instruction.system().pipe(Effect.orElseSucceed(() => [] as string[])),
    ])
    const header = agent.prompt ? [agent.prompt] : SystemPrompt.provider(model)
    const notes = memory(entries)
    const systemPrompt = Token.estimate([...header, ...env].join("\n")) + notes.other

    // Skills: the list in the system prompt and the shorter list in the skill tool's description.
    const available = Permission.disabled(["skill"], agent.permission).has("skill") ? [] : yield* skill.available(agent)
    const skillList = available.length ? Token.estimate(Skill.fmt(available, { verbose: false })) : 0
    const skills = (skillPrompt ? Token.estimate(skillPrompt) : 0) + skillList

    // Custom agents: the agents people added, as listed in the task tool's description.
    const custom = (yield* agents.list()).filter((item) => !item.native)
    const listed = (item: Agent.Info) =>
      item.mode !== "primary" && Permission.evaluate("task", item.name, agent.permission).action !== "deny"
    const customAgentList = custom.map((item) => ({
      name: item.name,
      tokens: listed(item)
        ? Token.estimate(`- ${item.name}: ${item.description ?? "This subagent should only be called manually by the user."}`)
        : 0,
    }))
    const customAgents = customAgentList.reduce((sum, item) => sum + item.tokens, 0)

    // Built-in tools, without the skill and agent lists counted above.
    const builtin = yield* registry.tools({
      modelID: ModelID.make(model.api.id),
      providerID: model.providerID,
      image: model.capabilities.input.image,
      agent,
    })
    const blockedBuiltin = disabled(builtin.map((item) => item.id))
    const toolTokens = builtin
      .filter((item) => !off(item.id, blockedBuiltin))
      .reduce(
        (sum, item) =>
          sum +
          Token.estimate(item.id + item.description + schema(ProviderTransform.schema(model, z.toJSONSchema(item.parameters)))),
        0,
      )
    const systemTools = Math.max(0, toolTokens - skillList - customAgents)

    // MCP tools from connected servers.
    const remote = yield* mcp.tools()
    const blockedRemote = disabled(Object.keys(remote))
    const mcpToolList: Item[] = []
    for (const [name, item] of Object.entries(remote)) {
      if (!item.execute || off(name, blockedRemote)) continue
      const json = yield* Effect.promise(() => Promise.resolve(asSchema(item.inputSchema).jsonSchema)).pipe(
        Effect.orElseSucceed(() => ({})),
      )
      mcpToolList.push({ name, tokens: Token.estimate(name + (item.description ?? "") + schema(json)) })
    }
    mcpToolList.sort((a, b) => b.tokens - a.tokens)

    return {
      providerID: model.providerID,
      modelID: model.id,
      limit: model.limit.context ?? 0,
      systemPrompt,
      systemTools,
      mcpTools: mcpToolList.reduce((sum, item) => sum + item.tokens, 0),
      skills,
      memoryFiles: notes.files.reduce((sum, item) => sum + item.tokens, 0),
      customAgents,
      autocompactBuffer: buffer(cfg, model),
      mcpToolList,
      memoryFileList: notes.files,
      customAgentList,
    } satisfies Info
  })
}
