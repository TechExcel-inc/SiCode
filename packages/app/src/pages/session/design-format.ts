// A UI design is a folder `design/<Name>.design/` with `canvas.json` (layout and names) and one
// self-contained HTML file per screen. Everything here is pure, so it is shared by the canvas, the
// gallery and the hand editor, and tested without a browser.

export const EXT = ".design"
export const LAYOUT = "canvas.json"
// Space between frames in a row, and between rows, when a screen has to be placed.
export const GAP = 80
export const ROW = 120
export const WIDTH = 1440
export const HEIGHT = 980

export type Frame = { x: number; y: number; w: number; h: number; title: string; fluid: boolean }
export type View = { x: number; y: number; zoom: number }
export type Canvas = { v: 1; title: string; screens: Record<string, Frame>; order: string[]; view?: View }

const num = (value: unknown, min: number, max: number, fallback: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value * 100) / 100))
}

const json = (text: string | undefined): unknown => {
  if (!text?.trim()) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

export const screen = (name: string) => /^[^/\\]+\.html?$/i.test(name)

export const label = (name: string) => name.replace(/\.html?$/i, "")

/** The design's name from its folder path, such as "Requirements" for design/Requirements.design. */
export const named = (path: string) =>
  (path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? "").replace(/\.design$/i, "")

/** canvas.json as the app shows it: bad values clamped, and every screen file on disk placed, even unlisted ones. */
export function parse(text: string | undefined, files: string[], title: string): Canvas {
  const raw = record(json(text))
  const listed = Object.entries(record(raw.screens)).filter(([name]) => screen(name))
  const screens = Object.fromEntries(
    listed.map(([name, value]) => {
      const item = record(value)
      return [
        name,
        {
          x: num(item.x, -1e6, 1e6, 0),
          y: num(item.y, -1e6, 1e6, 0),
          w: num(item.w, 120, 10000, WIDTH),
          h: num(item.h, 120, 20000, HEIGHT),
          title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : label(name),
          fluid: item.fluid === true,
        } satisfies Frame,
      ]
    }),
  ) as Record<string, Frame>
  const order = [
    ...new Set([
      ...(Array.isArray(raw.order) ? raw.order : []).filter(
        (name): name is string => typeof name === "string" && name in screens,
      ),
      ...Object.keys(screens),
    ]),
  ]
  // A half-written design never hides a screen: files not listed go after the last listed one, in its row,
  // moved further right past any screen the user dragged into that spot.
  const extra = files.filter((name) => screen(name) && !(name in screens)).toSorted((a, b) => a.localeCompare(b))
  extra.forEach((name) => {
    const frames = order.map((item) => screens[item])
    const y = frames.at(-1)?.y ?? 0
    const hit = (x: number) =>
      frames.find(
        (item) =>
          item.x < x + WIDTH + GAP && x < item.x + item.w + GAP && item.y < y + HEIGHT + ROW && y < item.y + item.h + ROW,
      )
    const spot = (x: number): number => {
      const item = hit(x)
      return item ? spot(item.x + item.w + GAP) : x
    }
    const x = spot(frames.filter((item) => item.y === y).reduce((max, item) => Math.max(max, item.x + item.w + GAP), 0))
    screens[name] = { x, y, w: WIDTH, h: HEIGHT, title: label(name), fluid: true }
    order.push(name)
  })
  const view = record(raw.view)
  return {
    v: 1,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : title,
    screens,
    order,
    view:
      "zoom" in view
        ? { x: num(view.x, -1e7, 1e7, 0), y: num(view.y, -1e7, 1e7, 0), zoom: num(view.zoom, 0.05, 4, 0.5) }
        : undefined,
  }
}

/** A new, empty design. */
export const blank = (title: string) => JSON.stringify({ v: 1, title, screens: {}, order: [] }, null, 2) + "\n"

/**
 * Writes the user's layout changes onto canvas.json as it is on disk now, so a move never throws away
 * what the assistant wrote meanwhile. Fields the app does not know are kept. `shown` is the canvas as
 * the user sees it: it fills in what the file lacks, so moving or resizing a screen that was placed
 * automatically (not listed yet) writes its whole frame and it stays where it was.
 */
export function merge(
  text: string | undefined,
  frames: Record<string, Partial<Frame>>,
  view?: View,
  shown: Record<string, Frame> = {},
) {
  const raw = record(json(text))
  const screens = record(raw.screens)
  const next = {
    ...raw,
    v: 1,
    screens: {
      ...screens,
      ...Object.fromEntries(
        Object.entries(frames).map(([name, frame]) => [name, { ...shown[name], ...record(screens[name]), ...frame }]),
      ),
    },
    order: [
      ...new Set([
        ...(Array.isArray(raw.order) ? raw.order.filter((item): item is string => typeof item === "string") : []),
        ...Object.keys(frames),
      ]),
    ],
    ...(view ? { view } : {}),
  }
  return JSON.stringify(next, null, 2) + "\n"
}

const decode = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** The screen a link inside a screen goes to, when it names another screen of the same design. */
export function link(href: string, screens: string[]) {
  const value = href.trim()
  if (!value || value.startsWith("#") || value.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(value)) return
  const name = decode(value.replace(/^(\.\/)+/, "").split(/[?#]/)[0] ?? "")
  if (!name) return
  return screens.find((item) => item === name) ?? screens.find((item) => item.toLowerCase() === name.toLowerCase())
}

/** Bounds of all frames, with room for the name strip above each one. */
export function bounds(canvas: Canvas, strip: number) {
  const frames = canvas.order.map((name) => canvas.screens[name]).filter((item) => !!item)
  if (frames.length === 0) return { x: 0, y: 0, w: WIDTH, h: HEIGHT }
  const x = Math.min(...frames.map((item) => item.x))
  const y = Math.min(...frames.map((item) => item.y - strip))
  return {
    x,
    y,
    w: Math.max(...frames.map((item) => item.x + item.w)) - x,
    h: Math.max(...frames.map((item) => item.y + item.h)) - y,
  }
}

/** The pan and zoom that shows a box whole inside a viewport, never above 100%. */
export function fit(box: { x: number; y: number; w: number; h: number }, width: number, height: number, pad = 48) {
  const zoom = Math.max(0.05, Math.min(1, (width - pad * 2) / box.w, (height - pad * 2) / box.h))
  return {
    zoom,
    x: Math.round((width - box.w * zoom) / 2 - box.x * zoom),
    y: Math.round((height - box.h * zoom) / 2 - box.y * zoom),
  }
}

// What a screen may load: its own inline styles and scripts, the bundled fonts and its images, nothing else.
export const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'"

// Play: links to another screen are reported to the canvas; no link navigates the frame away.
const PLAY = `<script>document.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest("a[href]");if(!a)return;var h=a.getAttribute("href")||"";if(h.charAt(0)==="#")return;e.preventDefault();parent.postMessage({sicode:"screen",href:h},"*")},true)</script>`

// Export: the canvas asks for a PNG and the screen draws itself, inside its sandbox: the page goes into an
// SVG <foreignObject>, the SVG onto a canvas, and the PNG back to the canvas. Everything it uses is inline.
const SHOT = `<script>addEventListener("message",function(e){if(!e.data||e.data.sicode!=="shot")return;var d=e.data,s=d.scale||1;(document.fonts?document.fonts.ready:Promise.resolve()).then(function(){var c=document.documentElement.cloneNode(true);c.querySelectorAll("script").forEach(function(x){x.remove()});var o=document.querySelectorAll("input,textarea,select"),n=c.querySelectorAll("input,textarea,select");o.forEach(function(x,i){var y=n[i];if(!y)return;if(x.type==="checkbox"||x.type==="radio"){if(x.checked)y.setAttribute("checked","")}else if(x.tagName==="TEXTAREA"){y.textContent=x.value}else y.setAttribute("value",x.value)});var svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+d.w+'" height="'+d.h+'"><foreignObject x="0" y="0" width="100%" height="100%">'+new XMLSerializer().serializeToString(c)+"</foreignObject></svg>";var img=new Image();img.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svg);return img.decode().then(function(){var k=document.createElement("canvas");k.width=d.w*s;k.height=d.h*s;var g=k.getContext("2d");g.scale(s,s);g.fillStyle="#ffffff";g.fillRect(0,0,d.w,d.h);g.drawImage(img,0,0);parent.postMessage({sicode:"shot",url:k.toDataURL("image/png")},"*")})}).catch(function(err){parent.postMessage({sicode:"shot",error:String(err)},"*")})})</script>`

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")

const inject = (html: string, extra: string) => {
  const head = html.match(/<head\b[^>]*>/i)
  if (head?.index !== undefined) {
    const end = head.index + head[0].length
    return html.slice(0, end) + extra + html.slice(end)
  }
  const root = html.match(/<html\b[^>]*>/i)
  if (root?.index !== undefined) {
    const end = root.index + root[0].length
    return html.slice(0, end) + `<head>${extra}</head>` + html.slice(end)
  }
  return extra + html
}

/** Replaces relative `assets/...` references with the data URLs the frame can load. */
export function assets(html: string, files: Record<string, string>) {
  return html.replace(/(["'(=\s])(?:\.\/)?(assets\/[^"')\s?#>]+)/g, (all, lead: string, file: string) => {
    const url = files[file] ?? files[decode(file)]
    return url ? lead + url : all
  })
}

/**
 * A screen ready for a sandboxed frame. "static" runs nothing and its links go nowhere; "play" runs its
 * scripts and reports links between screens; "shot" also carries the PNG exporter.
 */
export function frame(
  html: string,
  opts: { mode: "static" | "play" | "shot"; fonts?: string; files?: Record<string, string> },
) {
  const source = assets(html, opts.files ?? {})
    // No page reloads itself or moves away on its own.
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, "")
    .replace(/<base\b[^>]*>/gi, "")
  // Without scripts nothing can stop a link from navigating the frame, so static screens have none.
  const page = opts.mode === "static" ? source.replace(/(<a\b[^>]*?\s)href(\s*=)/gi, "$1data-href$2") : source
  const head = [
    `<meta http-equiv="Content-Security-Policy" content="${escape(CSP)}">`,
    opts.fonts ? `<style data-sicode="fonts">${opts.fonts}</style>` : "",
    opts.mode === "static" ? "" : PLAY,
    opts.mode === "shot" ? SHOT : "",
  ].join("")
  return inject(page, head)
}

// Marks an element whose event handlers were set aside while the hand editor has the page.
export const MARK = "data-sicode-on"

type Attr = [string, string]

const unsafe = (name: string, value: string) =>
  /^on/i.test(name) ||
  /^srcdoc$/i.test(name) ||
  (/(^|:)(href|src|action|formaction|data)$/i.test(name) && /^\s*(javascript|vbscript):/i.test(value))

const serialize = (attrs: Attr[]) => attrs.map(([name, value]) => ` ${name}="${escape(value)}"`).join("")

/**
 * Splits a screen for the hand editor. The editor gets the body and the styles; the head, the body's
 * scripts and every event handler stay aside and go back unchanged on save, so a hand edit never breaks
 * Play and nothing in the page runs inside the editor, which shares the app's origin.
 */
export function split(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html")
  const styles = [...doc.querySelectorAll("style")]
  const css = styles
    .map((item) => item.textContent ?? "")
    .join("\n")
    .trim()
  styles.forEach((item) => item.remove())
  const scripts = [...doc.body.querySelectorAll("script")].map((item) => {
    const value = item.outerHTML
    item.remove()
    return value
  })
  // Elements a page can use to run code even without scripts are not shown in the editor.
  const hidden: Record<string, string> = {}
  ;[...doc.body.querySelectorAll("iframe, object, embed, frame, frameset, portal, meta, base, set, animate")].forEach((el, index) => {
    const key = `x${index}`
    hidden[key] = el.outerHTML
    const holder = doc.createElement("div")
    holder.setAttribute(MARK, key)
    el.replaceWith(holder)
  })
  const handlers: Record<string, Attr[]> = {}
  ;[...doc.body.querySelectorAll("*")].forEach((el, index) => {
    const attrs = [...el.attributes].filter((attr) => unsafe(attr.name, attr.value)).map((attr) => [attr.name, attr.value] as Attr)
    if (attrs.length === 0) return
    handlers[String(index)] = attrs
    attrs.forEach(([name]) => el.removeAttribute(name))
    el.setAttribute(MARK, String(index))
  })
  return {
    root: [...doc.documentElement.attributes].map((attr) => [attr.name, attr.value] as Attr),
    head: doc.head.innerHTML.trim(),
    attrs: [...doc.body.attributes].map((attr) => [attr.name, attr.value] as Attr),
    body: doc.body.innerHTML.trim(),
    css,
    scripts,
    handlers,
    hidden,
  }
}

export type Parts = ReturnType<typeof split>

/** The page the hand editor saves: the original head and scripts around the edited body and styles. */
export function join(parts: Parts, body: string, css: string) {
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${body}</body></html>`, "text/html")
  // The editor may wrap its output in <body>; only the content counts.
  const inner = doc.body.querySelector(":scope > body")
  if (inner) doc.body.innerHTML = inner.innerHTML
  ;[...doc.body.querySelectorAll(`[${MARK}]`)].forEach((el) => {
    const key = el.getAttribute(MARK) ?? ""
    el.removeAttribute(MARK)
    const html = parts.hidden[key]
    if (html !== undefined) {
      el.outerHTML = html
      return
    }
    ;(parts.handlers[key] ?? []).forEach(([name, value]) => el.setAttribute(name, value))
  })
  return [
    "<!doctype html>",
    `<html${serialize(parts.root)}>`,
    "<head>",
    parts.head,
    css.trim() ? `<style>\n${css.trim()}\n</style>` : "",
    "</head>",
    `<body${serialize(parts.attrs)}>`,
    doc.body.innerHTML.trim(),
    ...parts.scripts,
    "</body>",
    "</html>",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n")
    .concat("\n")
}
