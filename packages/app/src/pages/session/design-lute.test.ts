import { beforeAll, describe, expect, test } from "bun:test"
import { code160to32 } from "vditor/src/ts/util/code160to32"

// In WYSIWYG mode Vditor's setValue renders markdown with Lute's Md2VditorDOM, and getValue
// turns the editor DOM back with VditorDOM2Md plus code160to32. This runs the same bundled Lute the app serves.
type Lute = {
  Md2VditorDOM(md: string): string
  VditorDOM2Md(dom: string): string
  [key: string]: unknown
}

let lute: Lute

beforeAll(async () => {
  new Function(await Bun.file(require.resolve("vditor/dist/js/lute/lute.min.js")).text()).call(globalThis)
  const engine = (globalThis as unknown as { Lute: { New(): Lute } }).Lute.New()
  // Vditor's defaults (src/index.ts setLute).
  const set = (name: string, value: boolean) => (engine[name] as (value: boolean) => void).call(engine, value)
  set("SetGFMAutoLink", true)
  set("SetVditorCodeBlockPreview", true)
  set("SetVditorMathBlockPreview", true)
  set("SetSanitize", true)
  set("SetFootnotes", true)
  set("SetHeadingAnchor", false)
  lute = engine
})

const edit = (md: string, change?: (root: HTMLElement) => void) => {
  const root = document.createElement("div")
  root.innerHTML = lute.Md2VditorDOM(md)
  change?.(root)
  return code160to32(lute.VditorDOM2Md(root.innerHTML))
}

const cases = {
  table: "| Name | Role |\n| ---- | ---- |\n| Ada  | Lead |\n| Bo   | Dev  |\n",
  aligned: "| Left | Center | Right |\n| :--- | :----: | ----: |\n| a    |   b   |     c |\n",
  tasks: "- [ ] todo\n- [X] done\n",
  strike: "Some ~~removed~~ text.\n",
  fence: "```ts\nconst a = 1\n\nconst b = 2\n```\n",
  mermaid: "```mermaid\ngraph TD\n  A --> B\n  B --> C\n```\n",
  lists: "- one\n  - nested\n- two\n\n1. first\n2. second\n",
  mixed: "# Title\n\nSome **bold**, *italic* and `code`.\n\n> quote\n\n---\n\n[link](https://example.com)\n",
}

describe("design markdown through Vditor", () => {
  for (const [name, md] of Object.entries(cases)) {
    test(`${name} survives load and save unchanged`, () => {
      expect(edit(md)).toBe(md)
    })
  }

  test("agent-written tables and tasks settle into one stable form", () => {
    const md = "| Name | Role |\n|---|---|\n| Ada | Lead |\n\n- [x] done\n"
    const once = edit(md)
    expect(once).toBe("| Name | Role |\n| ---- | ---- |\n| Ada  | Lead |\n\n- [X] done\n")
    expect(edit(once)).toBe(once)
  })

  test("spaces typed in the editor are saved as plain spaces", () => {
    const out = edit("Some text.\n", (root) => {
      root.querySelector("p")!.textContent = "two\u00a0small\u00a0words"
    })
    expect(out).toBe("two small words\n")
  })

  test("a hand edit elsewhere leaves tables, tasks, strikethrough and diagrams intact", () => {
    const md = Object.values(cases).join("\n")
    const out = edit(md, (root) => {
      const heading = root.querySelector("h1")!
      heading.textContent = "Renamed"
    })
    expect(out).toBe(md.replace("# Title", "# Renamed"))
  })
})
