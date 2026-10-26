import { createEffect, createMemo, For, Match, on, onCleanup, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import type { FileContent } from "@opencode-ai/sdk/v2"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { ago } from "@/pages/layout/helpers"

export type Kind = "markdown" | "image" | "pdf" | "html" | "docx"

// What "Make something new" offers: each creates a file of that type in design/ and opens it.
export const TYPES = [
  {
    id: "doc",
    label: "design.type.doc",
    untitled: "design.untitled",
    ext: "md",
    content: (name: string) => `# ${name}\n\n`,
  },
  {
    // A real image the assistant draws and edits as SVG, not a markdown doc.
    id: "image",
    label: "design.type.image",
    untitled: "design.untitled.image",
    ext: "svg",
    // An empty canvas; the user describes the image in the chat and the assistant draws it.
    content: () =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">\n  <rect width="1200" height="800" fill="#ffffff"/>\n</svg>\n`,
  },
  {
    id: "page",
    label: "design.type.page",
    untitled: "design.untitled.page",
    ext: "html",
    content: (name: string) =>
      `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>${name}</title>\n<style>\n  body { font-family: system-ui, sans-serif; margin: 48px; color: #1f2328; }\n</style>\n</head>\n<body>\n<h1>${name}</h1>\n<p>Describe this page in the chat and the assistant will build it.</p>\n</body>\n</html>\n`,
  },
] as const

export type Type = (typeof TYPES)[number]

// Filter tabs, shown only when the project has files of that kind.
const FILTERS = [
  { id: "markdown", label: "design.filter.markdown", kinds: ["markdown"] },
  { id: "html", label: "design.filter.html", kinds: ["html"] },
  { id: "image", label: "design.filter.image", kinds: ["image"] },
  { id: "file", label: "design.filter.file", kinds: ["pdf", "docx"] },
] as const

const CDN = "/vditor"
// Thumbnails render the doc at this width, then scale it down to the card.
const PAGE = 640

const dark = () => document.documentElement.dataset.colorScheme === "dark"

export function Gallery(props: {
  pages: string[]
  listed: boolean
  kind: (path: string) => Kind | undefined
  title: (path: string) => string
  load: (path: string) => Promise<FileContent | undefined>
  onOpen: (path: string) => void
  onCreate: (type: Type) => void
  onRename: (path: string, name: string) => void
  onDelete: (path: string) => void
}) {
  const sdk = useSDK()
  const layout = useLayout()
  const language = useLanguage()
  const [state, setState] = createStore({
    filter: "all",
    query: undefined as string | undefined,
    renaming: "",
  })

  const time = (path: string) => {
    const entry = layout.design.time(sdk.directory, path)
    return Math.max(entry?.opened ?? 0, entry?.edited ?? 0)
  }
  const filters = createMemo(() =>
    FILTERS.filter((item) =>
      props.pages.some((path) => (item.kinds as readonly string[]).includes(props.kind(path) ?? "")),
    ),
  )
  const shown = createMemo(() => {
    const pins = layout.design.pins(sdk.directory)
    const query = state.query?.trim().toLowerCase() ?? ""
    const filter = FILTERS.find((item) => item.id === state.filter)
    return props.pages
      .filter((path) => !filter || (filter.kinds as readonly string[]).includes(props.kind(path) ?? ""))
      .filter((path) => !query || props.title(path).toLowerCase().includes(query))
      .toSorted(
        (a, b) =>
          Number(pins.includes(b)) - Number(pins.includes(a)) ||
          time(b) - time(a) ||
          props.title(a).localeCompare(props.title(b)),
      )
  })

  const meta = (path: string) => {
    const entry = layout.design.time(sdk.directory, path)
    const edited = entry?.edited ?? 0
    const opened = entry?.opened ?? 0
    if (!edited && !opened) return ""
    const when = ago(Math.max(edited, opened), Date.now(), language.intl())
    return language.t(edited >= opened ? "design.card.edited" : "design.card.opened", { time: when })
  }

  const menu = (path: string) => {
    const pinned = () => layout.design.pins(sdk.directory).includes(path)
    return (
      <DropdownMenu placement="bottom-end">
        <DropdownMenu.Trigger
          as={IconButton}
          icon="dot-grid"
          variant="ghost"
          class="size-7 shrink-0 rounded-md data-[expanded]:bg-surface-base-active"
          data-action="design-card-menu"
          aria-label={language.t("design.card.menu")}
        />
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="mt-1 min-w-36">
            <DropdownMenu.Item data-action="design-pin" onSelect={() => layout.design.pin(sdk.directory, path)}>
              <DropdownMenu.ItemLabel>{language.t(pinned() ? "design.unpin" : "design.pin")}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Item data-action="design-rename" onSelect={() => setState("renaming", path)}>
              <DropdownMenu.ItemLabel>{language.t("common.rename")}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
            <DropdownMenu.Item data-action="design-delete" onSelect={() => props.onDelete(path)}>
              <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    )
  }

  const name = (path: string) => (
    <Show
      when={state.renaming === path}
      fallback={
        <button
          type="button"
          class="block w-full min-w-0 truncate text-left text-14-medium text-text-strong"
          onClick={() => props.onOpen(path)}
        >
          {props.title(path)}
        </button>
      }
    >
      <input
        type="text"
        data-action="design-rename-input"
        value={props.title(path).split("/").pop()}
        ref={(el) =>
          requestAnimationFrame(() => {
            el.focus()
            el.select()
          })
        }
        onKeyDown={(event) => {
          if (event.key === "Escape") setState("renaming", "")
          if (event.key !== "Enter") return
          const value = event.currentTarget.value.trim()
          setState("renaming", "")
          if (value && value !== props.title(path).split("/").pop()) props.onRename(path, value)
        }}
        onBlur={() => setState("renaming", "")}
        class="w-full h-6 px-1 -mx-1 rounded bg-surface-base border border-border-interactive-base text-14-medium text-text-strong outline-none"
      />
    </Show>
  )

  const info = (path: string) => (
    <div class="flex items-center gap-1.5 text-12-regular text-text-weak min-w-0">
      <Show when={layout.design.pins(sdk.directory).includes(path)}>
        <Icon name="pin" size="small" class="shrink-0" />
      </Show>
      <span class="truncate">{meta(path)}</span>
    </div>
  )

  return (
    <div data-component="design-gallery" class="flex-1 min-w-0 h-full overflow-y-auto">
      <div class="max-w-[1120px] mx-auto px-10 py-10 flex flex-col gap-8">
        <h1 data-slot="design-gallery-title" class="text-text-strong">
          {language.t("rail.design")}
        </h1>

        <section class="flex flex-col gap-3">
          <div class="text-14-medium text-text-strong">{language.t("design.make")}</div>
          <div class="grid grid-cols-3 gap-4">
            <For each={TYPES}>
              {(type) => (
                <button
                  type="button"
                  data-action={`design-create-${type.id}`}
                  class="flex flex-col gap-2 text-left group"
                  onClick={() => props.onCreate(type)}
                >
                  <div class="aspect-[2/1] w-full rounded-xl bg-surface-base border border-border-weaker-base flex items-center justify-center group-hover:border-border-weak-base">
                    <Art type={type.id} />
                  </div>
                  <span class="text-14-regular text-text-base">{language.t(type.label)}</span>
                </button>
              )}
            </For>
          </div>
        </section>

        <section class="flex flex-col gap-4">
          <div class="flex items-center gap-1 border-b border-border-weaker-base">
            <For each={[{ id: "all", label: "design.filter.all" } as const, ...filters()]}>
              {(item) => (
                <button
                  type="button"
                  data-action={`design-filter-${item.id}`}
                  class="h-9 px-3 -mb-px text-14-regular border-b-2"
                  classList={{
                    "border-text-strong text-text-strong": state.filter === item.id,
                    "border-transparent text-text-weak hover:text-text-base": state.filter !== item.id,
                  }}
                  onClick={() => setState("filter", item.id)}
                >
                  {language.t(item.label)}
                </button>
              )}
            </For>
            <div class="flex-1" />
            <Show
              when={state.query !== undefined}
              fallback={
                <Tooltip placement="bottom" value={language.t("design.search")}>
                  <IconButton
                    icon="magnifying-glass"
                    variant="ghost"
                    data-action="design-search-open"
                    aria-label={language.t("design.search")}
                    onClick={() => setState("query", "")}
                  />
                </Tooltip>
              }
            >
              <input
                type="text"
                data-action="design-search"
                ref={(el) => requestAnimationFrame(() => el.focus())}
                value={state.query ?? ""}
                onInput={(event) => setState("query", event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setState("query", undefined)
                }}
                onBlur={() => {
                  if (!state.query?.trim()) setState("query", undefined)
                }}
                placeholder={language.t("design.search")}
                class="h-8 w-56 px-2 mb-0.5 rounded-md bg-surface-base border border-border-interactive-base text-13-regular text-text-strong placeholder:text-text-weak outline-none"
              />
            </Show>
            <Tooltip
              placement="bottom"
              value={language.t(layout.design.list() ? "design.view.grid" : "design.view.list")}
            >
              <IconButton
                icon={layout.design.list() ? "grid" : "bullet-list"}
                variant="ghost"
                data-action="design-view-toggle"
                aria-label={language.t(layout.design.list() ? "design.view.grid" : "design.view.list")}
                onClick={() => layout.design.setList(!layout.design.list())}
              />
            </Tooltip>
          </div>

          <Show when={props.listed && shown().length === 0}>
            <div class="py-10 text-center text-14-regular text-text-weak">
              {state.query?.trim() ? language.t("design.none") : language.t("design.empty")}
            </div>
          </Show>

          <Show
            when={layout.design.list()}
            fallback={
              <div class="grid grid-cols-3 gap-x-5 gap-y-7">
                <For each={shown()}>
                  {(path) => (
                    <div data-component="design-card" class="flex flex-col gap-2.5 min-w-0">
                      <button
                        type="button"
                        data-action="design-card-open"
                        class="block w-full aspect-[4/3] rounded-xl overflow-hidden border border-border-weaker-base hover:border-border-weak-base bg-background-base text-left"
                        onClick={() => props.onOpen(path)}
                      >
                        <Thumb
                          path={path}
                          kind={props.kind(path)}
                          stamp={layout.design.time(sdk.directory, path)?.edited}
                          load={props.load}
                        />
                      </button>
                      <div class="flex items-start gap-2 min-w-0">
                        <div class="flex-1 min-w-0 flex flex-col gap-0.5">
                          {name(path)}
                          {info(path)}
                        </div>
                        {menu(path)}
                      </div>
                    </div>
                  )}
                </For>
              </div>
            }
          >
            <div class="flex flex-col">
              <For each={shown()}>
                {(path) => (
                  <div
                    data-component="design-row"
                    class="h-12 px-2 flex items-center gap-3 border-b border-border-weaker-base min-w-0"
                  >
                    <FileIcon node={{ path, type: "file" }} class="shrink-0 size-4" />
                    <div class="flex-1 min-w-0">{name(path)}</div>
                    <div class="w-48 shrink-0">{info(path)}</div>
                    {menu(path)}
                  </div>
                )}
              </For>
            </div>
          </Show>
        </section>
      </div>
    </div>
  )
}

// The first screen of a doc, rendered the way the editor shows it and scaled down to the card.
function Thumb(props: {
  path: string
  kind: Kind | undefined
  stamp: number | undefined
  load: (path: string) => Promise<FileContent | undefined>
}) {
  const [state, setState] = createStore({ file: undefined as FileContent | undefined, scale: 0.35 })
  let box: HTMLDivElement | undefined
  let page: HTMLDivElement | undefined
  let gone = false
  onCleanup(() => (gone = true))

  createResizeObserver(
    () => box,
    ({ width }) => {
      if (width) setState("scale", width / PAGE)
    },
  )

  createEffect(
    on(
      () => [props.path, props.stamp] as const,
      ([path]) => {
        if (props.kind === "pdf" || props.kind === "docx" || !props.kind) return
        void props.load(path).then((file) => {
          if (gone) return
          setState("file", file)
          if (props.kind !== "markdown" || !file || !page) return
          const value = dark()
          void import("vditor").then((mod) => {
            if (gone || !page) return
            void mod.default.preview(page, file.content, {
              cdn: CDN,
              mode: value ? "dark" : "light",
              theme: { current: value ? "dark" : "light" },
              hljs: { style: value ? "native" : "github" },
            })
          })
        })
      },
    ),
  )

  const image = createMemo(() => {
    const file = state.file
    if (props.kind !== "image" || !file?.content) return
    if (file.encoding === "base64") return `data:${file.mimeType ?? "image/png"};base64,${file.content}`
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(file.content)}`
  })

  return (
    <div ref={box} data-component="design-thumb" class="relative w-full h-full overflow-hidden pointer-events-none">
      <Switch
        fallback={
          <div class="w-full h-full flex items-center justify-center bg-surface-base">
            <FileIcon node={{ path: props.path, type: "file" }} class="size-10" />
          </div>
        }
      >
        <Match when={props.kind === "markdown"}>
          <div
            class="absolute top-0 left-0 origin-top-left px-12 py-10"
            style={{ width: `${PAGE}px`, transform: `scale(${state.scale})` }}
          >
            <div ref={page} class="vditor-reset" />
          </div>
        </Match>
        <Match when={props.kind === "html" && state.file?.content}>
          {(text) => (
            <iframe
              sandbox=""
              srcdoc={text()}
              tabIndex={-1}
              aria-hidden="true"
              class="absolute top-0 left-0 origin-top-left border-0"
              style={{
                width: `${PAGE}px`,
                height: `${PAGE * 0.75}px`,
                transform: `scale(${state.scale})`,
                background: "#fff",
              }}
            />
          )}
        </Match>
        <Match when={image()}>
          {(src) => (
            <div class="w-full h-full flex items-center justify-center bg-surface-base p-4">
              <img src={src()} alt="" class="max-w-full max-h-full object-contain" />
            </div>
          )}
        </Match>
      </Switch>
    </div>
  )
}

// Line drawings for "Make something new", in the app's own colors.
function Art(props: { type: Type["id"] }) {
  return (
    <svg viewBox="0 0 120 72" class="h-[62%] text-icon-weak" fill="none" stroke="currentColor" stroke-width="2">
      <Switch>
        <Match when={props.type === "doc"}>
          <rect x="34" y="6" width="52" height="60" rx="4" />
          <path d="M44 20H76M44 30H76M44 40H68M44 50H72" stroke-linecap="round" />
        </Match>
        <Match when={props.type === "image"}>
          <rect x="26" y="8" width="68" height="56" rx="4" />
          <circle cx="44" cy="26" r="6" />
          <path d="M26 56L48 38L62 50L72 42L94 60" stroke-linejoin="round" />
        </Match>
        <Match when={props.type === "page"}>
          <rect x="20" y="8" width="80" height="56" rx="4" />
          <path d="M20 20H100" />
          <circle cx="28" cy="14" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="34" cy="14" r="1.5" fill="currentColor" stroke="none" />
          <rect x="30" y="30" width="28" height="24" rx="2" />
          <path d="M66 32H90M66 40H90M66 48H82" stroke-linecap="round" />
        </Match>
      </Switch>
    </svg>
  )
}
