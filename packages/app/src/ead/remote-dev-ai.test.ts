import { describe, expect, test } from "bun:test"
import { parseRemoteDevReply, remoteDevFields, remoteDevPrompt } from "./remote-dev-ai"

describe("AI Help for Remote Dev Servers", () => {
  test("the agent is told the rules, the form, and never asked for a secret", () => {
    const prompt = remoteDevPrompt("  eadfm.com for EAD Pilot  ", { name: "Old", sshPort: 22 })
    expect(prompt).toContain('"""eadfm.com for EAD Pilot"""')
    expect(prompt).toContain('{"name":"Old","sshPort":22}')
    expect(prompt).toContain("do not open .env files")
    expect(prompt).toContain("Never put a password")
  })

  test("reads the last JSON object even after thinking aloud or inside a fence", () => {
    const answer = [
      "I looked at deploy.sh: it uses ssh ubuntu@52.12.163.181 {not json}.",
      "```json",
      '{"fields": {"name": "EADFM.Com", "sshHost": "52.12.163.181", "sshLogin": "ubuntu", "password": "x"},',
      ' "reply": "Found the host and login in deploy.sh. It is a Linux server, which the form cannot hold yet."}',
      "```",
    ].join("\n")
    expect(parseRemoteDevReply(answer)).toEqual({
      fields: { name: "EADFM.Com", sshHost: "52.12.163.181", sshLogin: "ubuntu" },
      reply: "Found the host and login in deploy.sh. It is a Linux server, which the form cannot hold yet.",
    })
  })

  test("an answer without JSON says so", () => {
    expect(() => parseRemoteDevReply("I could not find anything.")).toThrow("could not be read")
  })

  test("bad values and unknown fields are dropped; long names are cut to 20", () => {
    expect(
      remoteDevFields({
        name: "  A name that is much longer than twenty  ",
        os: "BeOS",
        sshPort: "10022",
        remotePort: 70000,
        publishRole: "Production",
        useCoding: "yes",
        sshHost: "bad host",
        token: "abc",
      }),
    ).toEqual({ name: "A name that is much", sshPort: 10022, publishRole: "production" })
  })
})

describe("Linux and key file sign-in", () => {
  test("a Linux server that signs in with a key file is filled in, never with the key", () => {
    const out = parseRemoteDevReply(
      '{"fields": {"os": "Linux", "authMethod": "Key", "sshLogin": "ubuntu", "privateKey": "-----BEGIN RSA PRIVATE KEY-----"}, "reply": "Choose the .pem file."}',
    )
    expect(out.fields).toEqual({ os: "linux", authMethod: "key", sshLogin: "ubuntu" })
  })

  test("the prompt offers Linux and key files", () => {
    const text = remoteDevPrompt("eadfm.com", {})
    expect(text).toContain('"linux"')
    expect(text).toContain("authMethod")
    expect(text).toContain("never its contents")
  })
})

describe("a saved server", () => {
  test("keeps its publishing role unless the admin asks", () => {
    expect(remoteDevPrompt("check it", { publishRole: "testing" }, true)).toContain("Keep publishRole")
    expect(remoteDevPrompt("check it", { publishRole: "testing" })).not.toContain("Keep publishRole")
  })
})

describe("AI Help progress", () => {
  test("tool calls become plain steps", () => {
    const { remoteDevStep } = require("./remote-dev-ai") as typeof import("./remote-dev-ai")
    expect(remoteDevStep("read", { filePath: "/Users/t/KloudMeet/scripts/deploy-meet.sh" })).toEqual({ key: "read", value: "scripts/deploy-meet.sh" })
    expect(remoteDevStep("grep", { pattern: "74.208.27.19" })).toEqual({ key: "search", value: "74.208.27.19" })
    expect(remoteDevStep("list", {})).toEqual({ key: "list", value: "." })
    expect(remoteDevStep(undefined, undefined)).toEqual({ key: "think", value: "" })
    expect(remoteDevStep("read", { filePath: "C:\\TX\\Kloud-Web\\AGENTS.md" })).toEqual({ key: "read", value: "Kloud-Web/AGENTS.md" })
  })

  test("the clone folder is not a publish folder", () => {
    expect(remoteDevPrompt("x", {})).toContain("not where sites are published")
  })
})
