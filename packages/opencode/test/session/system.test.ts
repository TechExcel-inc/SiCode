import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { others, stepGuidance, SystemPrompt, visuals } from "../../src/session/system"
import { Project } from "../../src/project/project"
import { provideInstance, tmpdir } from "../fixture/fixture"

function load<A>(dir: string, fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(provideInstance(dir)(Agent.Service.use(fn)).pipe(Effect.provide(Agent.defaultLayer)))
}

describe("session.system", () => {
  test("tells the desktop app's agent to show visuals inline, not in a browser", () => {
    const [text] = visuals("desktop")
    expect(text).toContain("```svg")
    expect(text).toContain("instead of opening a browser, a full-window page")
    expect(text).toContain("with the question tool")
    expect(text).toContain("set each choice's image")
    expect(text).toContain("check them with the design_review tool")
    expect(visuals("cli")).toEqual([])
  })

  test("tells the desktop app's agent to start a list per request and close it before ending a reply", () => {
    const [text] = stepGuidance("desktop")
    expect(text).toContain("start a new list for it with todowrite")
    expect(text).toContain("mark them cancelled")
    expect(text).toContain("keep the same list")
    expect(stepGuidance("cli")).toEqual([])
  })

  test("skills output is sorted by name and stable across calls", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        for (const [name, description] of [
          ["zeta-skill", "Zeta skill."],
          ["alpha-skill", "Alpha skill."],
          ["middle-skill", "Middle skill."],
        ]) {
          const skillDir = path.join(dir, ".kloudcode", "skill", name)
          await Bun.write(
            path.join(skillDir, "SKILL.md"),
            `---
name: ${name}
description: ${description}
---

# ${name}
`,
          )
        }
      },
    })

    const home = process.env.OPENCODE_TEST_HOME
    process.env.OPENCODE_TEST_HOME = tmp.path

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const build = await load(tmp.path, (svc) => svc.get("build"))
          const runSkills = Effect.gen(function* () {
            const svc = yield* SystemPrompt.Service
            return yield* svc.skills(build!)
          }).pipe(Effect.provide(SystemPrompt.defaultLayer))

          const first = await Effect.runPromise(runSkills)
          const second = await Effect.runPromise(runSkills)

          expect(first).toBe(second)

          const alpha = first!.indexOf("<name>alpha-skill</name>")
          const middle = first!.indexOf("<name>middle-skill</name>")
          const zeta = first!.indexOf("<name>zeta-skill</name>")

          expect(alpha).toBeGreaterThan(-1)
          expect(middle).toBeGreaterThan(alpha)
          expect(zeta).toBeGreaterThan(middle)
        },
      })
    } finally {
      process.env.OPENCODE_TEST_HOME = home
    }
  })

  test("names the related projects, which the agent may change without project_switch", async () => {
    await using ui = await tmpdir({ git: true })
    await using server = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(ui.path)
    await Project.update({ projectID: project.id, related: [server.path] })
    await Instance.provide({
      directory: ui.path,
      fn: async () => {
        const text = others().join("\n")
        expect(text).toContain(`  - ${path.basename(server.path)}: ${server.path}`)
        expect(text).toContain("without project_switch")
      },
    })
  })

})
