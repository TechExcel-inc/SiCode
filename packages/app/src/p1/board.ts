/** A board card's width, the gap between cards and between columns, and a column's padding, in px. */
export const card = 264
const gap = 8
const lane = 12
const pad = 16

/** A board column's width when it holds `across` cards `size` px wide side by side; an empty column stays narrow. */
export function width(across: number, size = card) {
  if (!across) return 152
  return across * size + (across - 1) * gap + pad
}

/**
 * How many cards side by side each board column gets, given how many cards each holds and the board's width:
 * one each, then one more for the tallest column while the board still has room, so long columns spread out
 * and short or empty ones stay narrow.
 */
export function spread(counts: number[], room: number, size = card) {
  const across = counts.map((count): number => (count ? 1 : 0))
  const used = () => across.reduce((sum, value) => sum + width(value, size), 0) + lane * Math.max(0, counts.length - 1)
  while (true) {
    const tall = counts.map((count, index) => (across[index] ? Math.ceil(count / across[index]) : 0))
    const top = tall.indexOf(Math.max(...tall))
    if (top < 0 || tall[top] <= 1) return across
    if (used() + size + gap > room) return across
    across[top]++
  }
}

/** The priority # range a weekly committed work group stands for, read from P1's name ("Priority Order: 30 - 39"). */
export function range(name: string) {
  const found = name.match(/(\d+)\s*-\s*(\d+)/)
  if (!found) return
  return { lo: Number(found[1]), hi: Number(found[2]) }
}

/**
 * The priority # a card takes when dropped between two cards of a group (either may be missing at an end):
 * between theirs, kept within the group's range. A card dropped into an empty group takes the range's start,
 * or keeps `now` when the group has no range.
 */
export function rank(prev: number | undefined, next: number | undefined, span?: { lo: number; hi: number }, now = 0) {
  const pick =
    prev !== undefined && next !== undefined
      ? Math.floor((prev + next + 1) / 2)
      : prev !== undefined
        ? prev + 1
        : next !== undefined
          ? next - 1
          : (span?.lo ?? now)
  if (!span) return Math.max(0, pick)
  return Math.min(span.hi, Math.max(span.lo, pick))
}

/**
 * The card width and cards across for each column that make the tallest column shortest: cards narrow from
 * their usual width down to 224px only when that fits another card across. The busiest column still gets two
 * cards across when the board has no room for it, and the board scrolls sideways instead.
 */
export function fit(counts: number[], room: number) {
  const tall = (across: number[]) =>
    Math.max(0, ...counts.map((count, index) => Math.ceil(count / (across[index] || 1))))
  const best = [264, 256, 248, 240, 232, 224]
    .map((size) => ({ size, across: spread(counts, room, size) }))
    .reduce((best, next) => (tall(next.across) < tall(best.across) ? next : best))
  const top = counts.indexOf(Math.max(...counts))
  if (top < 0 || counts[top] < 4 || best.across[top] !== 1) return best
  return { size: card, across: best.across.map((value, index) => (index === top ? 2 : value)) }
}

/** A requirement's stories under a person: the ones they own, or all of them when they own only the requirement. */
export function mine<T extends { owner: number }>(list: T[], who?: number) {
  const own = list.filter((story) => story.owner === who)
  return own.length ? own : list
}
