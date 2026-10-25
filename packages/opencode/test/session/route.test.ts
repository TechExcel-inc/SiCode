import { describe, expect, test } from "bun:test"
import { SessionRoute } from "../../src/session/route"

describe("SessionRoute.parse", () => {
  test("reads each answer", () => {
    expect(SessionRoute.parse(`{"where":"here"}`)).toEqual({ where: "here" })
    expect(SessionRoute.parse(`{"where":"new","title":"Login page"}`)).toEqual({ where: "new", title: "Login page" })
    expect(SessionRoute.parse(`{"where":"project","project":"KloudMeet","title":"Dark theme"}`)).toEqual({
      where: "project",
      project: "KloudMeet",
      title: "Dark theme",
    })
  })

  test("finds the JSON among other text and thinking", () => {
    expect(SessionRoute.parse(`<think>{"where":"new"}</think>Sure: {"where":"new","title":"X"} done`)).toEqual({
      where: "new",
      title: "X",
    })
  })

  test("anything unreadable stays here", () => {
    expect(SessionRoute.parse("")).toEqual({ where: "here" })
    expect(SessionRoute.parse("new task")).toEqual({ where: "here" })
    expect(SessionRoute.parse(`{"where":"elsewhere"}`)).toEqual({ where: "here" })
    expect(SessionRoute.parse(`{"where":`)).toEqual({ where: "here" })
  })
})
