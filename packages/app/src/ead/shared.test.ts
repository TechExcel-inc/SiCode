import { describe, expect, test } from "bun:test"
import { formatSharedServerPrompt, repoEnd, repoKey, repoSourceType, type RepoPlace, type ServerProduct } from "./api"
import { handlePluginMessage } from "./bridge"

const server = {
  serverId: 1,
  name: "jinbao dev",
  shortName: "JB Dev",
  os: "windows" as const,
  sshHost: "108.175.14.99",
  sshPort: 50525,
  sshLogin: "administrator",
  rootFolder: "C:\\TX",
  enabled: true,
}

const product: ServerProduct = {
  productId: 12,
  name: "P1 Admin 12",
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
    expect(formatSharedServerPrompt({ product: local, repo: local.repos[0], servers: [] }, true, "/x")).toBeUndefined()
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
