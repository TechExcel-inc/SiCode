import { createMemo, createResource, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import DOMPurify from "dompurify"
import type { FileContent } from "@opencode-ai/sdk/v2"
import { Button } from "@opencode-ai/ui/button"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { html, markdown } from "./design-markdown"
import "./design.css"

const ROOT = "design"
// Pages written before the tab was renamed stay where they are and keep opening.
const LEGACY = "wiki"
const DELAY = 800
const POLL = 4000

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
  const [state, setState] = createStore({
    active: "",
    query: "",
    draft: undefined as string | undefined,
    status: "idle" as "idle" | "saving" | "saved" | "error" | "updated",
    conflict: false,
    tick: 0,
    version: 0,
  })
  let editor: HTMLDivElement | undefined
  let timer: number | undefined
  let dirty = false
  let count = 0
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

  const [pages, { refetch }] = createResource(
    () => state.tick,
    () => Promise.all([walk(ROOT), walk(LEGACY)]).then((all) => all.flat()),
    { initialValue: [] },
  )
  const shown = createMemo(() => {
    const query = state.query.trim().toLowerCase()
    if (!query) return pages()
    return pages().filter((path) => title(path).toLowerCase().includes(query))
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

  const [file] = createResource(
    () => (state.active && !editable() ? { path: state.active, version: state.version } : undefined),
    (input) => load(input.path),
  )

  // Mermaid blocks get a drawn diagram just above their source; the source only shows while editing it.
  const draw = async () => {
    const blocks = Array.from(editor?.querySelectorAll<HTMLElement>("pre > code.language-mermaid") ?? [])
    if (blocks.length === 0) return
    const mermaid = (await import("mermaid")).default
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: document.documentElement.dataset.colorScheme === "dark" ? "dark" : "default",
    })
    for (const code of blocks) {
      const pre = code.parentElement
      if (!pre?.isConnected) continue
      const source = code.textContent ?? ""
      const prev = pre.previousElementSibling
      const figure = prev instanceof HTMLElement && prev.hasAttribute("data-diagram") ? prev : document.createElement("div")
      if (figure.dataset.source === source) continue
      figure.setAttribute("data-diagram", "")
      figure.contentEditable = "false"
      figure.dataset.source = source
      if (!figure.isConnected) pre.before(figure)
      await mermaid
        .render(`design-diagram-${++count}`, source)
        .then((res) => {
          figure.innerHTML = res.svg
          figure.removeAttribute("data-error")
        })
        .catch((err: unknown) => {
          figure.textContent = err instanceof Error ? err.message : String(err)
          figure.setAttribute("data-error", "")
          figure.setAttribute("data-open", "")
        })
    }
  }

  const show = (content: string) => {
    last = content
    dirty = false
    if (!editor) return
    editor.innerHTML = html(content)
    editor.querySelectorAll("input[type=checkbox]").forEach((box) => box.removeAttribute("disabled"))
    void draw()
  }

  // force: the user chose to keep their version over an outside edit.
  const save = async (force?: boolean) => {
    if (!dirty || !editor || !editable() || (state.conflict && !force)) return
    const path = state.active
    const disk = await read(path)
    if (!force && disk !== undefined && !same(disk, last)) {
      setState("conflict", true)
      return
    }
    dirty = false
    const content = markdown(editor.innerHTML)
    setState("status", "saving")
    await sdk.client.file
      .write({ path, content })
      .then(() => {
        if (state.active === path) last = content
        setState({ status: state.active === path && !dirty ? "saved" : state.status, conflict: false })
        void draw()
      })
      .catch(() => {
        dirty = true
        setState("status", "error")
      })
  }

  // Picks up edits made by the agent or another window.
  const check = async () => {
    const path = state.active
    if (!path || state.status === "saving") return
    if (!editable()) {
      setState("version", (n) => n + 1)
      return
    }
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
    if (kind(path) !== "markdown") {
      setState({ active: path, status: "idle", conflict: false })
      attach(path)
      return
    }
    const content = await read(path)
    setState({ active: path, status: "idle", conflict: false })
    show(content ?? "")
    attach(path)
    editor?.focus()
  }

  const create = async () => {
    const name = slug(state.draft ?? "")
    if (!name) return
    const path = `${ROOT}/${name}.md`
    setState("draft", undefined)
    if (!pages().includes(path)) {
      await sdk.client.file.write({ path, content: `# ${name.split("/").pop()}\n\n` })
      setState("tick", (n) => n + 1)
      await refetch()
    }
    await open(path)
  }

  onMount(() => {
    const stop = sdk.event.listen((event) => {
      const detail = event.details as { type: string; properties?: { file?: unknown } }
      if (detail.type !== "file.edited" && detail.type !== "file.watcher.updated") return
      const file = typeof detail.properties?.file === "string" ? page(detail.properties.file, sdk.directory) : undefined
      if (!file) return
      if (!pages().includes(file)) setState("tick", (n) => n + 1)
      if (file === state.active) void check()
    })
    const poll = window.setInterval(() => {
      if (document.visibilityState !== "visible") return
      setState("tick", (n) => n + 1)
      if (editable()) void check()
    }, POLL)
    onCleanup(() => {
      stop()
      window.clearInterval(poll)
    })
  })

  onCleanup(() => {
    if (timer !== undefined) window.clearTimeout(timer)
    void save()
    // The open page is only attached while the Design tab is on screen.
    prompt.context
      .items()
      .filter((item) => item.type === "file" && !item.selection && page(item.path, sdk.directory))
      .forEach((item) => prompt.context.remove(item.key))
  })

  const run = (cmd: string, value?: string) => {
    editor?.focus()
    document.execCommand(cmd, false, value)
    schedule()
  }

  const tools: { icon?: IconProps["name"]; text?: string; label: Parameters<typeof language.t>[0]; act: () => void }[] = [
    { text: "H1", label: "design.tool.h1", act: () => run("formatBlock", "h1") },
    { text: "H2", label: "design.tool.h2", act: () => run("formatBlock", "h2") },
    { text: "H3", label: "design.tool.h3", act: () => run("formatBlock", "h3") },
    { text: "B", label: "design.tool.bold", act: () => run("bold") },
    { text: "I", label: "design.tool.italic", act: () => run("italic") },
    { text: "S", label: "design.tool.strike", act: () => run("strikeThrough") },
    { icon: "bullet-list", label: "design.tool.bullets", act: () => run("insertUnorderedList") },
    { text: "1.", label: "design.tool.numbers", act: () => run("insertOrderedList") },
    { text: "❝", label: "design.tool.quote", act: () => run("formatBlock", "blockquote") },
    { icon: "code", label: "design.tool.code", act: () => run("formatBlock", "pre") },
    { text: "¶", label: "design.tool.text", act: () => run("formatBlock", "p") },
  ]

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
          <Tooltip placement="bottom" value={language.t("design.new")}>
            <IconButton
              icon="plus-small"
              variant="ghost"
              data-action="design-new"
              aria-label={language.t("design.new")}
              onClick={() => setState("draft", "")}
            />
          </Tooltip>
        </div>
        <div class="shrink-0 px-3 pb-2 flex flex-col gap-2">
          <Show when={state.draft !== undefined}>
            <input
              type="text"
              data-action="design-new-name"
              ref={(el) => requestAnimationFrame(() => el.focus())}
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
          <Show when={!pages.loading && shown().length === 0}>
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
            <div class="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <div class="size-12 rounded-xl bg-surface-base flex items-center justify-center text-text-weak">
                <Icon name="design" size="large" />
              </div>
              <div class="text-16-medium text-text-strong">{language.t("design.start.title")}</div>
              <div class="text-14-regular text-text-weak max-w-md">{language.t("design.start.body")}</div>
              <Button variant="primary" size="large" icon="plus-small" onClick={() => setState("draft", "")}>
                {language.t("design.new")}
              </Button>
            </div>
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
            <Tooltip
              placement="bottom"
              value={language.t(layout.code.chat() ? "code.chat.hide" : "code.chat.show")}
            >
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
              <Button size="small" variant="secondary" data-action="design-conflict-reload" onClick={() => void reload()}>
                {language.t("design.conflict.reload")}
              </Button>
              <Button size="small" variant="ghost" data-action="design-conflict-keep" onClick={keep}>
                {language.t("design.conflict.keep")}
              </Button>
            </div>
          </Show>
          <Show when={editable()}>
            <div class="shrink-0 px-4 py-1.5 flex items-center gap-0.5 border-b border-border-weaker-base">
              <For each={tools}>
                {(tool) => (
                  <Tooltip placement="bottom" value={language.t(tool.label)}>
                    <button
                      type="button"
                      data-action="design-tool"
                      aria-label={language.t(tool.label)}
                      class="h-7 min-w-7 px-1.5 rounded-md flex items-center justify-center text-12-medium text-text-base hover:bg-surface-base-hover"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={tool.act}
                    >
                      <Show when={tool.icon} fallback={tool.text}>
                        {(name) => <Icon name={name()} size="small" />}
                      </Show>
                    </button>
                  </Tooltip>
                )}
              </For>
            </div>
          </Show>
          <Show when={!editable()}>
            <div class="flex-1 min-h-0 overflow-y-auto">
              <Show when={file()} fallback={<Show when={!file.loading}>{<Empty />}</Show>}>
                {(item) => <Preview path={state.active} file={item()} />}
              </Show>
            </div>
          </Show>
        </Show>
        <div class="flex-1 min-h-0 overflow-y-auto" classList={{ hidden: !state.active || !editable() }}>
          <div class="max-w-3xl mx-auto px-10 py-8 h-full">
            <div
              ref={editor}
              data-component="design-editor"
              data-placeholder={language.t("design.placeholder")}
              contentEditable
              spellcheck
              onInput={schedule}
              onBlur={() => void save()}
              onClick={(event) => {
                const target = event.target
                if (target instanceof HTMLInputElement && target.type === "checkbox") {
                  target.toggleAttribute("checked", target.checked)
                  schedule()
                  return
                }
                const figure = target instanceof Element ? target.closest("[data-diagram]") : null
                if (figure) figure.toggleAttribute("data-open")
              }}
              onKeyDown={(event) => {
                if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return
                event.preventDefault()
                if (timer !== undefined) window.clearTimeout(timer)
                void save()
              }}
            />
          </div>
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
  const [doc] = createResource(
    () => (kind(props.path) === "docx" && encoded() ? props.file : undefined),
    async (file) => {
      const mammoth = (await import("mammoth/mammoth.browser.js")).default
      const res = await mammoth.convertToHtml({ arrayBuffer: bytes(file).buffer })
      return DOMPurify.sanitize(res.value)
    },
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
            class="block w-full h-full border-0 bg-white"
          />
        )}
      </Match>
      <Match when={kind(props.path) === "docx" && encoded()}>
        <div class="max-w-3xl mx-auto px-10 py-8">
          <Show when={doc()} fallback={<Show when={doc.error}>{<Empty />}</Show>}>
            {(value) => <div data-component="design-doc" innerHTML={value()} />}
          </Show>
        </div>
      </Match>
    </Switch>
  )
}
