import { Marked } from "marked"
import TurndownService from "turndown"
import { tables, taskListItems } from "turndown-plugin-gfm"
import DOMPurify from "dompurify"

// Own instance: the shared one has async extensions (syntax highlighting) registered.
const parser = new Marked({ gfm: true })

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
  hr: "---",
})

turndown.use([tables, taskListItems])

turndown.addRule("strike", {
  filter: (node) => ["DEL", "S", "STRIKE"].includes(node.nodeName),
  replacement: (content) => `~~${content}~~`,
})

// Turndown pads list markers to four columns; keep the "- item" style the agent writes.
turndown.addRule("item", {
  filter: "li",
  replacement: (content, node) => {
    const list = node.parentNode as HTMLElement
    const start = Number(list.getAttribute("start") ?? 1)
    const marker =
      list.nodeName === "OL" ? `${start + Array.prototype.indexOf.call(list.children, node)}. ` : "- "
    const body = content
      .replace(/^\n+/, "")
      .replace(/^(\[[ x]\])\s+/, "$1 ")
      .replace(/\n+$/, "\n")
      .replace(/\n(?=.)/g, "\n" + " ".repeat(marker.length))
    return marker + body + (node.nextSibling && !body.endsWith("\n") ? "\n" : "")
  },
})

// Diagrams are drawn beside their source block; only the source is saved.
turndown.addRule("diagram", {
  filter: (node) => node.nodeType === 1 && node.hasAttribute("data-diagram"),
  replacement: () => "",
})

export const html = (md: string) => DOMPurify.sanitize(parser.parse(md, { async: false }) as string)

export const markdown = (value: string) => turndown.turndown(value).trim() + "\n"
