import { call, lang } from "./api"
import { decode64 } from "./doc"
import { client } from "./http"

/** A requirement's attachments, linked meetings and comments, read and changed the way P1's Description page does. */

/** An attachment: `kind` is P1's AttachmentTypeID (5 pen notes, 6 a linked meeting), `lock` who has it checked out. */
export type Attachment = {
  id: number
  version: number
  name: string
  kind: number
  date: string
  lock: string
  note: string
  // A linked meeting's last change: when, and by whom.
  changed: { date: string; by: string }
}
export type Note = { id: number; by: string; lag: string; html: string; replies: Note[] }

// Images P1 shows as themselves; other files show their type's icon.
const pictures = ["jpg", "jpeg", "png", "gif", "bmp", "webp"]
const icons = [
  "ai",
  "html",
  "ico",
  "jpg",
  "js",
  "md",
  "mov",
  "mp3",
  "mp4",
  "pdf",
  "ppt",
  "ps",
  "rp",
  "sketch",
  "svg",
  "txt",
  "word",
  "xd",
  "xlsx",
  "xmind",
  "zip",
  "rar",
  "key",
]

export function extension(name: string) {
  const dot = name.lastIndexOf(".")
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase()
}

export function picture(name: string) {
  return pictures.includes(extension(name))
}

/** The type icon P1 draws for a file that isn't a picture. */
export function icon(file: Pick<Attachment, "name" | "kind">) {
  if (file.kind === 5) return "note"
  if (file.kind === 6) return "meeting"
  const ext = extension(file.name)
  const name =
    ext === "doc" || ext === "docx"
      ? "word"
      : ext === "xls" || ext === "csv"
        ? "xlsx"
        : ext === "png" || ext === "gif" || ext === "jpeg"
          ? "jpg"
          : ext === "pptx"
            ? "ppt"
            : ext === "7z"
              ? "zip"
              : ext
  return icons.includes(name) ? name : "default"
}

const text = (value: unknown) => (value === undefined || value === null ? "" : String(value))

/** P1's attachment list in file order, without what belongs to another issue type (405). */
export function readFiles(data: unknown): Attachment[] {
  const list = record(data) && Array.isArray(data.AttachmentInfoList) ? data.AttachmentInfoList.filter(record) : []
  return list
    .filter((item) => Number(item.IssueTypeID) !== 405)
    .map((item) => {
      const history = Array.isArray(item.HistorySet) ? item.HistorySet.filter(record) : []
      return {
        id: Number(item.FileID),
        version: Number(item.VersionID) || 0,
        name: text(item.DisplayFileName ?? item.FileName),
        kind: Number(item.AttachmentTypeID) || 0,
        date: text(item.LastCheckInDate),
        lock: text(item.LastCheckOutBy ? (item.LastCheckOutByName ?? item.LastCheckOutBy) : ""),
        note: text(item.AttachmentDescription),
        changed: { date: text(history[0]?.DateChanged), by: text(history[0]?.ChangedBy) },
      }
    })
    .sort((a, b) => a.id - b.id)
}

export function readNotes(data: unknown): Note[] {
  const read = (list: unknown): Note[] =>
    (Array.isArray(list) ? list : []).filter(record).map((item) => ({
      id: Number(item.NoteID),
      by: text(item["Created By"] ?? item.CreatedBy),
      lag: text(item.DateLag ?? item["Created Date"]),
      html: decode64(text(item.Description)) ?? text(item.Description),
      replies: read(item.ChildNoteItems),
    }))
  return read(record(data) ? data.NoteItems : undefined)
}

export async function files(base: string, token: string, project: number, id: number, locale: string) {
  return readFiles(
    await call(base, token, "/DevSpecAPI/ReqAttachmentInfoList", locale, {
      ProjectID: project,
      ItemID: id,
      ViewType: 402,
    }),
  )
}

export async function notes(base: string, token: string, project: number, id: number, locale: string) {
  return readNotes(
    await call(base, token, "/DevSpecAPI/ReqNoteList", locale, {
      ProjectID: project,
      ItemID: id,
      Fields: ["ProjectID", "NoteID", "Title", "Created By", "Created Date", "Description"],
    }),
  )
}

/** A file's bytes as a local URL: its preview size for a thumbnail, or the file itself. */
export async function fetchFile(
  base: string,
  token: string,
  project: number,
  file: Pick<Attachment, "id" | "version">,
  locale: string,
  thumb: boolean,
) {
  const path = thumb ? "ReqAttachmentImage" : "ReqAttachment"
  const url = `${base}/DevSpecAPI/${path}?ProjectID=${project}&FileID=${file.id}&documentType=14&VersionID=${file.version}${thumb ? "&ImageSize=2" : "&ViewType=402"}&languageid=${lang(locale)}`
  const res = await client()(url, { headers: { Authorization: `Bearer ${token}`, UserToken: token } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return URL.createObjectURL(await res.blob())
}

/** Attaches a file to a requirement. */
export async function upload(base: string, token: string, project: number, id: number, file: File, locale: string) {
  const form = new FormData()
  form.append("file", file, file.name)
  const url = `${base}/DevSpecAPI/ReqAttachment?ProjectID=${project}&NoteID=1&FileName=&ItemID=${id}&ViewType=402&documentType=14&languageid=${lang(locale)}`
  const res = await client()(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, UserToken: token },
    body: form,
  })
  if (!res.ok) throw new Error((await res.text().catch(() => "")) || `${res.status} ${res.statusText}`)
}

export async function remove(base: string, token: string, project: number, file: number, locale: string) {
  await call(base, token, `/DevSpecAPI/ReqAttachment/DeleteFile?ProjectID=${project}&FileID=${file}&NoteID=0`, locale)
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

const kinds: Record<number, string> = {
  0: "epic",
  1: "spec",
  2: "epic-document",
  3: "other",
  4: "enhancement",
  5: "defect",
  6: "change",
}

/**
 * The icon P1's list draws before a requirement, one of P1's own (`/p1/spec/{name}.svg`): its kind, with a paperclip
 * when it has attachments, grayed once closed. Epics and their documents share the epic icons; other kinds close to
 * the plain spec's.
 */
export function specIcon(row: { kind: number; closed: boolean; shortcut: boolean; attached: boolean }) {
  if (row.shortcut) return "icon-spec-shortcut"
  const kind = kinds[row.kind] ?? "spec"
  const epic = kind === "epic" || kind === "epic-document"
  if (row.closed) return `${epic ? "epic" : "spec"}${row.attached ? "-attach" : ""}-closed`
  if (row.attached) return epic ? "epic-attach" : `${kind}-attach`
  return kind === "other" ? "spec" : kind
}

/** The LiveDoc Reports in a description, once each, read as P1 reads the Kloud images it embeds. */
export function reports(html: string) {
  const out: { id: string; item: string; src: string }[] = []
  for (const [, src] of html.matchAll(/src="([^"]+)"/g)) {
    if (!src.includes("data") || !src.includes("?")) continue
    const query = Object.fromEntries(
      src
        .slice(src.indexOf("?") + 1)
        .split("&amp;")
        .map((pair) => pair.split("=")),
    )
    const id = query.kloudAttachmentID ?? ""
    if (out.some((item) => item.id === id)) continue
    out.push({ id, item: query.imageItemid ?? "", src })
  }
  return out
}
