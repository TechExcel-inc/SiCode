import { repoKey } from "./api"

/**
 * How SiCode links code to EAD products. A Repository is a project folder on this computer; EAD Pilot
 * knows it as a project whose own repo (owner/repo) is its Primary Repository, and that project codes at
 * most one Product. Related projects add more repositories, but each of those is another project's primary.
 *
 * One Primary Repository belongs to one Product: two Pilot projects that check out the same repo may not
 * code different products.
 */
export type Holding = { projectId: number; repo: string; productId: number }

/** The holding that already ties this primary repo to another product, if linking it to `productId` would clash. */
export function owner(rows: Holding[], input: Holding) {
  if (!input.productId || !input.repo) return
  const key = repoKey(input.repo)
  return rows.find(
    (row) =>
      row.projectId !== input.projectId &&
      !!row.productId &&
      row.productId !== input.productId &&
      repoKey(row.repo) === key,
  )
}
