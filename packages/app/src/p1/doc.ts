export type Head = {
  server: string
  project: number
  id: number
  title: string
  pulled: number
}

const B64 = /^[A-Za-z0-9+/]+={0,2}$/

/** Base64 as P1 stores it (UTF-8). Empty when the text is not base64. */
export function decode64(value: string) {
  const clean = value.replace(/\s/g, "")
  if (!clean || clean.length % 4 !== 0 || !B64.test(clean)) return
  const bin = atob(clean)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** Description HTML: already markup, or base64 of markup, or plain text. */
export function htmlOf(value: string) {
  const raw = value.trim()
  if (!raw) return ""
  if (raw.startsWith("<")) return raw
  return decode64(raw) ?? raw
}

export function file(project: number, id: number) {
  return `design/p1/${project}/${id}.md`
}

export function doc(head: Head, body: string) {
  const text = body.trim()
  const lines = [
    "---",
    "p1:",
    `  server: ${JSON.stringify(head.server)}`,
    `  project: ${head.project}`,
    `  item: ${head.id}`,
    `  title: ${JSON.stringify(head.title)}`,
    `  pulled: ${head.pulled}`,
    "---",
    "",
  ]
  if (text) lines.push(text, "")
  return lines.join("\n")
}

/** Description markdown, with the requirement title as the page heading when the HTML has none. */
export function prose(title: string, html: string) {
  const text = markdown(html).trim()
  const name = title.trim()
  if (!name) return text
  if (text.startsWith("# ")) return text
  if (!text) return `# ${name}`
  return `# ${name}\n\n${text}`
}

/** Headings, paragraphs, lists, tables, code, links, and http(s) images. */
export function markdown(html: string) {
  const host = document.createElement("div")
  host.innerHTML = html
  return walk(host)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function walk(node: ParentNode): string {
  let out = ""
  for (const child of node.childNodes) out += piece(child)
  return out
}

function piece(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? "").replace(/\u00a0/g, " ")
    if (!text.trim()) return ""
    return text.replace(/\s+/g, " ")
  }
  if (!(node instanceof HTMLElement)) return ""
  const tag = node.tagName.toLowerCase()
  if (tag === "script" || tag === "style") return ""
  if (tag === "br") return "\n"
  if (tag === "img") return image(node)
  if (tag === "strong" || tag === "b") return `**${walk(node).trim()}**`
  if (tag === "em" || tag === "i") return `*${walk(node).trim()}*`
  if (tag === "code" && node.parentElement?.tagName.toLowerCase() !== "pre") return `\`${walk(node).trim()}\``
  if (tag === "a") return link(node)
  if (/^h[1-6]$/.test(tag)) return `\n\n${"#".repeat(Number(tag[1]))} ${walk(node).trim()}\n\n`
  if (tag === "p") return `\n\n${walk(node).trim()}\n\n`
  if (tag === "ul") return list(node, false, "")
  if (tag === "ol") return list(node, true, "")
  if (tag === "pre") return fence(node)
  if (tag === "table") return table(node)
  return walk(node)
}

function image(node: HTMLElement) {
  const src = node.getAttribute("src") ?? ""
  if (!/^https?:\/\//i.test(src)) return ""
  return `![${node.getAttribute("alt") ?? ""}](${src})`
}

function link(node: HTMLElement) {
  const href = node.getAttribute("href") ?? ""
  const label = walk(node).trim() || href
  if (!href || /^javascript:/i.test(href)) return label
  return `[${label}](${href})`
}

function list(node: HTMLElement, ordered: boolean, pad: string) {
  const items = [...node.children].filter((el): el is HTMLElement => el.tagName === "LI")
  const lines = items.map((li, index) => {
    const mark = ordered ? `${index + 1}. ` : "- "
    const nested: string[] = []
    const host = document.createElement("div")
    for (const child of li.childNodes) {
      if (child instanceof HTMLElement && (child.tagName === "UL" || child.tagName === "OL")) {
        nested.push(list(child, child.tagName === "OL", `${pad}  `).replace(/^\n+|\n+$/g, ""))
        continue
      }
      host.appendChild(child.cloneNode(true))
    }
    const text = walk(host).replace(/\s+/g, " ").trim()
    const rest = nested.filter(Boolean).join("\n")
    return `${pad}${mark}${text}${rest ? `\n${rest}` : ""}`
  })
  return `\n\n${lines.join("\n")}\n\n`
}

function fence(node: HTMLElement) {
  const code = node.querySelector("code") ?? node
  const lang = (code.getAttribute("class") ?? "").match(/language-([\w-]+)/)?.[1] ?? ""
  const text = (code.textContent ?? "").replace(/\n$/, "")
  return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`
}

function table(node: HTMLElement) {
  const rows = [...node.querySelectorAll("tr")]
  if (rows.length === 0) return ""
  const cells = (row: Element) =>
    [...row.children]
      .filter((el) => el.tagName === "TD" || el.tagName === "TH")
      .map((el) => walk(el).replace(/\s+/g, " ").trim().replace(/\|/g, "\\|"))
  const head = cells(rows[0]!)
  if (head.length === 0) return ""
  const body = rows.slice(1).map((row) => cells(row))
  const line = (row: string[]) => `| ${row.join(" | ")} |`
  return `\n\n${[line(head), line(head.map(() => "---")), ...body.map(line)].join("\n")}\n\n`
}
