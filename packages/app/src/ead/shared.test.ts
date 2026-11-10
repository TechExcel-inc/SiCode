import { describe, expect, test } from "bun:test"
import {
  findRepoFolders,
  loadPublishTargets,
  formatSharedServerPrompt,
  remoteDevServerAiHelp,
  reorderSharedServers,
  repoEnd,
  repoKey,
  repoPlace,
  repoSourceType,
  type RepoPlace,
  type ServerProduct,
} from "./api"
import { handlePluginMessage } from "./bridge"

const server = {
  serverId: 1,
  name: "jinbao dev",
  shortName: "JB Dev",
  os: "windows" as const,
  sshHost: "108.175.14.99",
  sshPort: 50525,
  sshLogin: "administrator",
  authMethod: "password" as const,
  hasKey: false,
  rootFolder: "C:\\TX",
  note: "",
  useCoding: true,
  publishRole: "none" as const,
  sshEnabled: true,
  remoteControl: false,
  remotePort: 3389,
  canViewPassword: false,
  enabled: true,
  lastUser: "",
  lastAt: 0,
}

const product: ServerProduct = {
  productId: 12,
  name: "P1 Admin 12",
  servers: [],
  publish: [],
  repos: [
    {
      definitionId: 1,
      name: "API",
      role: "SERVER_END_ONLY",
      sourceCodeType: "",
      serverSourceCodeType: "ASP.NET Core",
      repository: "techexcel/p1_admin_api_12",
      branch: "main",
      section: "CURRENT",
      serverId: 1,
      folder: "C:\\TX\\P1Web_12",
    },
    {
      definitionId: 2,
      name: "Web",
      role: "FRONT_END_ONLY",
      sourceCodeType: "React",
      serverSourceCodeType: "",
      repository: "techexcel/p1_vp12",
      branch: "main",
      section: "CURRENT",
      folder: "",
    },
  ],
}

const at = (index: number): RepoPlace => ({
  product,
  repo: product.repos[index],
  server: index === 0 ? server : undefined,
  servers: [server],
  publish: [],
})

describe("shared server instructions", () => {
  test("a repo on a Shared Server is worked on there, and the other repos are named with where they live", () => {
    const text = formatSharedServerPrompt(at(0), true, "/Users/dev/P1_Admin_API_12")!
    expect(text).toContain("developed and built on the Shared Server JB Dev")
    expect(text).toContain("in C:\\TX\\P1Web_12.")
    expect(text).toContain("ssh -i ~/.ssh/sicode_ead_s1_ed25519 -p 50525")
    expect(text).toContain(
      "- Web (techexcel/p1_vp12, current, front end, React): on the Local Server (its own project)",
    )
  })

  test("publishing names each destination, and remote coding off counts as local", () => {
    const place = (coding: boolean, publish: ServerProduct["publish"]) =>
      repoPlace(
        { ...product, servers: [{ serverId: 1, remoteCoding: coding }], publish },
        "techexcel/p1_admin_api_12",
        [server],
      )
    const none = formatSharedServerPrompt(place(true, []), true, "/x")!
    expect(none).toContain('No testing destination is set for "P1 Admin 12"')
    expect(none).toContain('No production destination is set for "P1 Admin 12"')
    const own = formatSharedServerPrompt(
      place(true, [{ environment: "testing", side: "frontend", serverId: 1, folder: "C:\\site", url: "https://test" }]),
      true,
      "/x",
    )!
    expect(own).toContain(
      'The front end of "P1 Admin 12" publishes for testing to the Shared Server JB Dev (the computer it\'s coded on), in the folder C:\\site. Check it at https://test afterward.',
    )
    expect(own).toContain("confirm with the user before every production publish")
    const local = formatSharedServerPrompt(
      place(false, [{ environment: "production", side: "backend", serverId: 1, folder: "C:\\site", url: "" }]),
      true,
      "/Users/dev/api",
    )!
    expect(local).toContain("Work on it here, on the Local Server, in /Users/dev/api.")
    expect(local).toContain("The server end of \"P1 Admin 12\" publishes for production to the Shared Server JB Dev, in the folder C:\\site.")
    expect(local).toContain("ssh -i ~/.ssh/sicode_ead_s1_ed25519 -p 50525")
    const service = formatSharedServerPrompt(
      place(false, [{ environment: "testing", side: "backend", serverId: 1, folder: "KloudJavaServer", url: "" }]),
      true,
      "/x",
    )!
    expect(service).toContain("publishes for testing to the Shared Server JB Dev, as the service KloudJavaServer.")
    expect(place(false, [])?.server).toBeUndefined()
    expect(formatSharedServerPrompt(place(false, []), true, "/x")).toBeUndefined()
  })

  test("choosing the Local Server keeps the work in the project's folder", () => {
    const text = formatSharedServerPrompt(at(0), false, "/Users/dev/P1_Admin_API_12")!
    expect(text).toContain("Work on it here, on the Local Server, in /Users/dev/P1_Admin_API_12.")
    expect(text).not.toContain("ssh -i")
  })

  test("a local repo names its sibling on the Shared Server", () => {
    const text = formatSharedServerPrompt(at(1), true, "/Users/dev/P1_VP12")!
    expect(text).toContain(
      "- API (techexcel/p1_admin_api_12, current, server end, ASP.NET Core): on the Shared Server JB Dev, in C:\\TX\\P1Web_12",
    )
  })

  test("nothing is added for a product without Shared Servers", () => {
    const local = { ...product, repos: product.repos.map((repo) => ({ ...repo, serverId: undefined })) }
    expect(formatSharedServerPrompt({ product: local, repo: local.repos[0], servers: [], publish: [] }, true, "/x")).toBeUndefined()
    expect(formatSharedServerPrompt(undefined, true, "/x")).toBeUndefined()
  })

  test("a repo holding both ends names both source code types", () => {
    const repo = {
      ...product.repos[0],
      role: "FRONT_AND_SERVER_END",
      sourceCodeType: "ASP.NET MVC",
      serverSourceCodeType: "ASP.NET",
    }
    expect(repoSourceType(repo)).toBe("ASP.NET MVC / ASP.NET")
    expect(repoEnd("FRONT_AND_SERVER_END")).toBe("both")
    expect(repoSourceType(product.repos[0])).toBe("ASP.NET Core")
  })

  test("repository names from URLs match owner/repo", () => {
    expect(repoKey("https://github.com/TechExcel/P1_Admin_API_12.git")).toBe("techexcel/p1_admin_api_12")
    expect(repoKey("git@github.com:TechExcel/P1_VP12.git")).toBe("techexcel/p1_vp12")
    expect(repoKey("TechExcel/P1_VP12")).toBe("techexcel/p1_vp12")
  })
})

describe("folder picker bridge", () => {
  test("Pilot's probe and pick requests reach the host", () => {
    const calls: Array<[string, boolean]> = []
    const hooks = { setToken: () => {}, chooseFolder: (id: string, pick: boolean) => calls.push([id, pick]) }
    expect(handlePluginMessage({ type: "canChooseFolder", requestId: "a" }, hooks)).toBe(true)
    expect(handlePluginMessage({ type: "chooseFolder", requestId: "b" }, hooks)).toBe(true)
    expect(calls).toEqual([
      ["a", false],
      ["b", true],
    ])
  })
})

describe("full window bridge", () => {
  test("Pilot's mind map asks for the whole window and gives it back", () => {
    const calls: boolean[] = []
    const hooks = { setToken: () => {}, fullWindow: (open: boolean) => calls.push(open) }
    expect(handlePluginMessage({ type: "fullWindow", open: true }, hooks)).toBe(true)
    expect(handlePluginMessage({ type: "fullWindow", open: false }, hooks)).toBe(true)
    expect(calls).toEqual([true, false])
  })
})

describe("shared server order and folder search", () => {
  test("reordering sends the whole list, first to last", async () => {
    const sent: { url: string; method?: string; body?: string }[] = []
    const http = (async (url: string, init?: RequestInit) => {
      sent.push({ url, method: init?.method, body: String(init?.body) })
      return new Response(JSON.stringify({ ok: true }))
    }) as unknown as typeof fetch
    await reorderSharedServers("t", [3, 1, 2], 7, http)
    expect(sent).toHaveLength(1)
    expect(sent[0].url.endsWith("/shared-ai-coding-servers/order")).toBe(true)
    expect(sent[0].method).toBe("PUT")
    expect(JSON.parse(sent[0].body!)).toEqual({ serverIds: [3, 1, 2] })
  })

  test("a folder search keeps matched folders and the checkouts it saw", async () => {
    const http = (async () =>
      new Response(
        JSON.stringify({
          matches: { "12": "C:\\TX\\KloudMeet", "13": "", "14": 5 },
          checkouts: [{ folder: "C:\\TX\\KloudMeet", remote: "https://github.com/acme/KloudMeet.git", branch: "main" }, { bad: 1 }],
          candidates: { "15": ["C:\\A\\Web", "D:\\B\\Web"], "16": "x" },
          searched: ["C:\\TX", 4],
        }),
      )) as unknown as typeof fetch
    const result = await findRepoFolders("t", 4, 9, 7, http)
    expect(result.matches).toEqual({ "12": "C:\\TX\\KloudMeet" })
    expect(result.checkouts).toEqual([{ folder: "C:\\TX\\KloudMeet", remote: "https://github.com/acme/KloudMeet.git", branch: "main" }])
    expect(result.candidates).toEqual({ "15": ["C:\\A\\Web", "D:\\B\\Web"] })
    expect(result.searched).toEqual(["C:\\TX"])
  })

  test("publish targets keep only well-formed sites, services and containers", async () => {
    const http = (async () =>
      new Response(
        JSON.stringify([
          { kind: "site", name: "KloudSync", folder: "C:\\inetpub\\KloudSync", urls: ["https://kloud.cn", 3], detail: "IIS" },
          { kind: "service", name: "KloudJava", folder: "C:\\Kloud", urls: [], detail: "service running" },
          { kind: "printer", name: "x" },
          { kind: "site" },
        ]),
      )) as unknown as typeof fetch
    const list = await loadPublishTargets("t", 4, 7, http)
    expect(list).toEqual([
      { kind: "site", name: "KloudSync", folder: "C:\\inetpub\\KloudSync", urls: ["https://kloud.cn"], detail: "IIS" },
      { kind: "service", name: "KloudJava", folder: "C:\\Kloud", urls: [], detail: "service running" },
    ])
  })

  test("a failed search says what the server said", async () => {
    const http = (async () =>
      new Response(JSON.stringify({ message: "The server refused the saved login and password." }), {
        status: 422,
      })) as unknown as typeof fetch
    await expect(findRepoFolders("t", 4, 9, 7, http)).rejects.toThrow("refused the saved login")
  })
})

describe("remote dev server AI help", () => {
  test("keeps only form fields with valid values, never a password", async () => {
    let body = ""
    const http = (async (_url: string, init?: RequestInit) => {
      body = String(init?.body)
      return new Response(
        JSON.stringify({
          fields: { name: "Meet.Kloud.Cn", os: "beos", sshPort: 10022, useCoding: "yes", password: "x", publishRole: "testing" },
          reply: "Filled in the name, port and publishing.",
        }),
      )
    }) as unknown as typeof fetch
    const result = await remoteDevServerAiHelp("t", "SiMeet testing server", { name: "Old" }, 7, http)
    expect(JSON.parse(body)).toEqual({ prompt: "SiMeet testing server", form: { name: "Old" } })
    expect(result.fields).toEqual({ name: "Meet.Kloud.Cn", sshPort: 10022, publishRole: "testing" })
    expect(result.reply).toBe("Filled in the name, port and publishing.")
  })
})
