import type { PublishPlace, PublishSide, PublishTarget } from "./api"
import { lastJson } from "./remote-dev-ai"

/** A repo of the product as AI Help sees it: what it is, and the folder it has on the coding server, if ticked. */
export type ProductAiRepo = {
  definitionId: number
  name: string
  repository: string
  branch: string
  /** "front end", "back end" or "front and back end". */
  end: string
  /** Its source folder on this server when ticked; undefined when not developed here. */
  folder?: string
  /** Every checkout of it on the coding server, when it is there more than once. */
  candidates?: string[]
}

/** A server products may publish to, with the role it has. */
export type ProductAiServer = { name: string; role: PublishPlace; os: string; host: string; rootFolder: string; note: string }

export type ProductAiPlace = { server: string; folder: string; url: string }

export type ProductAiInput = {
  product: string
  /** The server the product is coded on, when this popup sets up its repos there. */
  coding?: { name: string; os: string; rootFolder: string }
  repos: ProductAiRepo[]
  servers: ProductAiServer[]
  publish: Record<PublishPlace, Record<PublishSide, ProductAiPlace>>
  /** The git checkouts EAD Pilot found on the coding server over SSH, and where it looked. */
  checkouts?: { folder: string; remote: string }[]
  searched?: string[]
}

const places = ["testing", "production"] as const
const sides = ["frontend", "backend"] as const

/** What the read-only helper agent is asked when AI Help sets up a product's repos and publishing. */
export function productPrompt(request: string, input: ProductAiInput) {
  const repoLines = input.repos.map(
    (repo) =>
      `- id ${repo.definitionId}: ${repo.name} (${repo.repository}${repo.branch ? `@${repo.branch}` : ""}, ${repo.end})` +
      (input.coding ? `; source folder now: ${repo.folder ? JSON.stringify(repo.folder) : "not developed on this server"}` : ""),
  )
  const serverLines = input.servers.length
    ? input.servers.map(
        (row) =>
          `- ${JSON.stringify(row.name)}: ${row.role} server, ${row.os}, host ${row.host}, clone folder ${row.rootFolder}` +
          (row.note ? `. ${row.note}` : ""),
      )
    : ["- none: no server is set up for testing or production publishing yet."]
  return [
    `Set up how the product "${input.product}" is developed and published on its Remote Dev Servers.`,
    "The admin wrote:",
    `"""${request.trim()}"""`,
    "",
    "The product's repos:",
    ...repoLines,
    "",
    ...(input.coding
      ? [
          `It is coded on ${JSON.stringify(input.coding.name)} (${input.coding.os}), whose clone folder is ${input.coding.rootFolder}.`,
          "A repo's source folder is where it is checked out on that server, written the way its OS writes paths.",
          ...(input.checkouts
            ? input.checkouts.length
              ? [
                  `EAD Pilot signed in to ${JSON.stringify(input.coding.name)} and found these git checkouts (folder, then its origin remote)` +
                    (input.searched?.length ? `, searching ${input.searched.join(", ")}:` : ":"),
                  ...input.checkouts.slice(0, 80).map((item) => `- ${item.folder}  ${item.remote || "(no remote)"}`),
                  "Use these real folders for the repos' source folders: match each repo to the checkout whose remote names it.",
                  `If the repos are not under the clone folder ${input.coding.rootFolder}, say in reply which folder holds them, so the`,
                  "admin can change the server's Default clone folder.",
                ]
              : [
                  `EAD Pilot signed in to ${JSON.stringify(input.coding.name)} and found no git checkouts` +
                    (input.searched?.length ? ` in ${input.searched.join(", ")}.` : ".") +
                    " Say in reply that the repos need to be cloned on that server first.",
                ]
            : []),
          "",
        ]
      : []),
    "Servers it can publish to (testing rows take only testing servers, production rows only production servers):",
    ...serverLines,
    "",
    `Publishing as it is now: ${JSON.stringify(input.publish)}`,
    "",
    "Each publishing row (testing or production, for the front end or the back end) has:",
    "- server: the name of one of the servers above with that role, or \"\" for none.",
    "- folder (shown as \"Publish to\"): where the built product goes on that server. For a front end, the web site's",
    "  folder (such as an IIS site folder like C:\\inetpub\\KloudSync, or /var/www/app); for a back end, the folder it runs",
    "  from, or the name of the Windows service or systemd service that runs it.",
    "- url: the https address people open to use or test it there.",
    "",
    "Look in this project and its related projects (the product's repos may be among them) for deploy and publish",
    "scripts, CI workflows, AGENTS.md, READMEs and docs: they often name the host, the site folder, the service and the URL.",
    "Be quick: a few searches at most. If something is not found quickly, leave it out and say so in reply.",
    "Read only what you need; do not open .env files.",
    "",
    "Your last message must be one JSON object and nothing else, no code fence:",
    '{"repos": {"<repo id>": "<source folder>"}, "publish": {"testing": {"frontend": {"server": "...", "folder": "...", "url": "..."}, "backend": {...}}, "production": {...}}, "reply": "..."}',
    input.coding
      ? "In repos, put only source folders the project's files show, for repos of this product."
      : 'Leave "repos" empty.',
    "In publish, put only rows you found or the admin asked for; a row left out stays as it is.",
    "Never put a password, key, token or other secret anywhere in your answer, even if you read one.",
    "In reply, say in one or two plain sentences what you set and where you found it, and what the admin should check.",
  ].join("\n")
}

/** A publish server's sites, services and containers as EAD Pilot read them, or why they could not be read. */
export type ProductAiTargets = { server: string; role: PublishPlace; os: string; targets?: PublishTarget[]; error?: string }

const targetLine = (item: PublishTarget) =>
  `  - ${item.kind} ${JSON.stringify(item.name)}` +
  (item.folder ? `, folder ${item.folder}` : "") +
  (item.urls.length ? `, at ${item.urls.join(" ")}` : "") +
  (item.detail ? ` (${item.detail})` : "")

/**
 * The quick question when EAD Pilot has already read the publish servers: the model only chooses among the sites
 * and services listed (it is given no tools), so it answers in seconds.
 */
export function productPickPrompt(request: string, input: ProductAiInput, lists: ProductAiTargets[]) {
  const repoLines = input.repos.map(
    (repo) =>
      `- id ${repo.definitionId}: ${repo.name} (${repo.repository}${repo.branch ? `@${repo.branch}` : ""}, ${repo.end})` +
      (input.coding
        ? repo.candidates && repo.candidates.length > 1
          ? `; checked out more than once on ${input.coding.name}: ${repo.candidates.join(" | ")}`
          : `; source folder on ${input.coding.name}: ${repo.folder ? repo.folder : "not found"}`
        : ""),
  )
  const serverLines = lists.flatMap((list) => [
    `${JSON.stringify(list.server)}: ${list.role} server, ${list.os}` +
      (list.error ? `. Its sites and services could not be read: ${list.error}` : list.targets?.length ? ", with:" : ", with no sites or services found."),
    ...(list.targets ?? []).map(targetLine),
  ])
  return [
    `Choose where the product "${input.product}" is published, from what EAD Pilot found on its servers.`,
    "The admin wrote:",
    `"""${request.trim()}"""`,
    "",
    "The product's repos:",
    ...repoLines,
    "",
    "Its publish servers and what runs on them:",
    ...serverLines,
    "",
    `Publishing as it is now: ${JSON.stringify(input.publish)}`,
    "",
    "Rules:",
    "- There are four rows: testing and production, each for the front end and the back end. A testing row takes only a",
    "  testing server, a production row only a production server.",
    "- Front end: choose the site whose name, address or folder fits this product or its front-end repo. folder is the",
    "  site's folder, url its first address.",
    "- Back end: choose the service that runs the product's back end (its name, folder or program names a back-end repo,",
    "  such as a .jar for Java or a .dll for .NET); folder is \"<its folder> (service <its name>)\". If the back end is",
    "  hosted as a site instead (an IIS app, or an nginx site that proxies to it), use that site's folder and address.",
    "  The product has one back-end row: if it has several back-end repos, choose for the main one (the one the admin",
    "  names, otherwise the first) and name the others in reply.",
    "- A row whose current values already fit stays as it is. Leave out a row you cannot decide; never invent a folder.",
    ...(input.coding
      ? ["- For a repo checked out more than once, put the folder that fits best in repos, or leave it out if unsure."]
      : []),
    "",
    "Reply with one JSON object and nothing else, no code fence:",
    '{"repos": {"<repo id>": "<source folder>"}, "publish": {"testing": {"frontend": {"server": "...", "folder": "...", "url": "..."}, "backend": {...}}, "production": {...}}, "reply": "..."}',
    "In reply, say in one or two plain sentences what you chose and why, and anything the admin should check.",
  ].join("\n")
}

/** The checked answer: folders by repo id, publishing rows to change, and a sentence for the admin. */
export type ProductAiResult = {
  repos: Record<string, string>
  publish: Partial<Record<PublishPlace, Partial<Record<PublishSide, Partial<ProductAiPlace>>>>>
  reply: string
}

const text = (value: unknown, max: number) => {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length <= max ? trimmed : undefined
}

/**
 * Reads the agent's answer, keeping only what the popup can hold: folders for the product's own repos, and rows whose
 * server is one with that role (matched by name, ignoring case) or "" for none, with an http(s) URL.
 */
export function parseProductReply(answer: string, input: ProductAiInput): ProductAiResult {
  const data = lastJson(answer, ["repos", "publish", "reply"])
  if (!data) throw new Error("AI Help's answer could not be read. Try again, or describe it differently.")
  const repos: Record<string, string> = {}
  const ids = new Set(input.repos.map((repo) => String(repo.definitionId)))
  if (input.coding && data.repos && typeof data.repos === "object") {
    for (const [key, value] of Object.entries(data.repos as Record<string, unknown>)) {
      const folder = text(value, 512)
      if (ids.has(key) && folder) repos[key] = folder
    }
  }
  const publish: ProductAiResult["publish"] = {}
  const given = data.publish && typeof data.publish === "object" ? (data.publish as Record<string, unknown>) : {}
  for (const place of places) {
    const rows = given[place] && typeof given[place] === "object" ? (given[place] as Record<string, unknown>) : {}
    for (const side of sides) {
      const row = rows[side] && typeof rows[side] === "object" ? (rows[side] as Record<string, unknown>) : undefined
      if (!row) continue
      const out: Partial<ProductAiPlace> = {}
      const server = text(row.server, 80)
      if (server !== undefined) {
        const match = input.servers.find((item) => item.role === place && item.name.toLowerCase() === server.toLowerCase())
        if (match) out.server = match.name
        else if (server === "" || server.toLowerCase() === "none") out.server = ""
      }
      const folder = text(row.folder, 512)
      if (folder) out.folder = folder
      const url = text(row.url, 500)
      if (url && /^https?:\/\/\S+$/i.test(url)) out.url = url
      if (Object.keys(out).length) (publish[place] ??= {})[side] = out
    }
  }
  return { repos, publish, reply: typeof data.reply === "string" ? data.reply.trim().slice(0, 800) : "" }
}
