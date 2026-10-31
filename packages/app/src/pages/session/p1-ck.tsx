import DOMPurify from "dompurify"
import { onCleanup, onMount } from "solid-js"
import { useLanguage } from "@/context/language"

// P1's own CKEditor 5 build (DecoupledEditor with P1's plugins), served from public/ckeditor and loaded once.
type Editor = {
  getData: () => string
  setData: (html: string) => void
  destroy: () => Promise<unknown>
  enableReadOnlyMode: (id: string) => void
  disableReadOnlyMode: (id: string) => void
  model: { document: { on: (name: string, fn: () => void) => void } }
  ui: { view: { toolbar: { element: HTMLElement } } }
}
type Build = { create: (el: HTMLElement, cfg: Record<string, unknown>) => Promise<Editor> }

let ready: Promise<Build> | undefined
function script(src: string) {
  return new Promise<void>((resolve, reject) => {
    const el = document.createElement("script")
    el.src = src
    el.onload = () => resolve()
    el.onerror = () => reject(new Error(`Could not load ${src}`))
    document.head.appendChild(el)
  })
}
function build(locale: string) {
  ready ??= script("/ckeditor/ckeditor.js").then(async () => {
    const lang = locale === "zh" ? "zh-cn" : locale === "zht" ? "zh" : undefined
    if (lang) await script(`/ckeditor/translations/${lang}.js`).catch(() => undefined)
    return (window as unknown as { DecoupledEditor: Build }).DecoupledEditor
  })
  return ready
}

// P1's full toolbar for a memo field, less what needs P1's own services (Kloud uploads, docs, AI links, Max).
const items = [
  "undo",
  "redo",
  "|",
  "heading",
  "|",
  "fontfamily",
  "fontsize",
  "fontColor",
  "fontBackgroundColor",
  "|",
  "sourceEditing",
  "alignment",
  "|",
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "|",
  "link",
  "insertTable",
  "blockQuote",
  "mediaEmbed",
  "|",
  "bulletedList",
  "numberedList",
  "outdent",
  "indent",
]

/** P1's rich text editor for a memo field: its CKEditor with its toolbar above the text. */
export function Ck(props: { html: string; readonly: boolean; onChange: (html: string) => void }) {
  const language = useLanguage()
  let bar: HTMLDivElement | undefined
  let box: HTMLDivElement | undefined
  let editor: Editor | undefined
  let gone = false

  onMount(() => {
    void build(language.locale()).then(async (ck) => {
      if (gone || !box) return
      const made = await ck.create(box, {
        licenseKey: "GPL",
        toolbar: { items, shouldNotGroupWhenFull: false },
        language: language.locale() === "zh" ? "zh-cn" : language.locale() === "zht" ? "zh" : "en",
        link: { addTargetToExternalLinks: true },
        mediaEmbed: { previewsInData: true },
      })
      if (gone) return void made.destroy()
      editor = made
      made.setData(DOMPurify.sanitize(props.html))
      if (props.readonly) made.enableReadOnlyMode("p1")
      bar?.appendChild(made.ui.view.toolbar.element)
      made.model.document.on("change:data", () => props.onChange(made.getData()))
    })
  })
  onCleanup(() => {
    gone = true
    void editor?.destroy()
  })

  return (
    <div data-component="p1-ck" class="p1-ck flex flex-col rounded-md border border-border-weaker-base overflow-hidden">
      <div ref={bar} class="shrink-0 border-b border-border-weaker-base" classList={{ hidden: props.readonly }} />
      <div class="min-h-64 max-h-[60vh] overflow-y-auto">
        <div ref={box} class="min-h-64 px-3 py-2 text-13-regular text-text-strong" />
      </div>
    </div>
  )
}
