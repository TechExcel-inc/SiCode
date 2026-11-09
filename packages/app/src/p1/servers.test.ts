import { describe, expect, test } from "bun:test"
import { kloudP1Servers, normalizeServer, readP1Servers, uniqueServers } from "./servers"

describe("P1 servers from Kloud's predefined P1 integrations", () => {
  test("a company's P1 integration subsystems become servers; other subsystems don't", () => {
    const data = {
      code: 0,
      data: [
        { type: 1, subSystemName: "P1", apiUrl: "https://jiaxing.devsuite.cn/" },
        { type: 8, subSystemName: "SiMeet", apiUrl: "" },
        { type: 1, subSystemName: "no address", apiUrl: "" },
      ],
    }
    expect(readP1Servers(data, "Kloud Corporation")).toEqual([
      { url: "https://jiaxing.devsuite.cn", name: "P1", company: "Kloud Corporation" },
    ])
  })

  test("addresses are normalized and each server listed once", () => {
    expect(normalizeServer(" yaxin.p1team.cn/ ")).toBe("https://yaxin.p1team.cn")
    expect(normalizeServer("http://60.12.94.82:17777")).toBe("http://60.12.94.82:17777")
    expect(
      uniqueServers([
        { url: "https://a.example", name: "P1", company: "A" },
        { url: "https://A.example", name: "P1", company: "B" },
        { url: "https://b.example", name: "P1", company: "B" },
      ]).map((s) => s.url),
    ).toEqual(["https://a.example", "https://b.example"])
  })

  test("reads the person's companies with their Kloud login, then each company's integrations", async () => {
    const asked: string[] = []
    const http = (async (url: string, init?: RequestInit) => {
      asked.push(url)
      expect((init?.headers as Record<string, string>).UserToken).toBe("kloud-token")
      if (url.endsWith("/User/UserProfile")) return new Response("﻿" + JSON.stringify({ RetCode: 0, RetData: { UserID: 501 } }))
      if (url.includes("/School/UserSchoolList"))
        return new Response(JSON.stringify({ RetCode: 0, RetData: [{ SchoolID: 3255, SchoolName: "Kloud Corporation" }, { SchoolID: 7, SchoolName: "Other" }] }))
      if (url.includes("companyId=3255"))
        return new Response(JSON.stringify({ code: 0, data: [{ type: 1, subSystemName: "p1", apiUrl: "https://jiaxing.devsuite.cn" }] }))
      return new Response(JSON.stringify({ code: 0, data: [] }))
    }) as typeof fetch
    expect(await kloudP1Servers("kloud-token", http, "https://api.example/peertime/V1", "https://meet.example")).toEqual([
      { url: "https://jiaxing.devsuite.cn", name: "p1", company: "Kloud Corporation" },
    ])
    expect(asked[1]).toBe("https://api.example/peertime/V1/School/UserSchoolList?userID=501")
  })

  test("nothing without a Kloud login, or when Kloud can't be reached", async () => {
    const never = (async (_url: string): Promise<Response> => {
      throw new Error("offline")
    }) as typeof fetch
    expect(await kloudP1Servers(undefined, never)).toEqual([])
    expect(await kloudP1Servers("kloud-token", never)).toEqual([])
  })
})
