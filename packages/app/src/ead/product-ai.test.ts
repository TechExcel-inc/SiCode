import { describe, expect, test } from "bun:test"
import { parseProductReply, productPickPrompt, productPrompt, type ProductAiInput } from "./product-ai"

const blank = { server: "", folder: "", url: "" }
const input: ProductAiInput = {
  product: "Kloud 1.5",
  coding: { name: "Kloud.Cn", os: "windows", rootFolder: "C:\\EAD" },
  repos: [
    { definitionId: 70, name: "Kloud Web", repository: "TechExcel-inc/Kloud-Web", branch: "master", end: "front end", folder: "C:\\EAD\\Kloud-Web" },
    { definitionId: 71, name: "Kloud Java Server", repository: "TechExcel-inc/Kloud-Java-Server", branch: "", end: "back end" },
  ],
  servers: [
    { name: "Kloud.Cn", role: "testing", os: "windows", host: "74.208.27.19", rootFolder: "C:\\EAD", note: "" },
    { name: "eadfm.com", role: "production", os: "linux", host: "52.12.163.181", rootFolder: "~/EAD", note: "" },
  ],
  publish: {
    testing: { frontend: { ...blank }, backend: { ...blank } },
    production: { frontend: { ...blank }, backend: { ...blank } },
  },
}

describe("AI Help for a product", () => {
  test("the agent is told the repos, the servers by role, what Publish to means, and never to give secrets", () => {
    const text = productPrompt("set up publishing", input)
    expect(text).toContain("id 70: Kloud Web (TechExcel-inc/Kloud-Web@master, front end)")
    expect(text).toContain('"Kloud.Cn": testing server')
    expect(text).toContain("C:\\inetpub\\KloudSync")
    expect(text).toContain("Never put a password")
  })

  test("only the product's repos, servers with the row's role and http(s) URLs are kept", () => {
    const out = parseProductReply(
      `Here it is: {"repos": {"70": "C:\\\\EAD\\\\Kloud-Web", "99": "C:\\\\x"},
        "publish": {"testing": {"frontend": {"server": "kloud.cn", "folder": "C:\\\\inetpub\\\\KloudSync", "url": "https://kloud.cn"},
                                "backend": {"server": "eadfm.com", "folder": "KloudJava", "url": "ftp://x"}},
                    "production": {"frontend": {"server": "none"}}},
        "reply": "Set from deploy-web.ps1."}`,
      input,
    )
    expect(out.repos).toEqual({ "70": "C:\\EAD\\Kloud-Web" })
    expect(out.publish.testing?.frontend).toEqual({ server: "Kloud.Cn", folder: "C:\\inetpub\\KloudSync", url: "https://kloud.cn" })
    // eadfm.com is a production server, so it cannot be the testing back end; the folder still comes through.
    expect(out.publish.testing?.backend).toEqual({ folder: "KloudJava" })
    expect(out.publish.production?.frontend).toEqual({ server: "" })
    expect(out.reply).toBe("Set from deploy-web.ps1.")
  })

  test("without a coding server, repo folders are ignored", () => {
    const out = parseProductReply('{"repos": {"70": "C:\\\\EAD\\\\Kloud-Web"}, "reply": "ok"}', { ...input, coding: undefined })
    expect(out.repos).toEqual({})
  })

  test("an answer that is not JSON is reported", () => {
    expect(() => parseProductReply("Sure!", input)).toThrow("could not be read")
  })
})

describe("AI Help after the server search", () => {
  test("the agent gets the checkouts EAD Pilot found and is told to name the folder that holds them", () => {
    const text = productPrompt("x", {
      ...input,
      checkouts: [{ folder: "D:\\Code\\Kloud-Web", remote: "https://github.com/TechExcel-inc/Kloud-Web.git" }],
      searched: ["C:\\", "D:\\"],
    })
    expect(text).toContain("found these git checkouts (folder, then its origin remote), searching C:\\, D:\\:")
    expect(text).toContain("- D:\\Code\\Kloud-Web  https://github.com/TechExcel-inc/Kloud-Web.git")
    expect(text).toContain("change the server's Default clone folder")
  })

  test("no checkouts means the repos must be cloned first", () => {
    expect(productPrompt("x", { ...input, checkouts: [], searched: ["C:\\"] })).toContain("need to be cloned on that server first")
  })
})

describe("choosing from what EAD Pilot read on the servers", () => {
  const lists = [
    {
      server: "Kloud.Cn",
      role: "testing" as const,
      os: "windows",
      targets: [
        { kind: "site" as const, name: "KloudSync", folder: "C:\\inetpub\\KloudSync", urls: ["https://kloud.cn"], detail: "IIS" },
        { kind: "service" as const, name: "KloudJava", folder: "D:\\Kloud\\java", urls: [], detail: "service running, java.exe kloud.jar" },
      ],
    },
    { server: "eadfm.com", role: "production" as const, os: "linux", error: "The server refused the saved login" },
  ]

  test("the model is given every site and service, and why a server could not be read", () => {
    const text = productPickPrompt("set it up", { ...input, repos: [{ ...input.repos[1], candidates: ["D:\\A\\J", "D:\\B\\J"] }] }, lists)
    expect(text).toContain('- site "KloudSync", folder C:\\inetpub\\KloudSync, at https://kloud.cn (IIS)')
    expect(text).toContain('- service "KloudJava", folder D:\\Kloud\\java (service running, java.exe kloud.jar)')
    expect(text).toContain('"eadfm.com": production server, linux. Its sites and services could not be read: The server refused')
    expect(text).toContain("checked out more than once on Kloud.Cn: D:\\A\\J | D:\\B\\J")
    expect(text).toContain("(service <its name>)")
    expect(text).toContain("never invent a folder")
  })

  test("its answer is checked like any other", () => {
    const out = parseProductReply(
      '{"publish": {"testing": {"backend": {"server": "Kloud.Cn", "folder": "D:\\\\Kloud\\\\java (service KloudJava)"}}}, "reply": "ok"}',
      input,
    )
    expect(out.publish.testing?.backend).toEqual({ server: "Kloud.Cn", folder: "D:\\Kloud\\java (service KloudJava)" })
  })
})
