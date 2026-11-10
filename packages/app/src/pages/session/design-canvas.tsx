import { createEffect, createMemo, For, lazy, on, onCleanup, onMount, Show, Suspense } from "solid-js"
import { createStore, produce } from "solid-js/store"
import type { FileContent } from "@opencode-ai/sdk/v2"
import { Button } from "@opencode-ai/ui/button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { showToast } from "@opencode-ai/ui/toast"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import {
  LAYOUT,
  bounds,
  fit,
  frame,
  link,
  merge,
  named,
  parse,
  screen,
  type Canvas,
  type Frame,
  type View,
} from "./design-format"
import { fonts } from "./design-fonts"
import { setDesign } from "./design-state"

// Only this file and design-editor.tsx know how screens are drawn and edited; the editor loads on Edit.
const Editor = lazy(() => import("./design-editor"))

// Height of a screen's name strip, in screen pixels at any zoom.
const STRIP = 28
const ZOOMS = [0.5, 1, 2]
const SAVE = 500
const VIEW = 1200

const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i

const bytes = (file: FileContent) => Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0))

const save = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))

export function DesignCanvas(props: {
  // The repo the design lives in (the current project or a related one) and the client that writes there.
  client: ReturnType<typeof useSDK>["client"]
  dir: string
  // The design folder, such as design/Requirements.design.
  path: string
  busy: boolean
  // Bumped when the view wrote the design's files itself (undo), so everything is read again.
  stamp: number
  load: (path: string) => Promise<FileContent | undefined>
  // Every file in the folder, relative to it.
  files: (path: string) => Promise<string[]>
  onSelect: (screen: string) => void
  onCount: (count: number) => void
  // The user changed the design by hand, so undoing the AI's change no longer applies.
  onEdit: () => void
}) {
  const sdk = useSDK()
  const language = useLanguage()
  const [state, setState] = createStore({
    canvas: parse(undefined, [], named(props.path)) as Canvas,
    files: [] as string[],
    html: {} as Record<string, string>,
    fonts: {} as Record<string, string>,
    assets: {} as Record<string, string>,
    view: { x: 0, y: 0, zoom: 0.5 } as View,
    size: { w: 0, h: 0 },
    loaded: false,
    selected: "",
    open: "",
    play: false,
    editing: "",
    renaming: "",
    space: false,
  })
  let stage: HTMLDivElement | undefined
  let gone = false
  // canvas.json as this view last wrote it; a change event for that same text is our own write.
  let last = ""
  let touched: Record<string, Partial<Frame>> = {}
  let timer: number | undefined
  let viewer: number | undefined
  const frames = new Map<string, HTMLIFrameElement>()

  const rel = (file: string) => `${props.path}/${file}`
  const names = createMemo(() => state.canvas.order)

  const layout = async () => {
    const [text, files] = await Promise.all([
      props.load(rel(LAYOUT)).then((file) => file?.content),
      props.files(props.path),
    ])
    if (gone) return
    const html = files.filter(screen)
    setState({ canvas: parse(text, html, named(props.path)), files: html })
    props.onCount(state.canvas.order.length)
    return text
  }

  const assets = async () => {
    const files = (await props.files(props.path)).filter((file) => file.startsWith("assets/") && IMAGE.test(file))
    const entries = await Promise.all(
      files.map(async (file) => {
        const item = await props.load(rel(file))
        if (!item?.content) return
        const url =
          item.encoding === "base64"
            ? `data:${item.mimeType ?? "image/png"};base64,${item.content}`
            : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(item.content)}`
        return [file, url] as const
      }),
    )
    if (!gone) setState("assets", Object.fromEntries(entries.filter((item) => !!item)))
  }

  const page = async (name: string) => {
    const file = await props.load(rel(name))
    const html = file?.content ?? ""
    const font = html ? await fonts(html) : ""
    if (gone) return
    setState(
      produce((draft) => {
        if (!html) {
          delete draft.html[name]
          return
        }
        draft.html[name] = html
        draft.fonts[name] = font
      }),
    )
  }

  const all = async () => {
    const text = await layout()
    await Promise.all([assets(), ...state.files.map(page)])
    if (gone) return
    last = text?.trim() ?? ""
    if (!state.loaded) {
      setState("loaded", true)
      if (state.canvas.view) setState("view", state.canvas.view)
      else requestAnimationFrame(zoomfit)
    }
  }

  createEffect(
    on(
      () => props.path,
      () => {
        setState({ loaded: false, selected: "", open: "", play: false, html: {}, fonts: {}, assets: {} })
        void all()
      },
    ),
  )

  createEffect(
    on(
      () => props.stamp,
      () => void all(),
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => state.selected,
      (name) => props.onSelect(name),
    ),
  )

  // ---- saving layout and view ----

  const write = async (view?: View) => {
    const disk = (await props.load(rel(LAYOUT)))?.content
    const next = merge(disk, touched, view, state.canvas.screens)
    const edited = Object.keys(touched).length > 0
    touched = {}
    last = next.trim()
    await props.client.file.write({ path: rel(LAYOUT), content: next }).catch(() => undefined)
    if (edited) props.onEdit()
  }

  const change = (name: string, frame: Partial<Frame>) => {
    touched[name] = { ...touched[name], ...frame }
    setState("canvas", "screens", name, frame)
    if (timer !== undefined) window.clearTimeout(timer)
    timer = window.setTimeout(() => void write(), SAVE)
  }

  // The last pan and zoom are kept per design; never while the assistant is writing the layout.
  const keep = () => {
    if (viewer !== undefined) window.clearTimeout(viewer)
    viewer = window.setTimeout(() => {
      if (props.busy || !state.loaded) return
      void write({ ...state.view })
    }, VIEW)
  }

  // ---- live updates from the assistant and other windows ----

  onMount(() => {
    const dir = props.dir.replace(/\\/g, "/").replace(/\/+$/, "")
    const stop = sdk.event.listen((event) => {
      const detail = event.details as { type: string; properties?: { file?: unknown; event?: unknown } }
      if (detail.type !== "file.edited" && detail.type !== "file.watcher.updated") return
      if (typeof detail.properties?.file !== "string") return
      const value = detail.properties.file.replace(/\\/g, "/")
      const local = value.toLowerCase().startsWith(dir.toLowerCase() + "/") ? value.slice(dir.length + 1) : value
      const root = props.path.replace(/\\/g, "/")
      if (!local.toLowerCase().startsWith(root.toLowerCase() + "/")) return
      const file = local.slice(root.length + 1)
      if (file === LAYOUT) {
        void props.load(rel(LAYOUT)).then((item) => {
          if ((item?.content ?? "").trim() === last) return
          void layout()
        })
        return
      }
      if (file.startsWith("assets/")) {
        void assets()
        return
      }
      if (!screen(file)) return
      if (!state.files.includes(file) || detail.properties.event === "unlink") void layout()
      if (state.editing !== file) void page(file)
    })
    onCleanup(stop)
  })

  // ---- pan and zoom ----

  const zoomto = (zoom: number, px = state.size.w / 2, py = state.size.h / 2) => {
    const next = Math.min(4, Math.max(0.05, zoom))
    const view = state.view
    setState("view", {
      zoom: next,
      x: px - ((px - view.x) * next) / view.zoom,
      y: py - ((py - view.y) * next) / view.zoom,
    })
    keep()
  }

  const zoomfit = () => {
    if (!state.size.w) return
    setState("view", fit(bounds(state.canvas, STRIP), state.size.w, state.size.h))
    keep()
  }

  // Brings a screen into view, as when a link in Play goes to it.
  const reveal = (name: string) => {
    const item = state.canvas.screens[name]
    if (!item || !state.size.w) return
    const zoom = Math.min(
      state.view.zoom,
      fit({ x: item.x, y: item.y - STRIP, w: item.w, h: item.h + STRIP }, state.size.w, state.size.h).zoom,
    )
    setState("view", {
      zoom,
      x: state.size.w / 2 - (item.x + item.w / 2) * zoom,
      y: state.size.h / 2 - (item.y + item.h / 2) * zoom,
    })
    keep()
  }

  // A gesture in progress: panning the canvas, or moving or resizing a screen.
  const drag = (event: PointerEvent, move: (dx: number, dy: number) => void, end?: () => void) => {
    const start = { x: event.clientX, y: event.clientY }
    const target = event.currentTarget as HTMLElement
    if (event.isTrusted) target.setPointerCapture(event.pointerId)
    const onMove = (next: PointerEvent) => move(next.clientX - start.x, next.clientY - start.y)
    const onUp = () => {
      target.removeEventListener("pointermove", onMove)
      target.removeEventListener("pointerup", onUp)
      target.removeEventListener("pointercancel", onUp)
      end?.()
    }
    target.addEventListener("pointermove", onMove)
    target.addEventListener("pointerup", onUp)
    target.addEventListener("pointercancel", onUp)
  }

  const pan = (event: PointerEvent) => {
    const origin = { ...state.view }
    drag(event, (dx, dy) => setState("view", { ...origin, x: origin.x + dx, y: origin.y + dy }), keep)
  }

  const background = (event: PointerEvent) => {
    if (event.button !== 0 && event.button !== 1) return
    if (event.target !== stage && !(event.target as HTMLElement).dataset.layer && !state.space && event.button !== 1)
      return
    if (event.target === stage || (event.target as HTMLElement).dataset.layer) setState("selected", "")
    event.preventDefault()
    pan(event)
  }

  const moving = (event: PointerEvent, name: string) => {
    if (event.button !== 0 || state.renaming === name) return
    event.stopPropagation()
    setState("selected", name)
    if (state.space) return pan(event)
    const origin = { ...state.canvas.screens[name] }
    const zoom = state.view.zoom
    drag(event, (dx, dy) => change(name, { x: Math.round(origin.x + dx / zoom), y: Math.round(origin.y + dy / zoom) }))
  }

  const resizing = (event: PointerEvent, name: string) => {
    if (event.button !== 0) return
    event.stopPropagation()
    const origin = { ...state.canvas.screens[name] }
    const zoom = state.view.zoom
    drag(event, (dx, dy) =>
      change(name, {
        w: Math.max(120, Math.round(origin.w + dx / zoom)),
        h: Math.max(120, Math.round(origin.h + dy / zoom)),
      }),
    )
  }

  const wheel = (event: WheelEvent) => {
    if (state.open || state.editing) return
    event.preventDefault()
    const box = stage!.getBoundingClientRect()
    if (event.ctrlKey || event.metaKey) {
      const delta = Math.max(-50, Math.min(50, event.deltaMode === 1 ? event.deltaY * 20 : event.deltaY))
      return zoomto(state.view.zoom * Math.exp(-delta * 0.006), event.clientX - box.left, event.clientY - box.top)
    }
    setState("view", { ...state.view, x: state.view.x - event.deltaX, y: state.view.y - event.deltaY })
    keep()
  }

  onMount(() => {
    stage?.addEventListener("wheel", wheel, { passive: false })
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setState("size", { w: entry.contentRect.width, h: entry.contentRect.height })
    })
    if (stage) observer.observe(stage)
    const down = (event: KeyboardEvent) => {
      if (typing(event.target) || state.editing) return
      if (event.key === " " && !state.open) {
        event.preventDefault()
        setState("space", true)
      }
      if (event.key === "Escape" && state.open) setState("open", "")
    }
    const up = (event: KeyboardEvent) => {
      if (event.key === " ") setState("space", false)
    }
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    onCleanup(() => {
      stage?.removeEventListener("wheel", wheel)
      observer.disconnect()
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
    })
  })

  // ---- Play: links between screens ----

  onMount(() => {
    const message = (event: MessageEvent) => {
      const data = event.data as { sicode?: string; href?: string } | undefined
      if (data?.sicode !== "screen" || typeof data.href !== "string") return
      const from = [...frames.entries()].find(([, el]) => el.contentWindow === event.source)
      if (!from) return
      const target = link(data.href, names())
      if (!target) return
      if (state.open) return setState({ open: target, selected: target })
      setState("selected", target)
      reveal(target)
    }
    window.addEventListener("message", message)
    onCleanup(() => window.removeEventListener("message", message))
  })

  // Only screens in or near the viewport get a frame, so a big design stays fast.
  const near = (item: Frame) => {
    const view = state.view
    if (!state.size.w || view.zoom < 0.06) return false
    const w = state.size.w / view.zoom
    const h = state.size.h / view.zoom
    const x = -view.x / view.zoom - w / 2
    const y = -view.y / view.zoom - h / 2
    return item.x < x + w * 2 && item.x + item.w > x && item.y < y + h * 2 && item.y + item.h > y
  }

  const doc = (name: string) => {
    const html = state.html[name]
    if (!html) return
    return frame(html, { mode: state.play ? "play" : "static", fonts: state.fonts[name], files: state.assets })
  }

  // ---- hand editing ----

  let release: (() => void) | undefined
  const edit = (name: string) => {
    if (props.busy || !state.html[name]) return
    const wait = new Promise<void>((resolve) => (release = resolve))
    setState({ editing: name, open: "" })
    setDesign({ editing: true, hold: () => wait })
  }
  const done = () => {
    release?.()
    release = undefined
    setState("editing", "")
    setDesign({ editing: false, hold: undefined })
  }
  onCleanup(() => {
    gone = true
    done()
    if (timer !== undefined) {
      window.clearTimeout(timer)
      void write()
    }
    if (viewer !== undefined) window.clearTimeout(viewer)
  })

  const finish = async (name: string, html: string) => {
    const res = await props.client.file
      .write({ path: rel(name), content: html })
      .catch((err: unknown) => ({ error: err }))
    if ("error" in res && res.error) {
      showToast({ title: language.t("design.editor.failed") })
      return
    }
    setState("html", name, html)
    void page(name)
    props.onEdit()
    done()
  }

  // ---- export ----

  const shot = async (name: string) => {
    const html = state.html[name]
    const item = state.canvas.screens[name]
    if (!html || !item) return
    const el = document.createElement("iframe")
    el.setAttribute("sandbox", "allow-scripts")
    el.setAttribute("aria-hidden", "true")
    el.style.cssText = `position:fixed;left:-30000px;top:0;width:${item.w}px;height:${item.h}px;border:0;background:#fff`
    el.srcdoc = frame(html, { mode: "shot", fonts: state.fonts[name], files: state.assets })
    const url = await new Promise<string>((resolve) => {
      const quit = window.setTimeout(() => finish(""), 30_000)
      const finish = (value: string) => {
        window.clearTimeout(quit)
        window.removeEventListener("message", reply)
        resolve(value)
      }
      const reply = (event: MessageEvent) => {
        const data = event.data as { sicode?: string; url?: string } | undefined
        if (event.source !== el.contentWindow || data?.sicode !== "shot") return
        finish(typeof data.url === "string" ? data.url : "")
      }
      window.addEventListener("message", reply)
      el.onload = () =>
        window.setTimeout(
          () => el.contentWindow?.postMessage({ sicode: "shot", w: item.w, h: item.h, scale: 2 }, "*"),
          400,
        )
      document.body.appendChild(el)
    })
    el.remove()
    if (!url.startsWith("data:image/png")) return showToast({ title: language.t("design.export.failed") })
    save(await fetch(url).then((res) => res.blob()), `${state.canvas.screens[name]?.title ?? name}.png`)
  }

  const download = async () => {
    const files = await props.files(props.path)
    const entries = await Promise.all(
      files.map(async (file) => {
        const item = await props.load(rel(file))
        if (!item) return
        const data = item.encoding === "base64" ? bytes(item) : new TextEncoder().encode(item.content.trimEnd() + "\n")
        return [`${named(props.path)}.design/${file}`, data] as const
      }),
    )
    const zip = await import("fflate").then((mod) => mod.zipSync(Object.fromEntries(entries.filter((item) => !!item))))
    save(new Blob([new Uint8Array(zip)], { type: "application/zip" }), `${named(props.path)}.design.zip`)
  }

  // ---- view ----

  const active = createMemo(() => state.open || state.selected)
  const opened = createMemo(() => (state.open ? state.canvas.screens[state.open] : undefined))

  const sandbox = () => (state.play ? "allow-scripts allow-forms" : "")

  const grid = createMemo(() => {
    const size = 24 * state.view.zoom
    return {
      "background-color": "var(--background-weak)",
      "background-image": "radial-gradient(circle, var(--border-weak-base) 1px, transparent 1px)",
      "background-size": `${Math.max(8, size)}px ${Math.max(8, size)}px`,
      "background-position": `${state.view.x}px ${state.view.y}px`,
    }
  })

  return (
    <div data-component="design-canvas" class="relative flex-1 min-h-0 flex flex-col">
      <div class="shrink-0 h-10 px-2 flex items-center gap-1 border-b border-border-weaker-base">
        <Show
          when={state.open}
          fallback={
            <DropdownMenu placement="bottom-start">
              <DropdownMenu.Trigger
                as={Button}
                size="small"
                variant="ghost"
                data-action="design-canvas-zoom"
                aria-label={language.t("design.canvas.zoom")}
                class="min-w-14 tabular-nums"
              >
                {`${Math.round(state.view.zoom * 100)}%`}
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content class="mt-1 min-w-36">
                  <DropdownMenu.Item data-action="design-canvas-fit" onSelect={zoomfit}>
                    <DropdownMenu.ItemLabel>{language.t("design.canvas.fit")}</DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                  <For each={ZOOMS}>
                    {(zoom) => (
                      <DropdownMenu.Item onSelect={() => zoomto(zoom)}>
                        <DropdownMenu.ItemLabel>{`${zoom * 100}%`}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                    )}
                  </For>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu>
          }
        >
          <Tooltip placement="bottom" value={language.t("design.canvas.back")}>
            <IconButton
              icon="arrow-left"
              variant="ghost"
              data-action="design-canvas-back"
              aria-label={language.t("design.canvas.back")}
              onClick={() => setState("open", "")}
            />
          </Tooltip>
          <span class="text-13-medium text-text-strong truncate">{opened()?.title}</span>
        </Show>
        <Button
          size="small"
          variant={state.play ? "primary" : "ghost"}
          icon={state.play ? "stop" : "window-cursor"}
          data-action="design-canvas-play"
          aria-pressed={state.play}
          disabled={names().length === 0}
          onClick={() => setState("play", !state.play)}
        >
          {language.t(state.play ? "design.canvas.stop" : "design.canvas.play")}
        </Button>
        <div class="flex-1" />
        <Show
          when={active()}
          fallback={
            <Show when={names().length > 0}>
              <span class="px-2 text-12-regular text-text-weak truncate">{language.t("design.canvas.select")}</span>
            </Show>
          }
        >
          {(name) => (
            <>
              <Show when={!state.open}>
                <Button
                  size="small"
                  variant="ghost"
                  icon="expand"
                  data-action="design-canvas-open"
                  disabled={!state.html[name()]}
                  onClick={() => setState("open", name())}
                >
                  {language.t("design.canvas.open")}
                </Button>
              </Show>
              <Tooltip placement="bottom" value={language.t("design.canvas.busy")} inactive={!props.busy}>
                <Button
                  size="small"
                  variant="ghost"
                  icon="edit"
                  data-action="design-canvas-edit"
                  disabled={props.busy || !state.html[name()]}
                  onClick={() => edit(name())}
                >
                  {language.t("design.canvas.edit")}
                </Button>
              </Tooltip>
              <Tooltip placement="bottom" value={language.t("design.canvas.export")}>
                <IconButton
                  icon="photo"
                  variant="ghost"
                  data-action="design-canvas-export"
                  aria-label={language.t("design.canvas.export")}
                  disabled={!state.html[name()]}
                  onClick={() => void shot(name())}
                />
              </Tooltip>
            </>
          )}
        </Show>
        <Tooltip placement="bottom" value={language.t("design.canvas.download")}>
          <IconButton
            icon="download"
            variant="ghost"
            data-action="design-canvas-download"
            aria-label={language.t("design.canvas.download")}
            disabled={names().length === 0}
            onClick={() => void download()}
          />
        </Tooltip>
      </div>

      <div
        ref={stage}
        data-slot="design-stage"
        class="relative flex-1 min-h-0 overflow-hidden select-none touch-none"
        classList={{ "cursor-grab": state.space }}
        style={grid()}
        onPointerDown={background}
      >
        <div
          data-layer="1"
          class="absolute top-0 left-0 origin-top-left"
          style={{
            transform: `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.zoom})`,
            width: "1px",
            height: "1px",
          }}
        >
          <For each={names()}>
            {(name) => {
              const item = () => state.canvas.screens[name]
              const selected = () => state.selected === name
              const z = () => state.view.zoom
              return (
                <Show when={item()}>
                  {(f) => (
                    <>
                      <div
                        data-slot="design-screen-name"
                        data-screen={name}
                        class="absolute flex items-end overflow-hidden whitespace-nowrap cursor-default"
                        classList={{ "text-text-interactive-base": selected(), "text-text-weak": !selected() }}
                        style={{
                          left: `${f().x}px`,
                          top: `${f().y - STRIP / z()}px`,
                          width: `${f().w}px`,
                          height: `${STRIP / z()}px`,
                          "font-size": `${12 / z()}px`,
                          // Unitless so it grows with the font; the inherited 150% is a fixed 24px and clips the name.
                          "line-height": "1.3",
                          "padding-bottom": `${6 / z()}px`,
                        }}
                        onPointerDown={(event) => moving(event, name)}
                        onDblClick={() => setState("renaming", name)}
                      >
                        <Show when={state.renaming === name} fallback={<span class="truncate">{f().title}</span>}>
                          <input
                            type="text"
                            value={f().title}
                            data-action="design-screen-rename"
                            ref={(el) =>
                              requestAnimationFrame(() => {
                                el.focus()
                                el.select()
                              })
                            }
                            onPointerDown={(event) => event.stopPropagation()}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") setState("renaming", "")
                              if (event.key !== "Enter") return
                              const value = event.currentTarget.value.trim()
                              setState("renaming", "")
                              if (value && value !== f().title) change(name, { title: value })
                            }}
                            onBlur={() => setState("renaming", "")}
                            class="w-full bg-surface-base border border-border-interactive-base rounded outline-none text-text-strong"
                            style={{ "font-size": `${12 / z()}px`, padding: `0 ${4 / z()}px` }}
                          />
                        </Show>
                      </div>
                      <div
                        data-component="design-screen"
                        data-screen={name}
                        class="absolute bg-white"
                        style={{
                          left: `${f().x}px`,
                          top: `${f().y}px`,
                          width: `${f().w}px`,
                          height: `${f().h}px`,
                          "box-shadow": selected()
                            ? `0 0 0 ${2 / z()}px var(--border-interactive-base)`
                            : `0 0 0 ${1 / z()}px var(--border-weaker-base), 0 ${2 / z()}px ${12 / z()}px rgba(0,0,0,0.08)`,
                        }}
                      >
                        <Show
                          when={near(f()) && doc(name)}
                          fallback={
                            <div
                              class="w-full h-full flex items-center justify-center text-text-weak"
                              style={{ "font-size": `${14 / z()}px` }}
                            >
                              {state.html[name] ? f().title : language.t("design.canvas.writing")}
                            </div>
                          }
                        >
                          {(src) => (
                            <iframe
                              ref={(el) => {
                                frames.set(name, el)
                                onCleanup(() => frames.delete(name))
                              }}
                              sandbox={sandbox()}
                              srcdoc={src()}
                              title={f().title}
                              tabIndex={state.play ? 0 : -1}
                              class="block w-full h-full border-0"
                              style={{ background: "#fff" }}
                            />
                          )}
                        </Show>
                        <Show when={!state.play || state.space}>
                          <div
                            data-slot="design-screen-cover"
                            class="absolute inset-0"
                            onPointerDown={(event) => {
                              if (event.button !== 0) return
                              event.stopPropagation()
                              setState("selected", name)
                              pan(event)
                            }}
                            onDblClick={() => state.html[name] && setState("open", name)}
                          />
                        </Show>
                        <Show when={selected() && !state.play}>
                          <div
                            data-slot="design-screen-resize"
                            class="absolute bg-background-base border-border-interactive-base cursor-nwse-resize"
                            style={{
                              right: `${-6 / z()}px`,
                              bottom: `${-6 / z()}px`,
                              width: `${12 / z()}px`,
                              height: `${12 / z()}px`,
                              "border-width": `${2 / z()}px`,
                              "border-radius": `${3 / z()}px`,
                            }}
                            onPointerDown={(event) => resizing(event, name)}
                          />
                        </Show>
                      </div>
                    </>
                  )}
                </Show>
              )
            }}
          </For>
        </div>
        <Show when={state.loaded && names().length === 0}>
          <div class="absolute inset-0 flex items-center justify-center px-6 pointer-events-none">
            <div class="max-w-sm text-center text-14-regular text-text-weak">{language.t("design.canvas.empty")}</div>
          </div>
        </Show>
      </div>

      <Show when={opened()}>
        {(f) => (
          <div
            data-component="design-screen-open"
            class="absolute inset-x-0 bottom-0 top-10 z-10 bg-background-weak overflow-auto"
          >
            <Show when={doc(state.open)}>
              {(src) => (
                <div class={f().fluid ? "w-full h-full" : "min-w-full min-h-full p-8 flex items-start justify-center"}>
                  <iframe
                    ref={(el) => {
                      const name = state.open
                      frames.set(`open:${name}`, el)
                      onCleanup(() => frames.delete(`open:${name}`))
                    }}
                    sandbox={sandbox()}
                    srcdoc={src()}
                    title={f().title}
                    class="block border-0 bg-white shrink-0"
                    style={
                      f().fluid ? { width: "100%", height: "100%" } : { width: `${f().w}px`, height: `${f().h}px` }
                    }
                  />
                </div>
              )}
            </Show>
          </div>
        )}
      </Show>

      <Show when={state.editing}>
        {(name) => (
          <div data-component="design-screen-edit" class="absolute inset-0 z-20 bg-background-base flex flex-col">
            <Suspense
              fallback={
                <div class="flex-1 flex items-center justify-center text-14-regular text-text-weak">
                  {language.t("design.editor.loading")}
                </div>
              }
            >
              <Editor
                html={state.html[name()] ?? ""}
                title={state.canvas.screens[name()]?.title ?? name()}
                width={state.canvas.screens[name()]?.fluid ? undefined : state.canvas.screens[name()]?.w}
                fonts={state.fonts[name()] ?? ""}
                files={state.assets}
                onDone={(html) => finish(name(), html)}
                onCancel={done}
              />
            </Suspense>
          </div>
        )}
      </Show>
    </div>
  )
}
