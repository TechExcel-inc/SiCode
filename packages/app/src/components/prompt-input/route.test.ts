import { describe, expect, test } from "bun:test"
import { routable, routeFolder, routeTitle } from "./route"

describe("routable", () => {
  test("checks plain text in a session with earlier work", () => {
    expect(routable({ text: "Add a login page", users: 2 })).toBe(true)
  })

  test("skips first requests, commands, empty text, subagent and one-time sessions", () => {
    expect(routable({ text: "Add a login page", users: 0 })).toBe(false)
    expect(routable({ text: "/review", users: 3 })).toBe(false)
    expect(routable({ text: "  ", users: 3 })).toBe(false)
    expect(routable({ text: "Add a login page", users: 3, parentID: "ses_1" })).toBe(false)
    expect(routable({ text: "Add a login page", users: 3, oneTime: true })).toBe(false)
  })
})

describe("routeFolder", () => {
  test("another project's folder only for a project answer with a folder", () => {
    expect(routeFolder({ where: "project", directory: "/p/kloud" }, "/p/here")).toBe("/p/kloud")
    expect(routeFolder({ where: "project" }, "/p/here")).toBe("/p/here")
    expect(routeFolder({ where: "new", directory: "/p/kloud" }, "/p/here")).toBe("/p/here")
  })
})

describe("routeTitle", () => {
  test("the model's name, else the first line cut short", () => {
    expect(routeTitle({ where: "new", title: " Dark theme " }, "x")).toBe("Dark theme")
    expect(routeTitle({ where: "new" }, "Fix paging\nmore detail")).toBe("Fix paging")
    expect(routeTitle({ where: "new" }, "a".repeat(80))).toBe(`${"a".repeat(57)}...`)
  })
})
