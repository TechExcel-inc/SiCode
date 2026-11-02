import type { Story } from "./stories"

/** What the AI suggests for a spec: its points (hours of AI coding), each story's target time, and why. */
export type Guess = {
  points: number
  why: string
  stories: { id: number; hours: number; why: string }[]
}

/** The question put to the AI: the spec, its description, and its stories and tasks as they stand. */
export function brief(spec: { id: number; title: string; text: string; points: number }, list: Story[]) {
  const stories = list.map((story) => ({
    id: story.id,
    name: story.name,
    target: story.target,
    spent: story.spent,
    finish: story.finish,
    tasks: story.tasks.map((task) => ({ name: task.name, module: task.area, spent: task.spent, remain: task.remain })),
  }))
  return [
    "Estimate this software requirement (a spec) in hours of AI-assisted coding work: an engineer working with an AI coding agent.",
    "Give the spec's total points (hours) and a target time in hours for each story listed. Count design, coding, tests and review; leave out waiting time.",
    "Keep what is already done in mind: time spent counts toward a story's target.",
    'Reply with JSON only: {"points": number, "why": "one sentence", "stories": [{"id": number, "hours": number, "why": "one short phrase"}]}.',
    "Hours to one decimal. Use the story ids given; with no stories, return an empty list.",
    "",
    JSON.stringify({
      spec: { id: spec.id, title: spec.title, points: spec.points, description: spec.text.slice(0, 6000) },
      stories,
    }),
  ].join("\n")
}

/** The AI's reply read into a suggestion, keeping only stories the spec has; undefined when it isn't usable. */
export function guess(reply: string, list: Story[]): Guess | undefined {
  const found = reply.match(/\{[\s\S]*\}/)
  if (!found) return
  const data = (() => {
    try {
      return JSON.parse(found[0]) as unknown
    } catch {
      return undefined
    }
  })()
  if (!data || typeof data !== "object") return
  const raw = data as { points?: unknown; why?: unknown; stories?: unknown }
  const points = tenth(raw.points)
  if (points === undefined) return
  const ids = new Set(list.map((story) => story.id))
  const stories = (Array.isArray(raw.stories) ? raw.stories : []).flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const one = item as { id?: unknown; hours?: unknown; why?: unknown }
    const hours = tenth(one.hours)
    const id = Number(one.id)
    if (hours === undefined || !ids.has(id)) return []
    return [{ id, hours, why: typeof one.why === "string" ? one.why : "" }]
  })
  return { points, why: typeof raw.why === "string" ? raw.why : "", stories }
}

function tenth(value: unknown) {
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) return
  return Math.round(num * 10) / 10
}
