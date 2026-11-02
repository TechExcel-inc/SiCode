import { describe, expect, test } from "bun:test"
import { every, own, readTree, specs } from "./features"

describe("p1 features", () => {
  test("reads the feature tree and keeps the project's products", () => {
    const tree = readTree({
      code: 0,
      data: [
        {
          id: 1,
          title: "P1 Admin",
          parentId: 0,
          children: [{ id: 2, title: "System Settings", parentId: 1, children: [{ id: 3, title: "Login", children: [] }] }],
        },
        { id: 9, title: "Other product", children: [] },
        { title: "no id" },
      ],
    })
    expect(own(tree, [1])).toEqual([
      {
        id: 1,
        title: "P1 Admin",
        children: [{ id: 2, title: "System Settings", children: [{ id: 3, title: "Login", children: [] }] }],
      },
    ])
  })

  test("reads spec ids from external ids and P1's id list", () => {
    expect(specs(["10-30521", "10-30542", "10-30521", "bad", "10-0"])).toEqual([30521, 30542])
    expect(every({ Data: "30521,30542,," })).toEqual([30521, 30542])
    expect(every("7,8")).toEqual([7, 8])
    expect(every({ Data: { ListItems: [] } })).toEqual([])
  })
})
