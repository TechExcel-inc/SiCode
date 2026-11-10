import { createEffect, createMemo, For, Match, on, onCleanup, onMount, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { KeepView, useViewShown } from "./keep-view"
import { useNavigate } from "@solidjs/router"
import DOMPurify from "dompurify"
import type Vditor from "vditor"
import type { FileContent } from "@opencode-ai/sdk/v2"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { showToast } from "@opencode-ai/ui/toast"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useLanguage, type Locale } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useCowork } from "@/context/cowork"
import { useSync } from "@/context/sync"
import { design, setDesign } from "./design-state"
import { Gallery, type Type } from "./design-gallery"
import { useSessionKey } from "./session-layout"
import { DesignCanvas } from "./design-canvas"
import { LAYOUT } from "./design-format"
import "vditor/dist/index.css"
import "./design.css"

const ROOT = "design"
// Pages written before the tab was renamed stay where they are and keep opening.
const LEGACY = "wiki"
const DELAY = 800
const POLL = 4000
// Vditor's runtime scripts (markdown engine, icons, languages, diagrams), served by the app; see vite.js.
const CDN = "/vditor"

const KINDS = {
  md: "markdown",
  markdown: "markdown",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  bmp: "image",
  avif: "image",
  svg: "image",
  pdf: "pdf",
  html: "html",
  htm: "html",
  docx: "docx",
} as const

type Kind = (typeof KINDS)[keyof typeof KINDS] | "design"

// A folder ending in .design is one UI design: canvas.json and one HTML page per screen.
const folder = (path: string) => /\.design\/?$/i.test(path)

const kind = (path: string): Kind | undefined =>
  folder(path) ? "design" : KINDS[path.split(".").pop()?.toLowerCase() as keyof typeof KINDS]

const root = (path: string) => (path.startsWith(LEGACY + "/") ? LEGACY : ROOT)

const title = (path: string) => path.slice(root(path).length + 1).replace(/\.(md|markdown|design)$/i, "")

const slug = (name: string) =>
  name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, " ")

const page = (file: string, dir: string) => {
  const value = file.replace(/\\/g, "/")
  // Windows directories come with backslashes; compare both sides with forward slashes.
  const base = dir.replace(/\\/g, "/").replace(/\/+$/, "")
  const rel = value.startsWith(base + "/") ? value.slice(base.length + 1) : value
  if (!rel.startsWith(ROOT + "/") && !rel.startsWith(LEGACY + "/")) return
  // Any file inside a design belongs to the design.
  const design = rel.match(/^(.*?\.design)(\/|$)/i)?.[1]
  if (design) return design
  if (!kind(rel)) return
  return rel
}

const same = (a: string, b: string) => a.trim() === b.trim()

const bytes = (file: FileContent) => Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0))

const LANGS: Partial<Record<Locale, NonNullable<IOptions["lang"]>>> = {
  en: "en_US",
  zh: "zh_CN",
  zht: "zh_TW",
  ko: "ko_KR",
  de: "de_DE",
  es: "es_ES",
  fr: "fr_FR",
  ja: "ja_JP",
  ru: "ru_RU",
  br: "pt_BR",
}

// Same toolbar as Kloud-Web's markdown editor.
const TOOLBAR = [
  "headings",
  "bold",
  "italic",
  "strike",
  "link",
  "|",
  "list",
  "ordered-list",
  "check",
  "outdent",
  "indent",
  "|",
  "quote",
  "line",
  "code",
  "inline-code",
  "insert-before",
  "insert-after",
  "|",
  "table",
  "|",
  "undo",
  "redo",
  "|",
  "fullscreen",
  "edit-mode",
]

const dark = () => document.documentElement.dataset.colorScheme === "dark"

// Remembers which session's agent last wrote each design doc, whichever tab is open at the time.
export function useDesignLinks() {
  const sdk = useSDK()
  const layout = useLayout()
  const cowork = useCowork()
  // The repo a written file is in: a related project's design folder is shown in the Design tab too.
  const owner = (file: string) => {
    const value = file.replace(/\\/g, "/")
    return (
      cowork
        .relatedDirs(sdk.directory)
        .find((dir) => value.startsWith(dir.replace(/\\/g, "/").replace(/\/+$/, "") + "/")) ?? sdk.directory
    )
  }
  // Subagents write on behalf of the session that started them; link the doc to that one.
  const top = async (id: string): Promise<string> => {
    const info = await sdk.client.session
      .get({ sessionID: id })
      .then((res) => res.data)
      .catch(() => undefined)
    return info?.parentID ? top(info.parentID) : id
  }
  onMount(() => {
    const stop = sdk.event.listen((event) => {
      // A screen added to or removed from a design outside the app (a shell, another editor) still
      // refreshes its card; a plain change does not, so panning the canvas is not an edit.
      const detail = event.details as { type: string; properties?: { file?: unknown; event?: unknown } }
      if (detail.type === "file.watcher.updated" && detail.properties?.event !== "change") {
        const file =
          typeof detail.properties?.file === "string" ? page(detail.properties.file, sdk.directory) : undefined
        if (file && kind(file) === "design") layout.design.touch(sdk.directory, file, "edited")
        return
      }
      if (event.details.type !== "file.edited") return
      const id = event.details.properties.sessionID
      const where = owner(event.details.properties.file)
      const file = page(event.details.properties.file, where)
      if (!file) return
      layout.design.touch(where, file, "edited")
      if (!id || kind(file) !== "markdown") return
      void top(id).then((session) => layout.design.link(where, file, session))
    })
    onCleanup(stop)
  })
}

// Top of the chat beside the Design tab: which doc the assistant is working on.
export function DesignChatHeader() {
  const language = useLanguage()
  return (
    <div
      data-component="design-chat-header"
      class="shrink-0 h-12 px-4 flex items-center gap-2 border-b border-border-weaker-base"
    >
      <Icon name="design" size="small" class="shrink-0 text-icon-weak" />
      <span class="min-w-0 truncate text-14-medium text-text-strong">
        {design.title ? language.t("design.chat.title", { doc: design.title }) : language.t("design.chat.assistant")}
      </span>
    </div>
  )
}

// Shown in the chat before the doc has a conversation; nothing is created until the first message.
export function DesignChatEmpty() {
  const language = useLanguage()
  return (
    <div class="h-full flex flex-col items-center justify-center gap-2 px-6 text-center">
      <div class="text-14-medium text-text-strong">
        {language.t(
          design.empty
            ? "design.chat.screens.title"
            : design.blank
              ? "design.chat.image.title"
              : "design.chat.empty.title",
        )}
      </div>
      <div class="text-13-regular text-text-weak max-w-xs">
        {language.t(
          design.empty
            ? "design.chat.screens.body"
            : design.blank
              ? "design.chat.image.body"
              : "design.chat.empty.body",
        )}
      </div>
    </div>
  )
}

export function DesignView() {
  return (
    <KeepView nav="design">
      <Design />
    </KeepView>
  )
}

function Design() {
  const sdk = useSDK()
  const layout = useLayout()
  const platform = usePlatform()
  const prompt = usePrompt()
  const language = useLanguage()
  const navigate = useNavigate()
  const dialog = useDialog()
  const sync = useSync()
  const { params } = useSessionKey()
  const cowork = useCowork()
  const [state, setState] = createStore({
    // The repo whose design folder is on screen: "" for the current project, else a related project's folder.
    home: "",
    // The gallery's tab: "" lists every repo's designs, else one repo's folder.
    tab: "",
    // A folder inside the repo's design folder the gallery is narrowed to, such as design/sub; "" for all.
    folder: "",
    // Where the open design was opened from: "agent" when clicked in a session, so Back returns there.
    from: "",
    pages: [] as string[],
    listed: false,
    active: "",
    status: "idle" as "idle" | "saving" | "saved" | "error" | "updated",
    conflict: false,
    file: undefined as FileContent | undefined,
    loading: false,
    // The doc as it was before the AI's latest round of edits, for one-click undo.
    undo: undefined as string | undefined,
    // A design: its files before the AI's latest turn, and which of them that turn changed or added.
    snap: undefined as Record<string, string> | undefined,
    changed: [] as string[],
    // Bumped after this view rewrites a design's files, so the canvas reads them again.
    stamp: 0,
    // The design's selected screen and how many screens it has.
    screen: "",
    screens: -1,
  })
  // Every file call goes to the repo on screen; paths stay relative to it.
  const dir = () => state.home || sdk.directory
  const client = createMemo(() => (state.home ? sdk.createClient({ directory: state.home }) : sdk.client))
  // A related project's file is named by its full path in the chat, which runs in the current project.
  const full = (path: string) => (state.home ? `${state.home}/${path}` : path)
  // The current project first, then its related projects, each with its own design folder.
  const homes = createMemo(() => [
    sdk.directory,
    ...cowork.relatedDirs(sdk.directory).filter((item) => item !== sdk.directory),
  ])
  const go = async (to: string) => {
    if (to === dir()) return
    await close()
    setState("home", to === sdk.directory ? "" : to)
  }
  const clients = new Map<string, ReturnType<typeof sdk.createClient>>()
  const reach = (home: string) => {
    if (home === sdk.directory) return sdk.client
    const known = clients.get(home)
    if (known) return known
    const made = sdk.createClient({ directory: home })
    clients.set(home, made)
    return made
  }
  // The gallery lists every repo's designs: the current project's by their path in it, a related project's by
  // its folder and that path, so each item finds its repo again.
  const split = (key: string) => {
    const value = key.replace(/\\/g, "/")
    const home = homes()
      .slice(1)
      .find((item) => value.startsWith(item.replace(/\\/g, "/").replace(/\/+$/, "") + "/"))
    return home
      ? { home, rel: value.slice(home.replace(/\\/g, "/").replace(/\/+$/, "").length + 1) }
      : { home: sdk.directory, rel: key }
  }
  const named = (home: string) => home.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? home
  const visible = createMemo(() =>
    state.pages.filter((key) => {
      const item = split(key)
      if (state.tab && item.home !== state.tab) return false
      return !state.folder || item.rel.startsWith(state.folder + "/")
    }),
  )
  // The gallery item's key for a path in the repo on screen: the same key the gallery and its recency use.
  const keyOf = (path: string) => (state.home ? `${state.home}/${path}` : path)
  const count = (home: string) => state.pages.filter((key) => split(key).home === home).length
  // Acting on a gallery item first points the view at its repo.
  const at = (key: string) => {
    const item = split(key)
    setState("home", item.home === sdk.directory ? "" : item.home)
    return item.rel
  }

  let host: HTMLDivElement | undefined
  let editor: Vditor | undefined
  let ready = false
  let gone = false
  let timer: number | undefined
  let dirty = false
  // A doc just created opens with its title selected.
  let fresh = false
  // Set when the agent reports an edit to the open doc; the next reload is offered for undo.
  let ai = false
  // Markdown last loaded from or written to disk for the open page; anything else on disk is an outside edit.
  let last = ""

  const walk = async (dir: string, c = client()): Promise<string[]> => {
    const nodes = await c.file
      .list({ path: dir })
      .then((res) => res.data ?? [])
      .catch(() => [])
    const nested = await Promise.all(
      nodes
        .filter((node) => node.type === "directory" && !node.ignored && !folder(node.name))
        .map((node) => walk(node.path, c)),
    )
    return [
      // A design is keyed by its folder with forward slashes, the way file events name it.
      ...nodes
        .filter((node) => node.type === "directory" && folder(node.name))
        .map((node) => node.path.replace(/\\/g, "/")),
      ...nodes.filter((node) => node.type === "file" && kind(node.name)).map((node) => node.path),
      ...nested.flat(),
    ].sort((a, b) => a.localeCompare(b))
  }

  // Every file in a design folder, relative to it.
  const files = async (dir: string, base = dir, c = client()): Promise<string[]> => {
    const nodes = await c.file
      .list({ path: dir })
      .then((res) => res.data ?? [])
      .catch(() => [])
    const nested = await Promise.all(
      nodes.filter((node) => node.type === "directory").map((node) => files(node.path, base, c)),
    )
    return [
      ...nodes
        .filter((node) => node.type === "file")
        .map((node) => node.path.replace(/\\/g, "/").slice(base.length + 1)),
      ...nested.flat(),
    ]
  }

  // The text files of a design, for undoing the AI's change to it.
  const snapshot = async (dir: string) => {
    const names = (await files(dir)).filter((name) => /\.(html?|json|css|js|svg|md|txt)$/i.test(name))
    const entries = await Promise.all(names.map(async (name) => [name, (await read(`${dir}/${name}`)) ?? ""] as const))
    return Object.fromEntries(entries)
  }

  // Polled; the list only changes (and re-renders) when the files on disk do.
  const list = async () => {
    const next = await Promise.all(
      homes().map(async (home) => {
        const c = reach(home)
        const found = await Promise.all([walk(ROOT, c), walk(LEGACY, c)]).then((all) => all.flat())
        return home === sdk.directory ? found : found.map((path) => `${home}/${path}`)
      }),
    ).then((all) => all.flat())
    if (gone) return
    if (next.join("\n") !== state.pages.join("\n")) setState("pages", next)
    if (!state.listed) setState("listed", true)
  }

  const untitled = (type: Type) => {
    const base = language.t(type.untitled)
    const names = [base, ...Array.from({ length: 98 }, (_, i) => `${base} ${i + 2}`)]
    const taken = state.pages.filter((key) => split(key).home === dir()).map((key) => split(key).rel)
    return names.find((name) => !taken.includes(`${ROOT}/${name}.${type.ext}`)) ?? base
  }

  const pick = () => {
    if (!fresh || !ready) return
    fresh = false
    // After the chat beside it has switched to this doc's session, which can move focus.
    window.setTimeout(() => {
      const heading = host?.querySelector(".vditor-wysiwyg h1")
      if (!heading) return
      editor?.focus()
      const range = document.createRange()
      range.selectNodeContents(heading)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
    }, 250)
  }

  // The chat beside a doc is the session that wrote it. A doc without one gets a blank chat, and the
  // session is only created when the first message is sent (see the params.id effect below).
  const chat = async (path: string) => {
    const id = layout.design.session(dir(), path)
    const alive = id
      ? await sdk.client.session
          .get({ sessionID: id })
          .then((res) => !!res.data)
          .catch(() => false)
      : false
    if (state.active !== path) return
    const target = alive ? id : undefined
    if (target === params.id) return
    navigate(`/${params.dir}/session${target ? `/${target}` : ""}`)
  }

  // Prompt context belongs to the session on screen, so attach the open doc again whenever either changes.
  createEffect(
    on(
      () => [state.active, params.id, state.screen] as const,
      ([path]) => {
        if (path) attach(path)
      },
    ),
  )

  createEffect(
    on(
      () => params.id,
      (id, prev) => {
        if (!id || prev || !state.active) return
        if (!layout.design.session(dir(), state.active)) layout.design.link(dir(), state.active, id)
      },
      { defer: true },
    ),
  )

  const editable = createMemo(() => kind(state.active) === "markdown")

  const load = (path: string) =>
    client()
      .file.read({ path })
      .then((res) => res.data)
      .catch(() => undefined)

  const read = (path: string) => load(path).then((file) => (file ? file.content : undefined))

  // Read-only files: replaced only when their bytes change, so polling never flickers the view.
  // The text of an SVG or HTML file: the assistant edits these, so undo can write the old text back.
  const text = (path: string, file: FileContent | undefined) => {
    if (!file || !/\.(svg|html?)$/i.test(path)) return
    return file.encoding === "base64" ? new TextDecoder().decode(bytes(file)) : file.content
  }

  const preview = async (path: string) => {
    const file = await load(path)
    if (state.active !== path) return
    if (file?.content !== state.file?.content || file?.encoding !== state.file?.encoding) {
      const prev = text(path, state.file)
      if (state.file && prev !== undefined && (ai || busy()) && state.undo === undefined) setState("undo", prev)
      ai = false
      setState("file", file)
    }
    setState("loading", false)
  }

  const show = (content: string) => {
    last = content
    dirty = false
    if (!ready) return
    editor?.setValue(content, true)
    pick()
  }

  // force: the user chose to keep their version over an outside edit.
  const save = async (force?: boolean) => {
    if (!dirty || !editor || !ready || !editable() || (state.conflict && !force)) return
    const path = state.active
    const disk = await read(path)
    if (!force && disk !== undefined && !same(disk, last)) {
      setState("conflict", true)
      return
    }
    dirty = false
    const content = editor.getValue().trim() + "\n"
    setState("status", "saving")
    await client()
      .file.write({ path, content })
      .then(() => {
        layout.design.touch(dir(), path, "edited")
        if (state.active === path) last = content
        setState({ status: state.active === path && !dirty ? "saved" : state.status, conflict: false })
      })
      .catch(() => {
        dirty = true
        setState("status", "error")
      })
  }

  const busy = createMemo(() => !!params.id && (sync.data.session_status[params.id]?.type ?? "idle") !== "idle")

  // Picks up edits made by the agent or another window, but never replaces what the user is typing.
  const check = async () => {
    const path = state.active
    if (!path || state.status === "saving") return
    if (kind(path) === "design") return
    if (!editable()) return preview(path)
    const disk = await read(path)
    if (disk === undefined || same(disk, last) || state.active !== path) return
    if (dirty) {
      setState("conflict", true)
      return
    }
    const agent = ai || busy()
    ai = false
    if (agent && state.undo === undefined) setState("undo", last)
    show(disk)
    setState("status", "updated")
  }

  const revert = async () => {
    const path = state.active
    if (kind(path) === "design") {
      const snap = state.snap
      if (!snap) return
      await Promise.all(
        state.changed.map((name) =>
          name in snap
            ? client().file.write({ path: `${path}/${name}`, content: snap[name] })
            : client().file.remove({ path: `${path}/${name}` }),
        ),
      ).catch(() => undefined)
      setState({ snap: undefined, changed: [], status: "saved", stamp: state.stamp + 1 })
      return
    }
    const prev = state.undo
    if (prev === undefined || !path) return
    await client().file.write({ path, content: prev })
    if (state.active !== path) return
    setState({ undo: undefined, status: "saved" })
    if (editable()) return show(prev)
    await preview(path)
  }

  const flush = async () => {
    if (timer !== undefined) window.clearTimeout(timer)
    await save()
  }

  // The agent reads the doc from disk: save the user's typing as soon as it starts working.
  createEffect(
    on(busy, (value) => {
      if (value) void flush()
      // A design: snapshot its files when the AI starts, and see what its turn changed when it stops.
      const path = state.active
      if (kind(path) !== "design") return
      if (value) {
        void snapshot(path).then((snap) => state.active === path && setState({ snap, changed: [] }))
        return
      }
      const before = state.snap
      if (!before) return
      void snapshot(path).then((after) => {
        if (state.active !== path) return
        const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
          (name) => before[name] !== after[name],
        )
        setState({ changed, snap: changed.length ? before : undefined })
      })
    }),
  )

  // Nothing drawn yet: only the background shape the Image card starts with.
  const blank = createMemo(() => {
    const value = state.active.endsWith(".svg") ? text(state.active, state.file) : undefined
    if (value === undefined) return false
    return (value.match(/<(rect|circle|ellipse|line|polyline|polygon|path|text|image|use)\b/g) ?? []).length <= 1
  })

  createEffect(() =>
    setDesign({
      open: !!state.active,
      doc: editable() ? state.active : "",
      title: state.active ? title(state.active) : "",
      blank: blank(),
      empty: kind(state.active) === "design" && state.screens === 0,
    }),
  )

  const reload = async () => {
    const disk = await read(state.active)
    if (disk === undefined) return
    show(disk)
    setState({ conflict: false, status: "updated" })
  }

  const keep = () => {
    dirty = true
    void save(true)
  }

  const attach = (path: string) => {
    // A design is attached as its layout plus the selected screen, so "this screen" needs no guessing.
    // Word files mean nothing to the agent as raw bytes.
    const want =
      kind(path) === "design"
        ? [full(`${path}/${LAYOUT}`), ...(state.screen ? [full(`${path}/${state.screen}`)] : [])]
        : kind(path) === "docx"
          ? []
          : [full(path)]
    const items = () => prompt.context.items().filter((item) => item.type === "file" && !item.selection)
    items()
      .filter((item) => page(item.path, dir()) && !want.includes(item.path))
      .forEach((item) => prompt.context.remove(item.key))
    want
      .filter((file) => !items().some((item) => item.path === file))
      .forEach((file) => prompt.context.add({ type: "file", path: file }))
  }

  const schedule = () => {
    dirty = true
    if (state.undo !== undefined) setState("undo", undefined)
    setState("status", "idle")
    if (timer !== undefined) window.clearTimeout(timer)
    timer = window.setTimeout(() => void save(), DELAY)
  }

  const open = async (path: string) => {
    if (timer !== undefined) window.clearTimeout(timer)
    await save()
    layout.design.open(dir(), path)
    // Remembered under the current project too, so the Design tab reopens on it next time.
    if (state.home) layout.design.open(sdk.directory, keyOf(path))
    if (kind(path) === "design") {
      setState({
        active: path,
        status: "idle",
        conflict: false,
        file: undefined,
        loading: false,
        undo: undefined,
        snap: undefined,
        changed: [],
        screen: "",
        screens: -1,
      })
      void chat(path)
      return
    }
    if (kind(path) !== "markdown") {
      setState({ active: path, status: "idle", conflict: false, file: undefined, loading: true, undo: undefined })
      void chat(path)
      await preview(path)
      return
    }
    const content = await read(path)
    setState({ active: path, status: "idle", conflict: false, file: undefined, undo: undefined })
    void chat(path)
    show(content ?? "")
    editor?.focus()
  }

  // Leaving the tab saves what was typed, as closing it used to.
  const shown = useViewShown()
  createEffect(
    on(
      shown,
      (now) => {
        if (!now) void save()
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => design.pending,
      (path) => {
        if (!path) return
        setDesign("pending", "")
        setState("from", "agent")
        // A design clicked in a session may be a full path, in this project or a related one: open it in its repo.
        const value = path.replace(/\\/g, "/")
        const where =
          homes().find((item) => value.startsWith(item.replace(/\\/g, "/").replace(/\/+$/, "") + "/")) ?? dir()
        const key = page(value, where)
        if (!key) return
        void (where === dir() ? Promise.resolve() : go(where)).then(() => open(key))
      },
    ),
  )

  // Back to the gallery; the doc's typing is saved and it is no longer attached to the chat.
  // The path across the top, always shown: Design (every repo), then the repo, then folders inside its design
  // folder, then the open design. Each stop but the last opens the gallery there.
  const trail = createMemo(() => {
    const home = state.active ? dir() : state.tab
    const folder = state.active ? state.active.split("/").slice(0, -1).join("/") : state.folder
    const parts = folder ? folder.split("/") : []
    const stops = [
      { name: language.t("design.root"), home: "", folder: "" },
      ...(home && homes().length > 1 ? [{ name: named(home), home, folder: "" }] : []),
      // The repo's design folder is the root; only the older wiki folder is named.
      ...parts.flatMap((name, i) =>
        i === 0 && name !== LEGACY ? [] : [{ name, home, folder: parts.slice(0, i + 1).join("/") }],
      ),
    ]
    return { stops, leaf: state.active ? title(state.active).split("/").pop() : "" }
  })
  // Show the gallery at one repo and folder.
  const browse = async (home: string, folder: string) => {
    if (state.active) await close()
    setState({ tab: homes().length > 1 ? home : "", folder })
  }
  // Back goes where the design was opened from: the session it was clicked in, or the gallery.
  const back = async () => {
    const from = state.from
    await close()
    if (from === "agent") layout.nav.set("agent")
  }

  const close = async () => {
    await flush()
    setState({
      active: "",
      from: "",
      file: undefined,
      undo: undefined,
      conflict: false,
      status: "idle",
      snap: undefined,
      changed: [],
      screen: "",
      screens: -1,
    })
    prompt.context
      .items()
      .filter((item) => item.type === "file" && !item.selection && page(item.path, dir()))
      .forEach((item) => prompt.context.remove(item.key))
  }

  const create = async (type: Type) => {
    const name = untitled(type)
    const path = `${ROOT}/${name}.${type.ext}`
    // A UI design is a folder; writing its layout creates it.
    await client().file.write({ path: type.id === "ui" ? `${path}/${LAYOUT}` : path, content: type.content(name) })
    fresh = type.ext === "md"
    await list()
    await open(path)
    if (type.id !== "image" && type.id !== "ui") return
    // A new image or UI design is made by describing it: show the chat and put the cursor in its request box.
    if (!layout.code.chat()) layout.code.toggle()
    window.setTimeout(() => document.querySelector<HTMLElement>('[data-component="prompt-input"]')?.focus(), 300)
  }

  const fail = (err: unknown) =>
    showToast({
      title: language.t("common.requestFailed"),
      description: err instanceof Error ? err.message : String(err),
    })

  const rename = async (path: string, name: string) => {
    const base = slug(name)
    if (!base) return
    const parent = path.slice(0, path.lastIndexOf("/"))
    const ext = path.slice(path.lastIndexOf("."))
    const to = `${parent}/${base}${ext}`
    if (to === path) return
    const res = await client()
      .file.move({ from: path, to })
      .catch((err: unknown) => ({ error: err }))
    if ("error" in res && res.error) return fail(res.error)
    layout.design.moved(dir(), path, to)
    await list()
  }

  const remove = (path: string) =>
    dialog.show(() => (
      <Dialog title={language.t("design.delete.title")} fit>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <span class="text-14-regular text-text-strong">
            {language.t("design.delete.confirm", { name: title(path) })}
          </span>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="large"
              data-action="design-delete-confirm"
              onClick={async () => {
                dialog.close()
                const res = await client()
                  .file.remove({ path })
                  .catch((err: unknown) => ({ error: err }))
                if ("error" in res && res.error) return fail(res.error)
                layout.design.moved(dir(), path)
                await list()
              }}
            >
              {language.t("common.delete")}
            </Button>
          </div>
        </div>
      </Dialog>
    ))

  const theme = () => {
    const value = dark()
    editor?.setTheme(value ? "dark" : "classic", value ? "dark" : "light", value ? "native" : "github")
  }

  onMount(() => {
    setDesign("flush", () => flush)
    // Coming back to the Design tab shows the design viewed last.
    void list().then(() => {
      const last = layout.design.last(sdk.directory)
      if (state.active || design.pending || !last || !state.pages.includes(last)) return
      void open(at(last))
    })
    void import("vditor").then((mod) => {
      if (gone || !host) return
      const value = dark()
      editor = new mod.default(host, {
        cdn: CDN,
        mode: "wysiwyg",
        lang: LANGS[language.locale()] ?? "en_US",
        height: "100%",
        placeholder: language.t("design.placeholder"),
        toolbar: TOOLBAR,
        toolbarConfig: { pin: true },
        cache: { enable: false },
        theme: value ? "dark" : "classic",
        preview: {
          actions: [],
          theme: { current: value ? "dark" : "light" },
          hljs: { style: value ? "native" : "github" },
        },
        link: {
          isOpen: false,
          click: (el) => {
            const href = el.getAttribute("href")
            if (href) platform.openLink(href)
          },
        },
        after: () => {
          ready = true
          editor?.setValue(last, true)
          pick()
        },
        input: schedule,
        blur: () => void save(),
        keydown: (event) => {
          if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return
          event.preventDefault()
          if (timer !== undefined) window.clearTimeout(timer)
          void save()
        },
      })
    })

    const watch = new MutationObserver(theme)
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-color-scheme"] })

    const stop = sdk.event.listen((event) => {
      const detail = event.details as { type: string; properties?: { file?: unknown } }
      if (detail.type !== "file.edited" && detail.type !== "file.watcher.updated") return
      const file = typeof detail.properties?.file === "string" ? page(detail.properties.file, dir()) : undefined
      if (!file) return
      if (!state.pages.includes(file)) void list()
      if (file !== state.active) return
      if (event.details.type === "file.edited" && event.details.properties.sessionID) ai = true
      void check()
    })
    const poll = window.setInterval(() => {
      if (document.visibilityState !== "visible" || !shown()) return
      void list()
      if (editable()) void check()
    }, POLL)
    onCleanup(() => {
      watch.disconnect()
      stop()
      window.clearInterval(poll)
    })
  })

  onCleanup(() => {
    setDesign({ open: false, doc: "", title: "", flush: undefined })
    if (timer !== undefined) window.clearTimeout(timer)
    void save().then(() => editor?.destroy())
    gone = true
    // The open page is only attached while the Design tab is on screen.
    prompt.context
      .items()
      .filter((item) => item.type === "file" && !item.selection && page(item.path, dir()))
      .forEach((item) => prompt.context.remove(item.key))
  })

  const status = createMemo(() => {
    if (busy()) return language.t("design.status.ai")
    if (kind(state.active) === "design") return state.status === "saved" ? language.t("design.status.saved") : ""
    if (!editable()) return language.t("design.readonly")
    if (state.status === "saving") return language.t("design.status.saving")
    if (state.status === "saved") return language.t("design.status.saved")
    if (state.status === "error") return language.t("design.status.error")
    if (state.status === "updated") return language.t("design.status.updated")
    return ""
  })

  return (
    <div
      data-component="design-view"
      class="absolute inset-y-0 left-0 z-40 flex bg-background-base"
      style={{ right: state.active && layout.code.chat() ? `${layout.code.width()}px` : "0px" }}
    >
      <Show when={!state.active}>
        <div class="flex-1 min-w-0 h-full flex flex-col">
          <div class="shrink-0 h-12 px-4 flex items-center border-b border-border-weaker-base">
            <nav data-component="design-path" class="min-w-0 flex items-center gap-1 text-13-regular text-text-weak">
              <For each={trail().stops}>
                {(item, i) => (
                  <>
                    <Show when={i() > 0}>
                      <span>/</span>
                    </Show>
                    <Show
                      when={i() < trail().stops.length - 1 || trail().leaf}
                      fallback={<span class="text-14-medium text-text-strong truncate">{item.name}</span>}
                    >
                      <button
                        type="button"
                        data-action="design-path"
                        class="hover:text-text-strong"
                        onClick={() => void browse(item.home, item.folder)}
                      >
                        {item.name}
                      </button>
                    </Show>
                  </>
                )}
              </For>
              <Show when={trail().leaf}>
                <span>/</span>
                <span class="text-14-medium text-text-strong truncate">{trail().leaf}</span>
              </Show>
            </nav>
          </div>
          <Show when={!state.tab && !state.folder && homes().length > 1}>
            <div data-component="design-homes" class="shrink-0 px-4 pt-3 flex items-center gap-1 flex-wrap">
              <For each={homes()}>
                {(item) => (
                  <Button
                    size="small"
                    variant="ghost"
                    data-action="design-home"
                    onClick={() => setState({ tab: item, folder: "" })}
                  >
                    {language.t("design.homes.repo", { name: named(item), count: count(item) })}
                  </Button>
                )}
              </For>
            </div>
          </Show>
          <Gallery
            pages={visible()}
            listed={state.listed}
            kind={(key) => kind(split(key).rel)}
            title={(key) => title(split(key).rel)}
            load={(key) => {
              const item = split(key)
              return reach(item.home)
                .file.read({ path: item.rel })
                .then((res) => res.data)
                .catch(() => undefined)
            }}
            screens={(key) => {
              const item = split(key)
              return files(item.rel, item.rel, reach(item.home))
            }}
            onOpen={(key) => void open(at(key))}
            onCreate={(type) => {
              setState("home", state.tab && state.tab !== sdk.directory ? state.tab : "")
              void create(type)
            }}
            onRename={(key, name) => void rename(at(key), name)}
            onDelete={(key) => remove(at(key))}
          />
        </div>
      </Show>

      <section class="flex-1 min-w-0 h-full flex flex-col" classList={{ hidden: !state.active }}>
        <Show when={state.active}>
          <div class="shrink-0 h-12 pl-2 pr-4 flex items-center gap-2 border-b border-border-weaker-base">
            <Tooltip
              placement="bottom"
              value={language.t(state.from === "agent" ? "design.back.session" : "design.back")}
            >
              <IconButton
                icon="chevron-left"
                variant="ghost"
                data-action="design-back"
                aria-label={language.t(state.from === "agent" ? "design.back.session" : "design.back")}
                onClick={() => void back()}
              />
            </Tooltip>
            <nav data-component="design-path" class="min-w-0 flex items-center gap-1 text-13-regular text-text-weak">
              <For each={trail().stops}>
                {(item, i) => (
                  <>
                    <Show when={i() > 0}>
                      <span>/</span>
                    </Show>
                    <Show
                      when={i() < trail().stops.length - 1 || trail().leaf}
                      fallback={<span class="text-14-medium text-text-strong truncate">{item.name}</span>}
                    >
                      <button
                        type="button"
                        data-action="design-path"
                        class="hover:text-text-strong"
                        onClick={() => void browse(item.home, item.folder)}
                      >
                        {item.name}
                      </button>
                    </Show>
                  </>
                )}
              </For>
              <Show when={trail().leaf}>
                <span>/</span>
                <span class="text-14-medium text-text-strong truncate">{trail().leaf}</span>
              </Show>
            </nav>
            <div class="flex-1" />
            <span
              class="text-12-regular"
              classList={{
                "text-text-weak": state.status !== "error",
                "text-text-diff-delete-base": state.status === "error",
              }}
            >
              {status()}
            </span>
            <Show when={(state.undo !== undefined || state.changed.length > 0) && !busy()}>
              <Button size="small" variant="secondary" data-action="design-undo-ai" onClick={() => void revert()}>
                {language.t("design.undo")}
              </Button>
            </Show>
            <Show when={!editable() && platform.openPath}>
              <Tooltip placement="bottom" value={language.t("design.open")}>
                <IconButton
                  icon="square-arrow-top-right"
                  variant="ghost"
                  data-action="design-open"
                  aria-label={language.t("design.open")}
                  onClick={() => void platform.openPath?.(`${dir()}/${state.active}`)}
                />
              </Tooltip>
            </Show>
            <Tooltip placement="bottom" value={language.t(layout.code.chat() ? "code.chat.hide" : "code.chat.show")}>
              <IconButton
                icon={layout.code.chat() ? "layout-right-full" : "layout-right"}
                variant="ghost"
                data-action="design-chat-toggle"
                onClick={() => layout.code.toggle()}
                aria-label={language.t(layout.code.chat() ? "code.chat.hide" : "code.chat.show")}
              />
            </Tooltip>
          </div>
          <Show when={state.conflict}>
            <div
              data-component="design-conflict"
              class="shrink-0 px-4 py-2 flex items-center gap-3 bg-surface-warning-weak border-b border-border-weaker-base"
            >
              <Icon name="warning" size="small" class="shrink-0 text-text-on-warning-base" />
              <span class="flex-1 min-w-0 text-12-regular text-text-on-warning-base">
                {language.t("design.conflict")}
              </span>
              <Button
                size="small"
                variant="secondary"
                data-action="design-conflict-reload"
                onClick={() => void reload()}
              >
                {language.t("design.conflict.reload")}
              </Button>
              <Button size="small" variant="ghost" data-action="design-conflict-keep" onClick={keep}>
                {language.t("design.conflict.keep")}
              </Button>
            </div>
          </Show>
          <Show when={kind(state.active) === "design"}>
            <DesignCanvas
              client={client()}
              dir={dir()}
              path={state.active}
              busy={busy()}
              stamp={state.stamp}
              load={load}
              files={(path) => files(path)}
              onSelect={(name) => setState("screen", name)}
              onCount={(count) => setState("screens", count)}
              onEdit={() => setState({ snap: undefined, changed: [] })}
            />
          </Show>
          <Show when={!editable() && kind(state.active) !== "design"}>
            <div class="flex-1 min-h-0 overflow-y-auto">
              <Show when={state.file} fallback={<Show when={!state.loading}>{<Empty />}</Show>}>
                {(item) => <Preview path={state.active} file={item()} />}
              </Show>
            </div>
          </Show>
        </Show>
        <div class="flex-1 min-h-0" classList={{ hidden: !state.active || !editable() }}>
          <div ref={host} data-component="design-editor" />
        </div>
      </section>
    </div>
  )
}

function Empty() {
  const language = useLanguage()
  return (
    <div class="h-full flex items-center justify-center px-6 text-14-regular text-text-weak">
      {language.t("design.preview.none")}
    </div>
  )
}

// Read-only views. Nothing here runs the file's own scripts or reaches the app.
function Preview(props: { path: string; file: FileContent }) {
  const [state, setState] = createStore({ doc: undefined as string | undefined, failed: false })
  const encoded = () => props.file.encoding === "base64" && props.file.content.length > 0
  const image = createMemo(() => {
    if (kind(props.path) !== "image") return
    if (encoded()) return `data:${props.file.mimeType ?? "image/png"};base64,${props.file.content}`
    if (props.file.content) return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(props.file.content)}`
  })
  const pdf = createMemo(() => {
    if (kind(props.path) !== "pdf" || !encoded()) return
    const url = URL.createObjectURL(new Blob([bytes(props.file)], { type: "application/pdf" }))
    onCleanup(() => URL.revokeObjectURL(url))
    return url
  })
  createEffect(
    on(
      () => props.file,
      (file) => {
        if (kind(props.path) !== "docx" || !encoded()) return
        void import("mammoth/mammoth.browser.js")
          .then((mod) => mod.default.convertToHtml({ arrayBuffer: bytes(file).buffer }))
          .then((res) => setState({ doc: DOMPurify.sanitize(res.value), failed: false }))
          .catch(() => setState({ doc: undefined, failed: true }))
      },
    ),
  )

  return (
    <Switch fallback={<Empty />}>
      <Match when={image()}>
        {(src) => (
          <div class="min-h-full flex items-center justify-center p-8">
            <img src={src()} alt={title(props.path)} class="max-w-full h-auto" />
          </div>
        )}
      </Match>
      <Match when={pdf()}>
        {(src) => <iframe src={src()} title={title(props.path)} class="block w-full h-full border-0" />}
      </Match>
      <Match when={kind(props.path) === "html" && props.file.content}>
        {(text) => (
          <iframe
            sandbox=""
            srcdoc={text()}
            title={title(props.path)}
            class="block w-full h-full border-0"
            style={{ background: "#fff" }}
          />
        )}
      </Match>
      <Match when={kind(props.path) === "docx" && encoded()}>
        <div class="max-w-3xl mx-auto px-10 py-8">
          <Show when={state.doc} fallback={<Show when={state.failed}>{<Empty />}</Show>}>
            {(value) => <div data-component="design-doc" innerHTML={value()} />}
          </Show>
        </div>
      </Match>
    </Switch>
  )
}
