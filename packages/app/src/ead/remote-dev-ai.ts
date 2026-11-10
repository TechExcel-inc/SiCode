import type { RemoteDevServerFields } from "./api"

/** Names stay short enough for a server card. */
export const NAME_MAX = 20

/**
 * What the read-only helper agent is asked when AI Help fills the Remote Dev Server form: the admin's words, the form
 * as it is (never a password), the field rules, and to look in the project's files for what the words leave out.
 */
export function remoteDevPrompt(request: string, form: RemoteDevServerFields, saved = false) {
  return [
    "Fill in the form for a Remote Dev Server: a remote computer where software products are coded, built or published.",
    "The admin wrote:",
    `"""${request.trim()}"""`,
    "",
    `The form now holds: ${JSON.stringify(form)}`,
    ...(saved
      ? [
          "This server is already saved, and products may publish to it for its current publishRole. Keep publishRole",
          "as the form holds it unless the admin asks to change it; if the project suggests another, say so in reply.",
        ]
      : []),
    "",
    "Look in this project and its related projects for what the admin's words leave out: deploy and publish scripts,",
    "SSH commands, launch configs, READMEs and docs often name the server's host, port, login and folders.",
    "Be quick: a few searches at most. If something is not found quickly, leave that field out and say so in reply;",
    "do not search other folders for it. Read only what you need; do not open .env files.",
    "",
    "The form fields, with their rules:",
    `- name: what people call the server, at most ${NAME_MAX} characters, e.g. "Meet.Kloud.Cn".`,
    '- os: "windows", "mac" or "linux".',
    '- authMethod: "password", or "key" when the server signs in with a private key file (such as a cloud server\'s .pem).',
    "- sshHost: host name or IP address used for SSH.",
    "- sshPort: SSH port number.",
    "- sshLogin: the user name to sign in with.",
    "- rootFolder: the Default clone folder where repos are checked out, written the way the OS writes paths, e.g. C:\\EAD or ~/EAD.",
    "  It is the parent folder of the source checkouts, not where sites are published (such as C:\\inetpub): change it only",
    "  when the project's files show where the repos are cloned on that server.",
    "- note: one short sentence on what the server is for.",
    "- useCoding: true when products are coded on this server.",
    '- publishRole: "none", "testing" or "production": what this server receives when products are published.',
    "- sshEnabled: true when the server is reached by SSH.",
    "- remoteControl: true when people also see its screen with Remote Desktop or Screen Sharing.",
    "- remotePort: the Remote Control port (3389 for Windows Remote Desktop, 5900 for Mac Screen Sharing).",
    "",
    "Your last message must be one JSON object and nothing else, no code fence:",
    '{"fields": {...}, "reply": "..."}',
    "In fields, put only fields the admin's words or the project's files give, changed from what the form holds.",
    "Never put a password, key, token or other secret anywhere in your answer, even if you read one.",
    "In reply, say in one or two plain sentences what you filled in and where you found it, and what the admin still",
    "has to enter: for a new server, the remote password, or for a key sign-in the key file itself (name the key file's",
    "path if you found it; never its contents). If something cannot be held by this form, say so in reply.",
  ].join("\n")
}

/** Keeps only known form fields with valid values; a password or any other key is dropped. */
export function remoteDevFields(raw: Record<string, unknown>): RemoteDevServerFields {
  const fields: RemoteDevServerFields = {}
  const text = (key: "name" | "sshHost" | "sshLogin" | "rootFolder" | "note", max: number) => {
    const value = raw[key]
    if (typeof value !== "string") return
    const trimmed = value.trim()
    if (!trimmed || trimmed.length > max) return
    if ((key === "sshHost" || key === "sshLogin") && /\s/.test(trimmed)) return
    fields[key] = trimmed
  }
  if (typeof raw.name === "string" && raw.name.trim()) raw = { ...raw, name: raw.name.trim().slice(0, NAME_MAX).trim() }
  text("name", NAME_MAX)
  text("sshHost", 255)
  text("sshLogin", 128)
  text("rootFolder", 512)
  text("note", 1000)
  const os = typeof raw.os === "string" ? raw.os.toLowerCase() : ""
  if (os === "windows" || os === "mac" || os === "linux") fields.os = os
  const auth = typeof raw.authMethod === "string" ? raw.authMethod.toLowerCase() : ""
  if (auth === "password" || auth === "key") fields.authMethod = auth
  const role = typeof raw.publishRole === "string" ? raw.publishRole.toLowerCase() : ""
  if (role === "none" || role === "testing" || role === "production") fields.publishRole = role
  for (const key of ["sshPort", "remotePort"] as const) {
    const value = typeof raw[key] === "string" && /^\d{1,5}$/.test(raw[key] as string) ? Number(raw[key]) : raw[key]
    if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535) fields[key] = value
  }
  for (const key of ["useCoding", "sshEnabled", "remoteControl"] as const)
    if (typeof raw[key] === "boolean") fields[key] = raw[key] as boolean
  return fields
}

/**
 * Reads the helper agent's answer: the last JSON object in its text (it may think aloud first or wrap it in a
 * fence). Throws when there is none, so the admin sees that instead of an unchanged form.
 */
export function parseRemoteDevReply(answer: string) {
  const data = lastJson(answer, ["fields", "reply"])
  if (!data) throw new Error("AI Help's answer could not be read. Try again, or describe the server differently.")
  const raw = data.fields && typeof data.fields === "object" ? (data.fields as Record<string, unknown>) : {}
  return { fields: remoteDevFields(raw), reply: typeof data.reply === "string" ? data.reply.trim() : "" }
}

/**
 * The last JSON object in an agent's answer that has one of {@code keys}: it may think aloud first, wrap it in a
 * code fence or put it after other braces.
 */
export function lastJson(answer: string, keys: string[]) {
  const text = answer.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```[a-z]*\n?|```/g, "")
  for (let end = text.lastIndexOf("}"); end >= 0; end = text.lastIndexOf("}", end - 1)) {
    for (let start = text.lastIndexOf("{", end); start >= 0; start = text.lastIndexOf("{", start - 1)) {
      try {
        const data = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
        if (data && typeof data === "object" && !Array.isArray(data) && keys.some((key) => key in data)) return data
      } catch {
        continue
      }
    }
  }
  return undefined
}

/** What AI Help is doing now, for the line under the description: a string key and the value it names. */
export type RemoteDevStep = { key: "server" | "targets" | "pick" | "read" | "search" | "list" | "think" | "wrap"; value: string }

/** The last two parts of a path, so a long one reads as "scripts/deploy-meet.sh". */
function shortPath(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return ""
  return value.replace(/\\/g, "/").replace(/\/+$/, "").split("/").slice(-2).join("/")
}

/** Turns the helper agent's latest tool call into a step; anything else is thinking. */
export function remoteDevStep(tool: string | undefined, input: Record<string, unknown> | undefined): RemoteDevStep {
  const data = input ?? {}
  if (tool === "read") {
    const file = shortPath(data.filePath ?? data.path)
    if (file) return { key: "read", value: file }
  }
  if (tool === "grep" || tool === "glob") {
    const text = typeof data.pattern === "string" ? data.pattern.trim().slice(0, 60) : ""
    if (text) return { key: "search", value: text }
  }
  if (tool === "list") return { key: "list", value: shortPath(data.path) || "." }
  return { key: "think", value: "" }
}
