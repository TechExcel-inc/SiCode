import { describe, expect, test } from "bun:test"
import { CSP, GAP, MARK, assets, blank, bounds, fit, frame, join, link, merge, named, parse, split } from "./design-format"

describe("canvas.json", () => {
  test("reads a design as written", () => {
    const text = JSON.stringify({
      v: 1,
      title: "Requirements",
      screens: {
        "List.html": { x: 0, y: 0, w: 1440, h: 980, title: "List", fluid: true },
        "Board.html": { x: 1520, y: 0, w: 1440, h: 980, title: "Board", fluid: true },
      },
      order: ["Board.html", "List.html"],
      view: { x: 10, y: 20, zoom: 0.5 },
    })
    const canvas = parse(text, ["List.html", "Board.html"], "x")
    expect(canvas.title).toBe("Requirements")
    expect(canvas.order).toEqual(["Board.html", "List.html"])
    expect(canvas.screens["Board.html"]).toEqual({ x: 1520, y: 0, w: 1440, h: 980, title: "Board", fluid: true })
    expect(canvas.view).toEqual({ x: 10, y: 20, zoom: 0.5 })
  })

  test("places screen files that are not listed after the last listed one", () => {
    const text = JSON.stringify({ screens: { "A.html": { x: 0, y: 0, w: 400, h: 800 } }, order: ["A.html"] })
    const canvas = parse(text, ["A.html", "C.html", "B.html", "notes.txt"], "x")
    expect(canvas.order).toEqual(["A.html", "B.html", "C.html"])
    expect(canvas.screens["B.html"].x).toBe(400 + GAP)
    expect(canvas.screens["C.html"].x).toBe(400 + GAP + canvas.screens["B.html"].w + GAP)
    expect(canvas.screens["B.html"].title).toBe("B")
  })

  test("repairs bad values and broken files", () => {
    const text = JSON.stringify({
      screens: { "A.html": { x: "no", w: -5, h: 1e9, title: "  " }, "../evil.html": {}, "x.png": {} },
      order: ["missing.html", 3, "A.html"],
      view: { zoom: 99 },
    })
    const canvas = parse(text, [], "Fallback")
    expect(Object.keys(canvas.screens)).toEqual(["A.html"])
    expect(canvas.screens["A.html"]).toEqual({ x: 0, y: 0, w: 120, h: 20000, title: "A", fluid: false })
    expect(canvas.order).toEqual(["A.html"])
    expect(canvas.title).toBe("Fallback")
    expect(canvas.view?.zoom).toBe(4)
    expect(parse("{ not json", ["A.html"], "T").order).toEqual(["A.html"])
    expect(parse(undefined, [], "T").view).toBeUndefined()
  })

  test("a new design is empty and valid", () => {
    expect(parse(blank("Untitled design"), [], "x")).toEqual({
      v: 1,
      title: "Untitled design",
      screens: {},
      order: [],
      view: undefined,
    })
  })

  test("layout changes land on the file as it is on disk now", () => {
    const disk = JSON.stringify({
      v: 1,
      title: "T",
      note: "kept",
      screens: { "A.html": { x: 0, y: 0, w: 10, h: 10, title: "A" }, "B.html": { x: 5, y: 5, w: 1, h: 1 } },
      order: ["A.html", "B.html"],
    })
    const next = JSON.parse(merge(disk, { "A.html": { x: 300 } }, { x: 1, y: 2, zoom: 0.25 }))
    expect(next.note).toBe("kept")
    expect(next.screens["A.html"]).toEqual({ x: 300, y: 0, w: 10, h: 10, title: "A" })
    expect(next.screens["B.html"]).toEqual({ x: 5, y: 5, w: 1, h: 1 })
    expect(next.order).toEqual(["A.html", "B.html"])
    expect(next.view).toEqual({ x: 1, y: 2, zoom: 0.25 })
  })

  test("a screen placed automatically keeps its whole frame when first moved or resized", () => {
    const disk = JSON.stringify({ v: 1, title: "T", screens: { "A.html": { x: 0, y: 0, w: 10, h: 10 } }, order: ["A.html"] })
    const shown = {
      "A.html": { x: 0, y: 0, w: 10, h: 10, title: "A", fluid: false },
      "B.html": { x: 90, y: 0, w: 1440, h: 980, title: "B", fluid: true },
    }
    const next = JSON.parse(merge(disk, { "B.html": { w: 800, h: 600 } }, undefined, shown))
    expect(next.screens["B.html"]).toEqual({ x: 90, y: 0, w: 800, h: 600, title: "B", fluid: true })
    expect(next.screens["A.html"]).toEqual({ x: 0, y: 0, w: 10, h: 10 })
    const back = parse(JSON.stringify(next), ["A.html", "B.html"], "T")
    expect(back.screens["B.html"]).toEqual({ x: 90, y: 0, w: 800, h: 600, title: "B", fluid: true })
  })

  test("what the file says wins over what the canvas shows", () => {
    const disk = JSON.stringify({ v: 1, title: "T", screens: { "A.html": { x: 5, y: 5, title: "New" } }, order: ["A.html"] })
    const shown = { "A.html": { x: 0, y: 0, w: 10, h: 10, title: "Old", fluid: false } }
    const next = JSON.parse(merge(disk, { "A.html": { w: 20 } }, undefined, shown))
    expect(next.screens["A.html"]).toEqual({ x: 5, y: 5, w: 20, h: 10, title: "New", fluid: false })
  })

  test("a new screen is placed past one the user dragged into its spot", () => {
    const disk = JSON.stringify({
      v: 1,
      title: "T",
      screens: { "B.html": { x: 1878, y: 716, w: 1440, h: 980 }, "A.html": { x: 0, y: 0, w: 1082, h: 622 } },
      order: ["B.html", "A.html"],
    })
    const canvas = parse(disk, ["A.html", "B.html", "C.html"], "T")
    expect(canvas.screens["C.html"]).toMatchObject({ x: 1878 + 1440 + GAP, y: 0 })
  })

  test("names a design after its folder", () => {
    expect(named("design/Requirements.design")).toBe("Requirements")
    expect(named("design\\a\\Board.design\\")).toBe("Board")
  })
})

describe("links between screens", () => {
  const screens = ["List.html", "Board.html", "My Page.html"]
  test("resolve to a screen of the same design", () => {
    expect(link("Board.html", screens)).toBe("Board.html")
    expect(link("./board.html?tab=1#top", screens)).toBe("Board.html")
    expect(link("My%20Page.html", screens)).toBe("My Page.html")
  })
  test("ignore everything else", () => {
    for (const href of ["#top", "https://example.com/Board.html", "/Board.html", "javascript:alert(1)", "Other.html", ""])
      expect(link(href, screens)).toBeUndefined()
  })
})

describe("frames", () => {
  const html = `<!doctype html><html><head><meta http-equiv="refresh" content="0;url=https://x"><title>A</title></head><body><a href="Board.html">Go</a><img src="assets/logo.png"><div style="background:url('./assets/bg.png')"></div></body></html>`
  const files = { "assets/logo.png": "data:image/png;base64,AA", "assets/bg.png": "data:image/png;base64,BB" }

  test("static screens get the policy, their images and no working links", () => {
    const doc = frame(html, { mode: "static", files, fonts: "@font-face{}" })
    expect(doc).toContain(`content="${CSP.replace(/'/g, "'")}"`)
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("<title>"))
    expect(doc).toContain('data-href="Board.html"')
    expect(doc).not.toContain(' href="Board.html"')
    expect(doc).toContain('src="data:image/png;base64,AA"')
    expect(doc).toContain("url('data:image/png;base64,BB')")
    expect(doc).not.toContain("refresh")
    expect(doc).toContain("@font-face{}")
    expect(doc).not.toContain("postMessage")
  })

  test("play keeps links and reports them to the canvas", () => {
    const doc = frame(html, { mode: "play" })
    expect(doc).toContain('href="Board.html"')
    expect(doc).toContain('sicode:"screen"')
  })

  test("a page without a head still gets one", () => {
    expect(frame("<p>hi</p>", { mode: "static" }).startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true)
    expect(frame("<html><body>x</body></html>", { mode: "static" })).toContain("<html><head><meta")
  })

  test("leaves other asset-like text alone", () => {
    expect(assets(`<img src="assets/none.png">`, files)).toBe(`<img src="assets/none.png">`)
  })
})

describe("canvas geometry", () => {
  test("fits every frame in the viewport, never above 100%", () => {
    const canvas = parse(
      JSON.stringify({ screens: { "A.html": { x: 0, y: 0, w: 1000, h: 500 }, "B.html": { x: 1100, y: 0, w: 1000, h: 500 } } }),
      [],
      "T",
    )
    const box = bounds(canvas, 30)
    expect(box).toEqual({ x: 0, y: -30, w: 2100, h: 530 })
    const view = fit(box, 1100, 800, 50)
    expect(view.zoom).toBeCloseTo(1000 / 2100)
    expect(fit({ x: 0, y: 0, w: 100, h: 100 }, 1000, 1000).zoom).toBe(1)
  })
})

describe("hand editor round trip", () => {
  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Board</title>
<script>window.head = 1</script>
<style>body { margin: 0 } .card { color: red }</style>
</head>
<body class="app" onload="init()">
<style>.extra { gap: 8px }</style>
<main id="root"><button id="go" onclick="go()">Go</button><a href="javascript:void(0)">x</a><a href="List.html">List</a>
<iframe srcdoc="<script>parent.alert(1)</script>"></iframe></main>
<script>function go() { location.hash = "x" }</script>
</body>
</html>`

  test("sets aside everything that could run in the editor", () => {
    const parts = split(page)
    expect(parts.css).toContain(".card { color: red }")
    expect(parts.css).toContain(".extra { gap: 8px }")
    expect(parts.body).not.toContain("<script")
    expect(parts.body).not.toContain("onclick")
    expect(parts.body).not.toContain("javascript:")
    expect(parts.body).not.toContain("<iframe")
    expect(parts.body).toContain(MARK)
    expect(parts.head).toContain("window.head")
    expect(parts.head).not.toContain("<style")
    expect(parts.scripts).toHaveLength(1)
  })

  test("saving without changes keeps the page working the same", () => {
    const parts = split(page)
    const saved = join(parts, parts.body, parts.css)
    const again = split(saved)
    expect(again.body).toBe(parts.body)
    expect(again.css).toBe(parts.css)
    expect(again.head).toBe(parts.head)
    expect(again.scripts).toEqual(parts.scripts)
    expect(saved).toContain('onclick="go()"')
    expect(saved).toContain('href="javascript:void(0)"')
    expect(saved).toContain("<iframe srcdoc=")
    expect(saved).toContain('<html lang="en">')
    expect(saved).toContain('<body class="app" onload="init()">')
    expect(saved).not.toContain(MARK)
  })

  test("keeps hand edits and accepts the editor's <body> wrapper", () => {
    const parts = split(page)
    const edited = `<body id="i9x"><main id="root"><button id="go" ${MARK}="${Object.keys(parts.handlers)[0]}">Start</button></main></body>`
    const saved = join(parts, edited, ".card { color: blue }")
    expect(saved).toContain('<button id="go" onclick="go()">Start</button>')
    expect(saved).toContain(".card { color: blue }")
    expect(saved).not.toContain('id="i9x"')
  })
})
