// Designs shared through EAD Pilot. A design belongs to a Pilot project (so to its Primary Repository);
// the person who first saves it owns it, and every member of the project can list and open it.
// Owners' designs are sent to Pilot as they change; teammates' designs are read back from Pilot.
import type { FileContent } from "@opencode-ai/sdk/v2"
import type { Cowork, CoworkDesign } from "@/ead/cowork"

// A gallery key for a design that is only in Pilot, not in a folder on this computer.
const PREFIX = "pilot:"

export const remote = (key: string) => key.startsWith(PREFIX)

export const pilotKey = (projectId: number, path: string) => `${PREFIX}${projectId}/${path}`

export function parseKey(key: string) {
  if (!remote(key)) return
  const rest = key.slice(PREFIX.length)
  const at = rest.indexOf("/")
  const id = Number(rest.slice(0, at))
  if (at < 1 || !Number.isInteger(id) || id <= 0) return
  return { projectId: id, path: rest.slice(at + 1) }
}

/** Whether the signed-in person (their Pilot user id, as text) owns the design. */
export const mine = (design: Pick<CoworkDesign, "ownerUserId"> | undefined, user: string) =>
  !design || String(design.ownerUserId) === user

/**
 * A file's bytes as Pilot keeps them. The server reads text trimmed, so text is stored with one
 * final newline, the same bytes a design moved to another project gets.
 */
export function encode(file: Pick<FileContent, "content" | "encoding">) {
  if (file.encoding === "base64") return Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0))
  return new TextEncoder().encode(file.content ? file.content + "\n" : "")
}

/** A file as the app reads it from disk, from the bytes Pilot sends back. */
export function decode(name: string, base64: string): FileContent {
  if (/\.(png|jpe?g|gif|webp|ico|bmp|avif|pdf|docx|woff2?|ttf|otf)$/i.test(name)) {
    return { type: "text", content: base64, encoding: "base64" } as FileContent
  }
  const text = new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)))
  return { type: "text", content: text.trim() } as FileContent
}

export async function sha(data: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(data))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
}

export function base64(data: Uint8Array) {
  const chunks = Array.from({ length: Math.ceil(data.length / 0x8000) }, (_, i) =>
    String.fromCharCode(...data.subarray(i * 0x8000, (i + 1) * 0x8000)),
  )
  return btoa(chunks.join(""))
}

/**
 * Sends the owner's design to Pilot: its list of files first, then only the files Pilot does not
 * have yet. `files` are named relative to a .design folder, or "" for a single-file design.
 * Throws Pilot's error (for example DESIGN_OWNED when the design is someone else's).
 */
export async function publish(
  client: Cowork,
  projectId: number,
  input: { path: string; kind: string; title: string; files: { name: string; file: Pick<FileContent, "content" | "encoding"> }[] },
) {
  const items = await Promise.all(
    input.files.map(async (item) => {
      const data = encode(item.file)
      return { name: item.name, data, size: data.length, sha256: await sha(data) }
    }),
  )
  const res = await client.saveDesign(projectId, {
    path: input.path,
    kind: input.kind,
    title: input.title,
    files: items.map((item) => ({ name: item.name, size: item.size, sha256: item.sha256 })),
  })
  const by = new Map(items.map((item) => [item.name, item]))
  return res.missing.reduce(
    (chain, name) =>
      chain.then(async (design) => {
        const item = by.get(name)
        if (!item) return design
        return client.uploadDesign(projectId, { path: input.path, name, content: base64(item.data) })
      }),
    Promise.resolve(res.design),
  )
}
