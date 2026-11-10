// Hand editing of one screen of a UI design. Only this file imports GrapesJS (BSD-3-Clause); it is
// loaded when Edit is pressed, so the editor never grows the first load.
import { createStore } from "solid-js/store"
import { onCleanup, onMount } from "solid-js"
import grapesjs, { type Editor } from "grapesjs"
// Reads CSS as written (shorthands kept), where the browser's own parser would expand every one of them.
import parser from "grapesjs-parser-postcss"
import "grapesjs/dist/css/grapes.min.css"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useLanguage } from "@/context/language"
import { assets, join, split } from "./design-format"

// The same formatter every time, so a hand edit gives a small, stable diff.
async function format(html: string) {
  const [prettier, markup, css, babel, estree] = await Promise.all([
    import("prettier/standalone"),
    import("prettier/plugins/html"),
    import("prettier/plugins/postcss"),
    import("prettier/plugins/babel"),
    import("prettier/plugins/estree"),
  ])
  return prettier
    .format(html, { parser: "html", plugins: [markup, css, babel, estree.default], printWidth: 120 })
    .catch(() => html)
}

export default function DesignEditor(props: {
  html: string
  title: string
  // A fixed-size screen keeps its width in the editor; a fluid page fills it.
  width?: number
  fonts: string
  // assets/... paths and the data URLs that stand in for them while editing.
  files: Record<string, string>
  onDone: (html: string) => Promise<void>
  onCancel: () => void
}) {
  const language = useLanguage()
  const [state, setState] = createStore({ tab: "style" as "style" | "layers", saving: false })
  let host: HTMLDivElement | undefined
  let style: HTMLDivElement | undefined
  let layers: HTMLDivElement | undefined
  let editor: Editor | undefined
  const parts = split(props.html)

  onMount(() => {
    if (!host || !style || !layers) return
    editor = grapesjs.init({
      container: host,
      height: "100%",
      width: "auto",
      fromElement: false,
      storageManager: false,
      plugins: [parser],
      // The page brings its own base styles; the editor adds none to what is saved.
      protectedCss: "",
      canvasCss: props.fonts,
      avoidInlineStyle: true,
      components: assets(parts.body, props.files),
      style: assets(parts.css, props.files),
      panels: { defaults: [] },
      // Adding new elements is the assistant's job; the first version only edits what is there.
      blockManager: { blocks: [] },
      assetManager: { upload: false },
      styleManager: { appendTo: style },
      selectorManager: { componentFirst: true },
      layerManager: { appendTo: layers },
      deviceManager: {
        devices: [{ id: "screen", name: "Screen", width: props.width ? `${props.width}px` : "" }],
      },
      undoManager: { trackSelection: false },
    })
  })

  onCleanup(() => editor?.destroy())

  const done = async () => {
    if (!editor || state.saving) return
    setState("saving", true)
    // The images go back to their assets/ paths; the data URLs were only for showing them.
    const back = (text: string) =>
      Object.entries(props.files).reduce((value, [file, url]) => value.split(url).join(file), text)
    const html = back(editor.getHtml())
    const css = back(editor.getCss({ avoidProtected: true }) ?? "")
    await props.onDone(await format(join(parts, html, css)))
    setState("saving", false)
  }

  return (
    <div data-component="design-editor-gjs" class="flex-1 min-h-0 flex flex-col">
      <div class="shrink-0 h-10 px-2 flex items-center gap-1 border-b border-border-weaker-base">
        <span class="px-2 text-13-medium text-text-strong truncate">{props.title}</span>
        <Tooltip placement="bottom" value={language.t("design.editor.undo")}>
          <IconButton
            icon="reset"
            variant="ghost"
            data-action="design-editor-undo"
            aria-label={language.t("design.editor.undo")}
            onClick={() => editor?.UndoManager.undo()}
          />
        </Tooltip>
        <Tooltip placement="bottom" value={language.t("design.editor.redo")}>
          <IconButton
            icon="reset"
            class="-scale-x-100"
            variant="ghost"
            data-action="design-editor-redo"
            aria-label={language.t("design.editor.redo")}
            onClick={() => editor?.UndoManager.redo()}
          />
        </Tooltip>
        <div class="flex-1" />
        <Button size="small" variant="ghost" data-action="design-editor-cancel" onClick={() => props.onCancel()}>
          {language.t("design.editor.cancel")}
        </Button>
        <Button
          size="small"
          variant="primary"
          data-action="design-editor-done"
          disabled={state.saving}
          onClick={() => void done()}
        >
          {language.t("design.editor.done")}
        </Button>
      </div>
      <div class="flex-1 min-h-0 flex">
        <div ref={host} class="flex-1 min-w-0 h-full" />
        <aside class="w-72 shrink-0 h-full flex flex-col border-l border-border-weaker-base">
          <div class="shrink-0 h-9 px-2 flex items-center gap-1 border-b border-border-weaker-base">
            <Button
              size="small"
              variant={state.tab === "style" ? "secondary" : "ghost"}
              data-action="design-editor-style"
              onClick={() => setState("tab", "style")}
            >
              {language.t("design.editor.style")}
            </Button>
            <Button
              size="small"
              variant={state.tab === "layers" ? "secondary" : "ghost"}
              data-action="design-editor-layers"
              onClick={() => setState("tab", "layers")}
            >
              {language.t("design.editor.layers")}
            </Button>
          </div>
          <div class="flex-1 min-h-0 overflow-y-auto">
            <div ref={style} classList={{ hidden: state.tab !== "style" }} />
            <div ref={layers} classList={{ hidden: state.tab !== "layers" }} />
          </div>
        </aside>
      </div>
    </div>
  )
}
