import { describe, expect, test } from "bun:test"
import { html, markdown } from "./design-markdown"

// What the editor does: render to HTML, let the user edit the DOM, save the DOM back as markdown.
const edit = (md: string, change?: (root: HTMLElement) => void) => {
  const root = document.createElement("div")
  root.innerHTML = html(md)
  change?.(root)
  return markdown(root.innerHTML)
}

const cases = {
  table: "| Name | Role |\n| --- | --- |\n| Ada | Lead |\n| Bo | Dev |\n",
  aligned: "| Left | Center | Right |\n| :-- | :-: | --: |\n| a | b | c |\n",
  tasks: "- [ ] todo\n- [x] done\n- plain\n",
  strike: "Some ~~removed~~ text.\n",
  fence: "```ts\nconst a = 1\n\nconst b = 2\n```\n",
  mermaid: "```mermaid\ngraph TD\n  A --> B\n  B --> C\n```\n",
  lists: "- one\n  - nested\n- two\n\n1. first\n2. second\n",
  mixed: "# Title\n\nSome **bold**, *italic* and `code`.\n\n> quote\n\n---\n\n[link](https://example.com)\n",
}

describe("design markdown", () => {
  for (const [name, md] of Object.entries(cases)) {
    test(`${name} survives edit and save unchanged`, () => {
      expect(edit(md)).toBe(md)
    })
  }

  test("a hand edit elsewhere leaves tables, tasks, strikethrough and diagrams intact", () => {
    const md = Object.values(cases).join("\n")
    const out = edit(md, (root) => {
      const p = root.querySelector("p")!
      p.textContent = "Edited by hand."
    })
    expect(out).toBe(md.replace("Some ~~removed~~ text.", "Edited by hand."))
  })

  test("toggling a task checkbox is saved", () => {
    const out = edit(cases.tasks, (root) => {
      root.querySelector("input[type=checkbox]")!.setAttribute("checked", "")
    })
    expect(out).toBe("- [x] todo\n- [x] done\n- plain\n")
  })

  test("rendered diagrams are not saved, only their source", () => {
    const out = edit(cases.mermaid, (root) => {
      const figure = document.createElement("div")
      figure.setAttribute("data-diagram", "")
      figure.innerHTML = "<svg><text>A</text></svg>"
      root.prepend(figure)
    })
    expect(out).toBe(cases.mermaid)
  })

  test("padded tables keep their content", () => {
    const out = edit("| Name  | Role |\n|-------|------|\n| Ada   | Lead |\n")
    expect(out).toBe("| Name | Role |\n| --- | --- |\n| Ada | Lead |\n")
  })
})
