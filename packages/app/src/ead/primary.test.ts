import { describe, expect, test } from "bun:test"
import { owner } from "./primary"

describe("one primary repository belongs to one product", () => {
  const rows = [
    { projectId: 1, repo: "acme/web", productId: 10 },
    { projectId: 2, repo: "acme/api", productId: 0 },
    { projectId: 3, repo: "https://github.com/Acme/Shop", productId: 30 },
  ]

  test("another project checking out the same repo for a different product blocks the link", () => {
    expect(owner(rows, { projectId: 9, repo: "acme/web", productId: 20 })).toEqual(rows[0])
    expect(owner(rows, { projectId: 9, repo: "acme/shop", productId: 20 })).toEqual(rows[2])
  })

  test("the same product, the project itself, no product or an unowned repo are fine", () => {
    expect(owner(rows, { projectId: 9, repo: "acme/web", productId: 10 })).toBeUndefined()
    expect(owner(rows, { projectId: 1, repo: "acme/web", productId: 20 })).toBeUndefined()
    expect(owner(rows, { projectId: 9, repo: "acme/web", productId: 0 })).toBeUndefined()
    expect(owner(rows, { projectId: 9, repo: "acme/api", productId: 20 })).toBeUndefined()
    expect(owner(rows, { projectId: 9, repo: "", productId: 20 })).toBeUndefined()
  })
})
