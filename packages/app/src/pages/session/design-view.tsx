import { createEffect, createMemo, For, Match, on, onCleanup, onMount, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import DOMPurify from "dompurify"
import type Vditor from "vditor"
import type { FileContent } from "@opencode-ai/sdk/v2"
import { Button } from "@opencode-ai/ui/button"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useLanguage, type Locale } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSessionKey } from "./session-layout"
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

type Kind = (typeof KINDS)[keyof typeof KINDS]

const kind = (path: string): Kind | undefined => KINDS[path.split(".").pop()?.toLowerCase() as keyof typeof KINDS]

const root = (path: string) => (path.startsWith(LEGACY + "/") ? LEGACY : ROOT)

const title = (path: string) => path.slice(root(path).length + 1).replace(/\.(md|markdown)$/i, "")

const slug = (name: string) =>
  name
    .trim()
    .replace(/[\\:*?"<>|]+/g, "")
    .replace(/\s+/g, " ")
    .replace(/^\/+|\/+$/g, "")

const page = (file: string, dir: string) => {
  const value = file.replace(/\\/g, "/")
  const rel = value.startsWith(dir + "/") ? value.slice(dir.length + 1) : value
  if (!rel.startsWith(ROOT + "/") && !rel.startsWith(LEGACY + "/")) return
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
      if (event.details.type !== "file.edited") return
      const id = event.details.properties.sessionID
      const file = page(event.details.properties.file, sdk.directory)
      if (!id || !file || kind(file) !== "markdown") return
      void top(id).then((session) => layout.design.link(sdk.directory, file, session))
    })
    onCleanup(stop)
  })
}

export function DesignView() {
  const layout = useLayout()
  return (
    <Show when={layout.nav.current() === "design"}>
      <Design />
    </Show>
  )
}

function Design() {
  const sdk = useSDK()
  const layout = useLayout()
  const platform = usePlatform()
  const prompt = usePrompt()
  const language = useLanguage()
  const navigate = useNavigate()
  const { params } = useSessionKey()
  const [state, setState] = createStore({
    pages: [] as string[],
    listed: false,
    active: "",
    query: "",
    draft: undefined as string | undefined,
    status: "idle" as "idle" | "saving" | "saved" | "error" | "updated",
    conflict: false,
    file: undefined as FileContent | undefined,
    loading: false,
  })
  let host: HTMLDivElement | undefined
  let editor: Vditor | undefined
  let ready = false
  let gone = false
  let timer: number | undefined
  let dirty = false
  // A doc just created opens with its title selected.
  let fresh = false
  // Markdown last loaded from or written to disk for the open page; anything else on disk is an outside edit.
  let last = ""

  const walk = async (dir: string): Promise<string[]> => {
    const nodes = await sdk.client.file
      .list({ path: dir })
      .then((res) => res.data ?? [])
      .catch(() => [])
    const nested = await Promise.all(
      nodes.filter((node) => node.type === "directory" && !node.ignored).map((node) => walk(node.path)),
    )
    return [
      ...nodes.filter((node) => node.type === "file" && kind(node.name)).map((node) => node.path),
      ...nested.flat(),
    ].sort((a, b) => a.localeCompare(b))
  }

  // Polled; the list only changes (and re-renders) when the files on disk do.
  const list = async () => {
    const next = await Promise.all([walk(ROOT), walk(LEGACY)]).then((all) => all.flat())
    if (gone) return
    if (next.join("\n") !== state.pages.join("\n")) setState("pages", next)
    if (!state.listed) setState("listed", true)
    restore()
  }

  // With nothing open, show the doc open last in this project, else the first one.
  const restore = () => {
    if (state.active || state.pages.length === 0) return
    const prev = layout.design.last(sdk.directory)
    void open(
      prev && state.pages.includes(prev)
        ? prev
        : (state.pages.find((path) => kind(path) === "markdown") ?? state.pages[0]),
    )
  }

  const untitled = () => {
    const base = language.t("design.untitled")
    const names = [base, ...Array.from({ length: 98 }, (_, i) => `${base} ${i + 2}`)]
    return names.find((name) => !state.pages.includes(`${ROOT}/${name}.md`)) ?? base
  }

  const pick = () => {
    if (!fresh || !ready) return
    fresh = false
    requestAnimationFrame(() => {
      const heading = host?.querySelector(".vditor-wysiwyg h1")
      if (!heading) return
      editor?.focus()
      const range = document.createRange()
      range.selectNodeContents(heading)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
    })
  }

  // The chat beside a doc is the session that wrote it. A doc without one gets a blank chat, and the
  // session is only created when the first message is sent (see the params.id effect below).
  const chat = async (path: string) => {
    const id = layout.design.session(sdk.directory, path)
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
      () => [state.active, params.id] as const,
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
        if (!layout.design.session(sdk.directory, state.active)) layout.design.link(sdk.directory, state.active, id)
      },
      { defer: true },
    ),
  )

  const shown = createMemo(() => {
    const query = state.query.trim().toLowerCase()
    if (!query) return state.pages
    return state.pages.filter((path) => title(path).toLowerCase().includes(query))
  })
  const groups = createMemo(() =>
    [ROOT, LEGACY]
      .map((dir) => ({ dir, items: shown().filter((path) => root(path) === dir) }))
      .filter((group) => group.dir === ROOT || group.items.length > 0),
  )
  const editable = createMemo(() => kind(state.active) === "markdown")

  const load = (path: string) =>
    sdk.client.file
      .read({ path })
      .then((res) => res.data)
      .catch(() => undefined)

  const read = (path: string) => load(path).then((file) => (file ? file.content : undefined))

  // Read-only files: replaced only when their bytes change, so polling never flickers the view.
  const preview = async (path: string) => {
    const file = await load(path)
    if (state.active !== path) return
    if (file?.content !== state.file?.content || file?.encoding !== state.file?.encoding) setState("file", file)
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
    await sdk.client.file
      .write({ path, content })
      .then(() => {
        if (state.active === path) last = content
        setState({ status: state.active === path && !dirty ? "saved" : state.status, conflict: false })
      })
      .catch(() => {
        dirty = true
        setState("status", "error")
      })
  }

  // Picks up edits made by the agent or another window, but never replaces what the user is typing.
  const check = async () => {
    const path = state.active
    if (!path || state.status === "saving") return
    if (!editable()) return preview(path)
    const disk = await read(path)
    if (disk === undefined || same(disk, last) || state.active !== path) return
    if (dirty) {
      setState("conflict", true)
      return
    }
    show(disk)
    setState("status", "updated")
  }

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
    prompt.context
      .items()
      .filter((item) => item.type === "file" && !item.selection && page(item.path, sdk.directory) && item.path !== path)
      .forEach((item) => prompt.context.remove(item.key))
    // Word files mean nothing to the agent as raw bytes.
    if (kind(path) !== "docx") prompt.context.add({ type: "file", path })
  }

  const schedule = () => {
    dirty = true
    setState("status", "idle")
    if (timer !== undefined) window.clearTimeout(timer)
    timer = window.setTimeout(() => void save(), DELAY)
  }

  const open = async (path: string) => {
    if (timer !== undefined) window.clearTimeout(timer)
    await save()
    layout.design.open(sdk.directory, path)
    if (kind(path) !== "markdown") {
      setState({ active: path, status: "idle", conflict: false, file: undefined, loading: true })
      void chat(path)
      await preview(path)
      return
    }
    const content = await read(path)
    setState({ active: path, status: "idle", conflict: false, file: undefined })
    void chat(path)
    show(content ?? "")
    editor?.focus()
  }

  const create = async () => {
    const name = slug(state.draft ?? "")
    if (!name) return
    const path = `${ROOT}/${name}.md`
    setState("draft", undefined)
    if (!state.pages.includes(path)) {
      await sdk.client.file.write({ path, content: `# ${name.split("/").pop()}\n\n` })
      fresh = true
      await list()
    }
    await open(path)
  }

  const theme = () => {
    const value = dark()
    editor?.setTheme(value ? "dark" : "classic", value ? "dark" : "light", value ? "native" : "github")
  }

  onMount(() => {
    void list()
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
      const file = typeof detail.properties?.file === "string" ? page(detail.properties.file, sdk.directory) : undefined
      if (!file) return
      if (!state.pages.includes(file)) void list()
      if (file === state.active) void check()
    })
    const poll = window.setInterval(() => {
      if (document.visibilityState !== "visible") return
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
    if (timer !== undefined) window.clearTimeout(timer)
    void save().then(() => editor?.destroy())
    gone = true
    // The open page is only attached while the Design tab is on screen.
    prompt.context
      .items()
      .filter((item) => item.type === "file" && !item.selection && page(item.path, sdk.directory))
      .forEach((item) => prompt.context.remove(item.key))
  })

  const status = createMemo(() => {
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
      style={{ right: layout.code.chat() ? `${layout.code.width()}px` : "0px" }}
    >
      <aside class="w-64 shrink-0 h-full flex flex-col min-h-0 border-r border-border-weaker-base bg-background-base">
        <div class="shrink-0 h-12 px-3 flex items-center justify-between">
          <div class="flex items-center gap-2 text-14-medium text-text-strong">
            <Icon name="design" size="small" />
            {language.t("rail.design")}
          </div>
        </div>
        <div class="shrink-0 px-3 pb-2 flex flex-col gap-2">
          <div class="flex items-center gap-2 h-8 px-2 rounded-md bg-surface-base border border-border-weak-base focus-within:border-border-interactive-base">
            <Icon name="magnifying-glass" size="small" class="text-icon-weak shrink-0" />
            <input
              type="text"
              data-action="design-search"
              value={state.query}
              onInput={(event) => setState("query", event.currentTarget.value)}
              placeholder={language.t("design.search")}
              class="flex-1 min-w-0 bg-transparent text-12-regular text-text-strong placeholder:text-text-weak outline-none"
            />
          </div>
          <button
            type="button"
            data-action="design-new"
            class="h-8 px-2 rounded-md flex items-center gap-2 text-left text-14-regular text-text-base hover:bg-surface-base-hover"
            onClick={() => setState("draft", untitled())}
          >
            <Icon name="plus-small" size="small" class="shrink-0 text-icon-weak" />
            {language.t("design.new")}
          </button>
          <Show when={state.draft !== undefined}>
            <input
              type="text"
              data-action="design-new-name"
              ref={(el) =>
                requestAnimationFrame(() => {
                  el.focus()
                  el.select()
                })
              }
              value={state.draft ?? ""}
              onInput={(event) => setState("draft", event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void create()
                if (event.key === "Escape") setState("draft", undefined)
              }}
              onBlur={() => {
                if (!state.draft?.trim()) setState("draft", undefined)
              }}
              placeholder={language.t("design.new.placeholder")}
              class="h-8 px-2 rounded-md bg-surface-base border border-border-interactive-base text-12-regular text-text-strong placeholder:text-text-weak outline-none"
            />
          </Show>
        </div>
        <nav class="flex-1 min-h-0 overflow-y-auto no-scrollbar px-2 pb-3 flex flex-col gap-0.5">
          <For each={groups()}>
            {(group) => (
              <>
                <Show when={group.dir === LEGACY}>
                  <div class="px-2 pt-3 pb-1 text-12-regular text-text-weak">{LEGACY}/</div>
                </Show>
                <For each={group.items}>
                  {(path) => (
                    <button
                      type="button"
                      data-action="design-page"
                      class="w-full min-w-0 px-2 py-1.5 rounded-md flex items-center gap-2 text-left text-14-regular"
                      classList={{
                        "bg-surface-base-active text-text-strong": state.active === path,
                        "text-text-base hover:bg-surface-base-hover": state.active !== path,
                      }}
                      onClick={() => void open(path)}
                    >
                      <FileIcon node={{ path, type: "file" }} class="shrink-0 size-4" />
                      <span class="truncate">{title(path)}</span>
                    </button>
                  )}
                </For>
              </>
            )}
          </For>
          <Show when={state.listed && shown().length === 0}>
            <div class="px-2 py-3 text-12-regular text-text-weak">
              {state.query ? language.t("design.none") : language.t("design.empty")}
            </div>
          </Show>
        </nav>
      </aside>

      <section class="flex-1 min-w-0 h-full flex flex-col">
        <Show
          when={state.active}
          fallback={
            <Show when={state.listed && state.pages.length === 0}>
              <div class="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
                <div class="size-12 rounded-xl bg-surface-base flex items-center justify-center text-text-weak">
                  <Icon name="design" size="large" />
                </div>
                <div class="text-16-medium text-text-strong">{language.t("design.start.title")}</div>
                <div class="text-14-regular text-text-weak max-w-md">{language.t("design.start.body")}</div>
                <Button variant="primary" size="large" icon="plus-small" onClick={() => setState("draft", untitled())}>
                  {language.t("design.new")}
                </Button>
              </div>
            </Show>
          }
        >
          <div class="shrink-0 h-12 px-4 flex items-center gap-3 border-b border-border-weaker-base">
            <div class="min-w-0 flex items-center gap-1 text-12-regular text-text-weak">
              <span>{root(state.active)}</span>
              <span>/</span>
              <span class="text-14-medium text-text-strong truncate">{title(state.active)}</span>
            </div>
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
            <Show when={!editable() && platform.openPath}>
              <Tooltip placement="bottom" value={language.t("design.open")}>
                <IconButton
                  icon="square-arrow-top-right"
                  variant="ghost"
                  data-action="design-open"
                  aria-label={language.t("design.open")}
                  onClick={() => void platform.openPath?.(`${sdk.directory}/${state.active}`)}
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
          <Show when={!editable()}>
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
