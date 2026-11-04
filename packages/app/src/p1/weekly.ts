import type { Story } from "./stories"

/**
 * The weekly board of a roadmap month, as P1's "List by End Date" board lays it out for tasks: Monday to Sunday
 * weeks covering the month, one band per owner, and each story on the day its end date falls. Stories with no end
 * date, or one outside the month, wait in the owner's "To be planned" row.
 */

export type Day = { date: string; inside: boolean }
export type Week = { from: string; to: string; days: Day[] }
export type Card = { spec: number; title: string; story: Story }
export type Band = {
  owner: number
  person: string
  days: Record<string, Card[]>
  later: Card[]
  spent: number
  remain: number
  points: number
  count: number
}

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`

/** The month's weeks ("202611"), each Monday to Sunday; days of the next or last month are outside it. */
export function calendar(month: string): Week[] {
  const year = Number(month.slice(0, 4))
  const index = Number(month.slice(4)) - 1
  const first = new Date(year, index, 1)
  const last = new Date(year, index + 1, 0)
  // Back to the Monday on or before the 1st.
  const start = new Date(year, index, 1 - ((first.getDay() + 6) % 7))
  const out: Week[] = []
  for (const at = start; at <= last; ) {
    const days = Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(at.getFullYear(), at.getMonth(), at.getDate() + offset)
      return { date: iso(date), inside: date.getMonth() === index }
    })
    out.push({ from: days[0].date, to: days[6].date, days })
    at.setDate(at.getDate() + 7)
  }
  return out
}

/** The week holding today when today is in the month, else the month's first week. */
export function current(weeks: Week[], today = iso(new Date())) {
  return Math.max(
    0,
    weeks.findIndex((week) => week.days.some((day) => day.inside && day.date === today)),
  )
}

/** Today as the board compares dates. */
export function today() {
  return iso(new Date())
}

/**
 * The owners' bands for a week: each story on its end date's day when that falls in the week, or in To be planned
 * when it has no end date or one outside the month. Owners are sorted by name with the unassigned last; a band's
 * totals cover all its stories in the month, and a day's stories keep their spec's order.
 */
export function board(cards: Card[], weeks: Week[], week: Week): Band[] {
  const month = new Set(weeks.flatMap((item) => item.days.filter((day) => day.inside).map((day) => day.date)))
  const shown = new Set(week.days.filter((day) => day.inside).map((day) => day.date))
  const bands = new Map<number, Band>()
  for (const card of cards) {
    const owner = card.story.owner
    const band = bands.get(owner) ?? {
      owner,
      person: card.story.person,
      days: {},
      later: [],
      spent: 0,
      remain: 0,
      points: 0,
      count: 0,
    }
    bands.set(owner, band)
    band.spent += card.story.spent
    band.remain += card.story.remain
    band.points += card.story.points
    band.count += 1
    const end = card.story.end
    if (!end || !month.has(end)) {
      band.later.push(card)
      continue
    }
    if (shown.has(end)) band.days[end] = [...(band.days[end] ?? []), card]
  }
  return [...bands.values()].sort((a, b) => {
    if (!a.owner !== !b.owner) return a.owner ? -1 : 1
    return a.person.localeCompare(b.person)
  })
}

/** A set of cards' time and stories, as the DATES column and the To be planned row total them. */
export function total(cards: Card[]) {
  return {
    spent: cards.reduce((sum, card) => sum + card.story.spent, 0),
    remain: cards.reduce((sum, card) => sum + card.story.remain, 0),
    count: cards.length,
  }
}
