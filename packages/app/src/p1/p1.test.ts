import { describe, expect, test } from "bun:test"
import { collect, detail, lang, login, num, origin, readBases, readFolders, readProjects, readRows, session } from "./api"
import { decode64, doc, file, htmlOf, markdown, prose } from "./doc"

const html = "<p>需求 <strong>说明</strong></p>"

describe("p1 doc", () => {
  test("decodes utf-8 base64 and leaves markup as it is", () => {
    const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(html)))
    expect(decode64(encoded)).toBe(html)
    expect(htmlOf(encoded)).toBe(html)
    expect(htmlOf(html)).toBe(html)
    expect(htmlOf("plain")).toBe("plain")
  })

  test("turns the description into markdown", () => {
    const text = markdown(`
      <h2>Flow</h2>
      <p>See <a href="https://example.com/docs">docs</a> and <code>id</code>.</p>
      <ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul>
      <ol><li>first</li></ol>
      <table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
      <pre><code class="language-ts">const a = 1</code></pre>
      <img src="https://cdn.example/a.png" alt="shot">
      <img src="data:image/png;base64,xx" alt="skip">
      <a href="javascript:alert(1)">nope</a>
    `)
    expect(text).toContain("## Flow")
    expect(text).toContain("[docs](https://example.com/docs)")
    expect(text).toContain("`id`")
    expect(text).toContain("- one")
    expect(text).toContain("- two")
    expect(text).toContain("  - nested")
    expect(text).toContain("1. first")
    expect(text).toContain("| A | B |")
    expect(text).toContain("| --- | --- |")
    expect(text).toContain("| 1 | 2 |")
    expect(text).toContain("```ts\nconst a = 1\n```")
    expect(text).toContain("![shot](https://cdn.example/a.png)")
    expect(text).not.toContain("data:image")
    expect(text).toContain("nope")
    expect(text).not.toContain("javascript:")
  })

  test("writes a design doc with the requirement title", () => {
    const body = prose("登录", "<p>填写服务器。</p>")
    expect(body).toBe("# 登录\n\n填写服务器。")
    const page = doc({ server: "https://p1.example", project: 12, id: 34, title: "登录", pulled: 5 }, body)
    expect(file(12, 34)).toBe("design/p1/12/34.md")
    expect(page).toContain('server: "https://p1.example"')
    expect(page).toContain("project: 12")
    expect(page).toContain("item: 34")
    expect(page).toContain('title: "登录"')
    expect(page).toContain("pulled: 5")
    expect(page).toContain("# 登录")
  })
})

describe("p1 api", () => {
  test("reads a login and a requirement", () => {
    expect(origin("p1.example/app/")).toBe("https://p1.example/app")
    expect(lang("zh")).toBe(2)
    expect(lang("en")).toBe(1)
    expect(num("34")).toBe(34)
    expect(num("0")).toBeUndefined()
    expect(session({ access_token: "t", userId: 7, firstName: "林", lastName: "安" }, "lin")).toEqual({
      token: "t",
      user: "7",
      name: "林 安",
    })
    const encoded = btoa(String.fromCharCode(...new TextEncoder().encode("<p>正文</p>")))
    expect(
      detail({
        Values: [
          { ID: 1101, Value: "标题" },
          { ID: 1102, ValueHTML: encoded },
        ],
      }),
    ).toEqual({ title: "标题", html: "<p>正文</p>" })
  })

  test("reads projects, folders and requirements", () => {
    expect(
      readBases({
        Data: [
          { ProjectBase: { ProjectID: 4, ProjectName: "Jiaxing", IsActive: 1 } },
          { ProjectBase: { ProjectID: 5, ProjectName: "Closed", IsActive: 0 } },
        ],
      }),
    ).toEqual([{ id: 4, base: 4, name: "Jiaxing" }])
    expect(
      collect(
        [{ id: 4, base: 4, name: "Jiaxing" }],
        [[{ id: 20, base: 4, name: "Spec" }, { id: 21, base: 4, name: "Plan" }]],
      ).map((item) => item.name),
    ).toEqual(["Plan", "Spec"])
    expect(
      readProjects({
        Data: [
          { ProjectId: 10, SpaceId: 20, SpaceName: "Beta" },
          { ProjectId: 10, SpaceId: 21, SpaceName: "Alpha" },
        ],
      }).map((item) => item.name),
    ).toEqual(["Beta", "Alpha"])
    const tree = {
      FolderNodes: [
        {
          FolderID: 20,
          FolderName: "Space",
          FolderNodes: [{ FolderID: 3, FolderName: "Specs", FolderNodes: [] }],
        },
        { FolderID: 99, FolderName: "Other", FolderNodes: [] },
      ],
    }
    expect(readFolders(tree, 20)).toEqual([
      { id: 20, name: "Space", depth: 0 },
      { id: 3, name: "Specs", depth: 1 },
    ])
    expect(
      readRows({
        ListItems: [{ 1112: 7, 1101: "登录", 1114: "Open", 1113: "Ada", children: [{ ID: 8, Title: "子项" }] }],
      }),
    ).toEqual([
      { id: 7, title: "登录", status: "Open", owner: "Ada" },
      { id: 8, title: "子项", status: "", owner: "" },
    ])
  })

  test("posts the password grant", async () => {
    let url = ""
    let body = ""
    const http = (async (input: string | URL, init?: RequestInit) => {
      url = String(input)
      body = String(init?.body ?? "")
      return new Response(JSON.stringify({ access_token: "tok", userId: 3, firstName: "A", lastName: "B" }), {
        status: 200,
      })
    }) as typeof fetch
    const found = await login("https://p1.example", "ada", "secret", http)
    expect(found.token).toBe("tok")
    expect(found.name).toBe("A B")
    expect(url).toBe("https://p1.example/DevTrackApi/token")
    expect(JSON.parse(body)).toMatchObject({ Grant_type: "password", UserName: "ada", Password: "secret" })
  })
})
