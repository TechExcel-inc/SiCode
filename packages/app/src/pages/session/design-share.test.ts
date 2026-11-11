import { describe, expect, test } from "bun:test"
import type { Cowork } from "@/ead/cowork"
import { base64, decode, encode, pilotKey, mine, parseKey, publish, remote, sha } from "./design-share"

describe("design share", () => {
  test("a Pilot-only design has its own gallery key", () => {
    const key = pilotKey(7, "design/Atlas.design")
    expect(remote(key)).toBe(true)
    expect(remote("design/Atlas.design")).toBe(false)
    expect(parseKey(key)).toEqual({ projectId: 7, path: "design/Atlas.design" })
    expect(parseKey("pilot:x/design/a.md")).toBeUndefined()
    expect(parseKey("design/a.md")).toBeUndefined()
  })

  test("a design without a Pilot record is mine; otherwise its owner decides", () => {
    expect(mine(undefined, "4")).toBe(true)
    expect(mine({ ownerUserId: 4 }, "4")).toBe(true)
    expect(mine({ ownerUserId: 5 }, "4")).toBe(false)
  })

  test("text keeps one final newline and bytes round-trip", async () => {
    expect(new TextDecoder().decode(encode({ content: "<p>hi</p>" }))).toBe("<p>hi</p>\n")
    expect(encode({ content: "" }).length).toBe(0)
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 255])
    expect(encode({ content: base64(png), encoding: "base64" })).toEqual(png)
    expect(decode("assets/logo.png", base64(png))).toMatchObject({ encoding: "base64", content: base64(png) })
    expect(decode("login.html", base64(new TextEncoder().encode("<p>hi</p>\n")))).toMatchObject({ content: "<p>hi</p>" })
    expect(await sha(new TextEncoder().encode("hello"))).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    )
  })

  test("publish lists every file and uploads only what Pilot is missing", async () => {
    const sent: { kind: string; body: any }[] = []
    const design = { designId: 1, files: [] } as any
    const client = {
      saveDesign: async (_: number, body: any) => {
        sent.push({ kind: "save", body })
        return { design, missing: ["canvas.json"] }
      },
      uploadDesign: async (_: number, body: any) => {
        sent.push({ kind: "upload", body })
        return design
      },
    } as unknown as Cowork
    await publish(client, 3, {
      path: "design/A.design",
      kind: "design",
      title: "A",
      files: [
        { name: "canvas.json", file: { content: "{}" } },
        { name: "login.html", file: { content: "<p>hi</p>" } },
      ],
    })
    expect(sent.map((item) => item.kind)).toEqual(["save", "upload"])
    expect(sent[0].body.files.map((item: any) => [item.name, item.size])).toEqual([
      ["canvas.json", 3],
      ["login.html", 10],
    ])
    expect(sent[1].body).toEqual({ path: "design/A.design", name: "canvas.json", content: btoa("{}\n") })
  })
})
