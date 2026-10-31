import DOMPurify from "dompurify"
import { For, Show, createResource, createSignal, onCleanup, onMount } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useLanguage } from "@/context/language"
import {
  extension,
  fetchFile,
  files,
  icon,
  notes,
  picture,
  remove,
  upload,
  type Attachment,
  type Note,
} from "@/p1/files"
import { kloud, lasting, lesson, links, prepare, take, unique, viewer, warm, type Kloud } from "@/p1/kloud"
import { useP1 } from "@/p1/settings"
import { layer } from "./p1-pop"
import { Tip } from "./p1-tip"

// Thumbnail or list, as you last left it, for as long as the app runs.
let shown: "thumb" | "list" = "thumb"
// LiveDoc's scripts are loaded out of sight once each time the app runs.
let warmed = false

/**
 * P1's Document field: the spec's attachments as thumbnails or a list, a card to drop, paste or pick files onto,
 * and under it the Linked Meetings. Its labels sit in the form's label column like any field's.
 */
export function Attachments(props: {
  project: number
  id?: number
  name: string
  label: number
  split: number
  must: boolean
  readonly: boolean
}) {
  const p1 = useP1()
  const language = useLanguage()
  const [state, setState] = createStore({
    list: [] as Attachment[],
    loading: true,
    err: "",
    view: shown,
    busy: false,
    drag: false,
    urls: {} as Record<number, string>,
    menu: undefined as { file: Attachment; x: number; y: number } | undefined,
    sure: false,
    // Each file's Kloud document, where P1 is linked to Kloud.
    live: {} as Record<number, number>,
  })
  const opener = useOpener()
  let pick: HTMLInputElement | undefined
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err))
  const docs = () => state.list.filter((file) => file.kind !== 6)
  const meetings = () => state.list.filter((file) => file.kind === 6)

  const read = async () => {
    if (!props.id) return setState("loading", false)
    const list = await files(p1.server(), p1.token(), props.project, props.id, language.locale()).catch(
      (err: unknown) => {
        setState({ err: message(err), loading: false })
      },
    )
    if (!list) return
    setState({ list, loading: false, err: "" })
    void bind(list)
    // Pictures show as themselves, fetched with your sign-in.
    for (const file of list.filter((item) => item.kind !== 6 && picture(item.name) && !state.urls[item.id]))
      void fetchFile(p1.server(), p1.token(), props.project, file, language.locale(), true)
        .then((url) => setState("urls", file.id, url))
        .catch(() => undefined)
  }
  onMount(() => void read())

  const bind = async (list: Attachment[]) => {
    if (props.id) setState("live", await opener.bind(props.project, props.id, list))
  }
  onCleanup(() => Object.values(state.urls).forEach((url) => URL.revokeObjectURL(url)))

  const add = async (list: File[]) => {
    if (!props.id || props.readonly || !list.length) return
    setState({ busy: true, err: "" })
    for (const file of list)
      await upload(p1.server(), p1.token(), props.project, props.id, file, language.locale()).catch((err: unknown) =>
        setState("err", message(err)),
      )
    setState("busy", false)
    await read()
  }
  const view = (next: "thumb" | "list") => {
    shown = next
    setState("view", next)
  }
  // A document in Kloud opens straight in LiveDoc's viewer; anything else shows its actions.
  const show = (file: Attachment, event: MouseEvent) => {
    if (state.live[file.id]) return void act("view", file)
    open(file, event)
  }
  const open = (file: Attachment, event: MouseEvent) =>
    setState({ menu: { file, x: event.clientX, y: event.clientY }, sure: false })
  const act = async (kind: "view" | "download" | "delete", file: Attachment) => {
    if (kind === "delete" && !state.sure) return setState("sure", true)
    setState("menu", undefined)
    const host = p1.server()
    const token = p1.token()
    if (kind === "delete") {
      await remove(host, token, props.project, file.id, language.locale()).catch((err: unknown) =>
        setState("err", message(err)),
      )
      return read()
    }
    await (kind === "view"
      ? opener.open(props.project, file, state.live[file.id])
      : opener.download(props.project, file)
    ).catch((err: unknown) => setState("err", message(err)))
  }

  const Label = (box: { text: string; left?: boolean }) => (
    <Show when={props.label}>
      <span
        class="shrink-0 mr-2.5 pt-1.5 text-14-regular truncate"
        classList={{
          "text-right": !box.left,
          "text-[#d7201f]": props.must && !box.left,
          "text-text-strong": !props.must || !!box.left,
        }}
        style={{ width: `${props.label}px` }}
      >
        {box.text}
      </span>
      <Show when={props.split}>
        <span class="shrink-0" style={{ width: `${props.split}px` }} />
      </Show>
    </Show>
  )

  const box = "rounded-[5px] border border-border-weak-base"

  return (
    <div class="flex flex-col gap-2.5">
      <div class="flex items-start">
        <Label text={props.name || language.t("p1.files.title")} />
        <div class="min-w-0 flex-1 flex flex-col">
          <div class="p-2.5 flex items-center justify-between">
            <div class="flex items-center">
              <For each={["thumb", "list"] as const}>
                {(kind) => (
                  <button
                    type="button"
                    class="mr-2.5 flex items-center text-14-regular"
                    classList={{ "text-[#2d8cf0]": state.view === kind, "text-text-base": state.view !== kind }}
                    onClick={() => view(kind)}
                  >
                    <img
                      class="size-4 mr-[5px]"
                      alt=""
                      src={`/p1/attachment/${kind === "thumb" ? "Thumbnail" : "List"}${state.view === kind ? "_active" : ""}.svg`}
                    />
                    {language.t(`p1.files.${kind}`)}
                  </button>
                )}
              </For>
            </div>
            <div class="flex items-center gap-2.5">
              <Show when={state.view === "list" && !props.readonly && props.id}>
                <button
                  type="button"
                  class="flex items-center gap-1 text-14-regular text-[#2d8cf0]"
                  onClick={() => pick?.click()}
                >
                  <Icon name="cloud-upload" size="small" />
                  {language.t("p1.files.upload")}
                </button>
              </Show>
              <span class="relative group/tip px-1 text-text-base cursor-default">
                ···
                <Tip text={`${language.t("p1.files.zip")} · ${language.t("p1.tab.soon")}`} />
              </span>
            </div>
          </div>
          <input
            ref={pick}
            type="file"
            multiple
            class="hidden"
            onChange={(event) => {
              void add([...(event.currentTarget.files ?? [])])
              event.currentTarget.value = ""
            }}
          />
          <div
            tabIndex={0}
            class={`${box} relative min-h-[124px] outline-none focus:border-[#1984c8]`}
            classList={{
              "px-5 py-2.5 flex flex-wrap": state.view === "thumb" && !!docs().length,
              "border-dashed border-[#1984c8]": state.drag,
              "border-dashed": !docs().length && !state.drag && state.view === "thumb",
            }}
            onDragOver={(event) => {
              event.preventDefault()
              if (!props.readonly) setState("drag", true)
            }}
            onDragLeave={() => setState("drag", false)}
            onDrop={(event) => {
              event.preventDefault()
              setState("drag", false)
              void add([...(event.dataTransfer?.files ?? [])])
            }}
            onPaste={(event) => {
              const list = [...(event.clipboardData?.files ?? [])]
              if (!list.length) return
              event.preventDefault()
              void add(list)
            }}
          >
            <Show
              when={!state.loading}
              fallback={
                <div class="h-[124px] flex items-center justify-center">
                  <Spinner class="size-4" />
                </div>
              }
            >
              <Show when={state.view === "thumb"}>
                <Show
                  when={docs().length}
                  fallback={
                    <button
                      type="button"
                      disabled={props.readonly || !props.id}
                      class="w-full min-h-[122px] flex flex-col items-center justify-center gap-2 disabled:cursor-default"
                      onClick={() => pick?.click()}
                    >
                      <img src="/p1/attachment/attach.svg" alt="" class="h-[47px] opacity-20" />
                      <span class="flex items-center text-14-regular text-[#2d8cf0]">
                        <img src="/p1/attachment/add.svg" alt="" class="size-4 mr-[5px]" />
                        {language.t("p1.files.drop")}
                      </span>
                    </button>
                  }
                >
                  <For each={docs()}>
                    {(file) => (
                      <div class="w-[104px] mr-5 mb-2.5 flex flex-col cursor-pointer">
                        <div
                          class="relative h-[124px] flex items-center justify-center overflow-hidden border border-border-weak-base bg-white hover:border-[#1984c8]"
                          onClick={(event) => show(file, event)}
                        >
                          <Show
                            when={state.urls[file.id]}
                            fallback={<img src={`/p1/document/${icon(file)}.svg`} alt="" class="w-[40%]" />}
                          >
                            {(url) => (
                              <img src={url()} alt="" class="max-w-full max-h-full min-w-[40%] object-contain" />
                            )}
                          </Show>
                        </div>
                        <span
                          class="mt-2.5 flex items-center gap-1 text-14-regular text-[#1984c8] truncate"
                          onClick={(event) => open(file, event)}
                        >
                          <Show when={file.lock}>
                            <Icon name="circle-ban-sign" size="small" class="shrink-0" />
                          </Show>
                          <span class="truncate hover:underline">
                            {file.kind === 5 ? `${file.name}'s pen notes` : file.name}
                          </span>
                        </span>
                      </div>
                    )}
                  </For>
                  <Show when={!props.readonly && props.id}>
                    <button
                      type="button"
                      class="w-[104px] h-[124px] mr-5 mb-2.5 flex flex-col items-center justify-center rounded-[5px] border border-dashed border-border-weak-base text-text-weak hover:border-[#2d8cf0]"
                      onClick={() => pick?.click()}
                    >
                      <Icon name="plus-small" />
                      <span class="mt-2.5 px-1.5 text-13-regular text-center">{language.t("p1.files.drop")}</span>
                    </button>
                  </Show>
                </Show>
              </Show>
              <Show when={state.view === "list"}>
                <div class="max-h-[300px] overflow-y-auto">
                  <table class="w-full border-collapse text-14-regular">
                    <thead>
                      <tr class="text-left text-text-weak">
                        <th class="px-3 py-2 font-normal border-b border-border-weaker-base">
                          {language.t("p1.files.name")}
                        </th>
                        <th class="w-[200px] px-3 py-2 font-normal border-b border-border-weaker-base">
                          {language.t("p1.files.date")}
                        </th>
                        <th class="w-[60px] border-b border-border-weaker-base" />
                      </tr>
                    </thead>
                    <tbody>
                      <For each={docs()}>
                        {(file) => (
                          <tr class="group/row hover:bg-surface-base-hover">
                            <td class="px-3 py-2 border-b border-border-weaker-base">
                              <button
                                type="button"
                                class="text-[#1984c8] hover:underline text-left"
                                onClick={(event) => show(file, event)}
                              >
                                {file.name}
                              </button>
                            </td>
                            <td class="px-3 py-2 border-b border-border-weaker-base text-text-base">
                              {file.date.replace("T", " ").slice(0, 16)}
                            </td>
                            <td class="border-b border-border-weaker-base text-center">
                              <button
                                type="button"
                                class="px-2 text-text-base opacity-0 group-hover/row:opacity-100"
                                onClick={(event) => open(file, event)}
                              >
                                ···
                              </button>
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </Show>
            </Show>
            <Show when={state.busy}>
              <div class="absolute inset-0 flex items-center justify-center bg-black/20">
                <Spinner class="size-5" />
              </div>
            </Show>
          </div>
          <Show when={state.err}>
            <p class="pt-1.5 text-12-regular text-text-diff-delete-base">{state.err}</p>
          </Show>
        </div>
      </div>
      {/* Linked Meetings: the meetings recorded on the spec, P1 keeps them with its attachments. */}
      <div class="flex items-start">
        <Label left text={`${language.t("p1.files.meetings")} (${meetings().length})`} />
        <div class={`${box} min-w-0 flex-1 min-h-[124px] px-5 py-2.5 flex flex-wrap`}>
          <For each={meetings()}>
            {(file) => (
              <div class="relative group/tip w-[104px] h-[124px] mr-5 mb-2.5 flex flex-col rounded-[5px] border border-border-weak-base">
                <div class="flex-1 flex items-center justify-center">
                  <img src="/p1/document/meeting.svg" alt="" class="w-[40%]" />
                </div>
                <div class="pb-2 flex flex-col items-center text-12-regular text-text-base text-center">
                  <span>{stamp(file.changed.date || file.date)}</span>
                  <span class="truncate max-w-full px-1">By: {file.changed.by}</span>
                </div>
                <Tip text={language.t("p1.tab.soon")} />
              </div>
            )}
          </For>
          <div class="relative group/tip w-[104px] h-[124px] mb-2.5 flex flex-col items-center justify-center rounded-[5px] border border-border-weak-base text-text-base">
            <Icon name="plus-small" />
            <span class="mt-2.5 text-13-regular">{language.t("p1.files.meeting")}</span>
            <Tip text={language.t("p1.tab.soon")} />
          </div>
        </div>
      </div>
      <Show when={state.menu}>
        {(menu) => (
          <Menu
            x={menu().x}
            y={menu().y}
            file={menu().file}
            sure={state.sure}
            live={!!state.live[menu().file.id]}
            readonly={props.readonly}
            onAct={(kind) => void act(kind, menu().file)}
            onClose={() => setState("menu", undefined)}
          />
        )}
      </Show>
      <opener.Views />
    </div>
  )
}

/**
 * Opens P1 attachments as the Document field does: a file in Kloud in LiveDoc's viewer, a picture or PDF shown over
 * the page, anything else downloaded. `bind` finds which files are in Kloud; `Views` draws the viewers.
 */
export function useOpener() {
  const p1 = useP1()
  const language = useLanguage()
  const [state, setState] = createStore({
    look: undefined as { url: string; pdf: boolean; name: string } | undefined,
    // Kloud's hosts where P1 is linked to Kloud, and the document open in LiveDoc's viewer.
    kloud: undefined as Kloud | undefined,
    doc: undefined as { url: string; name: string; id: number; lesson: number } | undefined,
    warm: undefined as string | undefined,
  })

  // Finds which files are in Kloud, as P1 does through each version's binding id; quietly none without Kloud.
  const bind = async (project: number, id: number, list: Attachment[]): Promise<Record<number, number>> => {
    const host = p1.server()
    const token = p1.token()
    const found = await kloud(host, token, language.locale()).catch(() => undefined)
    if (!found) return {}
    const ids = list.map((file) => unique(project, id, file.id, file.version))
    const map = await links(found, token, ids).catch(() => ({}) as Record<string, number>)
    // Kloud's tokens are ready before a document is clicked, and LiveDoc's scripts are loaded once out of sight.
    prepare(found, token, p1.user())
    void lasting(found, token, p1.user()).catch(() => undefined)
    if (!warmed) {
      warmed = true
      setState("warm", warm(found))
    }
    setState("kloud", found)
    return Object.fromEntries(
      list.flatMap((file) => {
        const doc = map[unique(project, id, file.id, file.version)]
        return doc ? [[file.id, doc]] : []
      }),
    )
  }
  // The ready viewer token is looked at each minute and swapped before it can go stale.
  const fresh = setInterval(() => {
    if (state.kloud) prepare(state.kloud, p1.token(), p1.user())
  }, 60_000)
  onCleanup(() => clearInterval(fresh))

  // A Kloud document opens on its lesson with the ready viewer token, both had at once, as P1's Edit LiveDoc opens it.
  const begin = async (found: Kloud, id: number, name: string) => {
    const token = p1.token()
    const user = p1.user()
    const made = (again: boolean) => lasting(found, token, user, again).then((keep) => lesson(found, keep, id, name))
    const [live, item] = await Promise.all([take(found, token, user), made(false).catch(() => made(true))])
    return { url: viewer(found, live, item, id, name, language.locale()), name, id, lesson: item }
  }
  // Should LiveDoc still refuse its token, it's signed in again once with a new one, as P1 does.
  let renewed = false
  const renew = async () => {
    const doc = state.doc
    const found = state.kloud
    if (!doc || !found || renewed) return
    renewed = true
    const live = await take(found, p1.token(), p1.user()).catch(() => undefined)
    if (live && state.doc?.id === doc.id)
      setState("doc", "url", viewer(found, live, doc.lesson, doc.id, doc.name, language.locale()))
  }

  const fetch = (project: number, file: Attachment) =>
    fetchFile(p1.server(), p1.token(), project, file, language.locale(), false)
  const download = async (project: number, file: Attachment) => {
    const link = document.createElement("a")
    link.href = await fetch(project, file)
    link.download = file.name
    link.click()
  }
  // `doc` is the file's Kloud document, if it has one; a file that can't be shown is downloaded.
  const open = async (project: number, file: Attachment, doc?: number) => {
    if (doc && state.kloud) {
      renewed = false
      return setState("doc", await begin(state.kloud, doc, file.name))
    }
    if (!picture(file.name) && extension(file.name) !== "pdf") return download(project, file)
    setState("look", { url: await fetch(project, file), pdf: extension(file.name) === "pdf", name: file.name })
  }

  const Views = () => (
    <>
      <Show when={state.look}>{(look) => <Look {...look()} onClose={() => setState("look", undefined)} />}</Show>
      <Show when={state.doc}>
        {(doc) => (
          <LiveDoc url={doc().url} name={doc().name} onRenew={renew} onClose={() => setState("doc", undefined)} />
        )}
      </Show>
      <Show when={state.warm}>
        {(url) => (
          <iframe
            src={url()}
            title=""
            aria-hidden="true"
            tabIndex={-1}
            class="fixed size-px opacity-0 pointer-events-none -left-[9999px]"
            onLoad={() => setTimeout(() => setState("warm", undefined), 5_000)}
          />
        )}
      </Show>
    </>
  )
  return { bind, open, download, Views }
}

/** MM/DD/YYYY hh:mm, as P1 dates a meeting. */
function stamp(value: string) {
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return value
  const two = (n: number) => String(n).padStart(2, "0")
  return `${two(at.getMonth() + 1)}/${two(at.getDate())}/${at.getFullYear()} ${two(at.getHours() % 12 || 12)}:${two(at.getMinutes())}`
}

/** An attachment's actions at the pointer, as P1 lists them: view, open or download, delete. */
function Menu(props: {
  x: number
  y: number
  file: Attachment
  sure: boolean
  live: boolean
  readonly: boolean
  onAct: (kind: "view" | "download" | "delete") => void
  onClose: () => void
}) {
  const language = useLanguage()
  const stack = layer()
  const viewable = props.live || picture(props.file.name) || extension(props.file.name) === "pdf"
  const item = "h-6 pl-5 pr-3 flex items-center text-left text-14-regular whitespace-nowrap"
  return (
    <Portal>
      <div class="fixed inset-0" style={{ "z-index": stack.z }} onClick={() => props.onClose()} />
      <div
        class="fixed w-[180px] py-[5px] flex flex-col rounded-[5px] border border-border-strong-base bg-surface-raised-stronger-non-alpha"
        style={{
          left: `${Math.min(props.x, window.innerWidth - 196)}px`,
          top: `${Math.min(props.y, window.innerHeight - 180)}px`,
          "z-index": stack.z + 1,
          "box-shadow": "0 12px 32px rgb(0 0 0 / 0.35)",
        }}
      >
        <Show when={viewable}>
          <button
            type="button"
            class={`${item} text-text-strong hover:bg-surface-base-hover`}
            onClick={() => props.onAct("view")}
          >
            {language.t("p1.files.view")}
          </button>
        </Show>
        <button
          type="button"
          class={`${item} text-text-strong hover:bg-surface-base-hover`}
          onClick={() => props.onAct("download")}
        >
          {language.t("p1.files.download")}
        </button>
        <For each={["checkin", "lock", "history"]}>
          {(key) => (
            <span class={`${item} justify-between gap-2 text-text-weak`}>
              {language.t(`p1.files.${key}`)}
              <span class="text-11-regular text-text-weaker">{language.t("p1.tab.soon")}</span>
            </span>
          )}
        </For>
        <Show when={!props.readonly}>
          <button
            type="button"
            class={`${item} hover:bg-surface-base-hover`}
            classList={{ "text-text-diff-delete-base": props.sure, "text-text-strong": !props.sure }}
            onClick={() => props.onAct("delete")}
          >
            {language.t(props.sure ? "p1.files.sure" : "p1.files.delete")}
          </button>
        </Show>
      </div>
    </Portal>
  )
}

/**
 * LiveDoc's own viewer for a Kloud document, framed over everything as P1 shows it: it can fill the window, and it
 * closes from its own close as well as SiCode's.
 */
function LiveDoc(props: { url: string; name: string; onRenew: () => void; onClose: () => void }) {
  const stack = layer()
  const [full, setFull] = createSignal(false)
  let frame: HTMLIFrameElement | undefined
  let wait: ReturnType<typeof setTimeout> | undefined
  onMount(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && stack.top()) props.onClose()
    }
    // Only this viewer's frame is heard. LiveDoc says `invalid-token` several times as it loads, so, as P1 does, a
    // burst of them renews once after 300ms.
    const said = (event: MessageEvent) => {
      if (!within(event.source, frame?.contentWindow)) return
      const data = event.data as unknown
      const type =
        typeof data === "string"
          ? data
          : data && typeof data === "object"
            ? (data as { type?: unknown }).type
            : undefined
      if (type === "close" || type === "closeLiveDoc") props.onClose()
      if (type !== "invalid-token") return
      clearTimeout(wait)
      wait = setTimeout(() => props.onRenew(), 300)
    }
    window.addEventListener("keydown", key)
    window.addEventListener("message", said)
    onCleanup(() => {
      clearTimeout(wait)
      window.removeEventListener("keydown", key)
      window.removeEventListener("message", said)
    })
  })
  return (
    <Portal>
      <div
        class="fixed inset-0"
        style={{ "z-index": stack.z, background: "rgb(0 0 0 / 0.55)" }}
        onClick={() => props.onClose()}
      />
      <div
        data-component="p1-livedoc"
        class="fixed flex flex-col overflow-hidden bg-white"
        classList={{ "inset-0": full(), "inset-[4%] rounded-xl border border-border-strong-base": !full() }}
        style={{ "z-index": stack.z + 1, "box-shadow": "0 24px 64px rgb(0 0 0 / 0.5)" }}
      >
        <div class="absolute right-2 top-2 z-10 flex items-center gap-1">
          <button
            type="button"
            data-action="p1-livedoc-full"
            class="size-8 rounded-lg flex items-center justify-center text-black/70 hover:text-black hover:bg-black/5"
            onClick={() => setFull((on) => !on)}
          >
            <Icon name={full() ? "collapse" : "expand"} size="small" style={{ color: "#333" }} />
          </button>
          <button
            type="button"
            data-action="p1-livedoc-close"
            class="size-8 rounded-lg flex items-center justify-center text-black/70 hover:text-black hover:bg-black/5"
            onClick={() => props.onClose()}
          >
            <Icon name="close" size="small" style={{ color: "#333" }} />
          </button>
        </div>
        <iframe
          ref={frame}
          src={props.url}
          title={props.name}
          class="flex-1 w-full border-0"
          allow="fullscreen; clipboard-read; clipboard-write; autoplay; camera; microphone; picture-in-picture"
        />
      </div>
    </Portal>
  )
}

/** Whether a message came from a frame's page or a frame inside it. */
function within(source: MessageEventSource | null, top: Window | null | undefined) {
  if (!top || !source || !("parent" in source)) return false
  for (let win: Window = source; ; win = win.parent) {
    if (win === top) return true
    if (win === win.parent) return false
  }
}

/** A picture or PDF attachment, shown over the form. */
function Look(props: { url: string; pdf: boolean; name: string; onClose: () => void }) {
  const stack = layer()
  onMount(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && stack.top()) props.onClose()
    }
    window.addEventListener("keydown", key)
    onCleanup(() => {
      window.removeEventListener("keydown", key)
      URL.revokeObjectURL(props.url)
    })
  })
  return (
    <Portal>
      <div
        class="fixed inset-0 flex flex-col items-center justify-center gap-3 p-8"
        style={{ "z-index": stack.z, background: "rgb(0 0 0 / 0.7)" }}
        onClick={() => props.onClose()}
      >
        <div class="w-full max-w-5xl flex items-center justify-between text-14-medium text-white">
          <span class="truncate">{props.name}</span>
          <button type="button" class="size-8 flex items-center justify-center" onClick={() => props.onClose()}>
            <Icon name="close" size="small" />
          </button>
        </div>
        <Show
          when={props.pdf}
          fallback={<img src={props.url} alt={props.name} class="max-w-full max-h-[85vh] object-contain" />}
        >
          <iframe src={props.url} title={props.name} class="w-full max-w-5xl h-[85vh] bg-white rounded" />
        </Show>
      </div>
    </Portal>
  )
}

/** P1's Comments field: each comment with who wrote it and when, its replies under it. */
export function Notes(props: { project: number; id?: number }) {
  const p1 = useP1()
  const language = useLanguage()
  const [list] = createResource(
    () => (props.id ? ([p1.server(), p1.token(), props.project, props.id] as const) : undefined),
    (a) => notes(...a, language.locale()),
  )
  const One = (note: { note: Note; reply?: boolean }) => (
    <div
      class="p-2.5 flex flex-col gap-1 rounded-[5px]"
      classList={{ "ml-10 rounded-[10px] bg-surface-base border-b border-border-weaker-base": !!note.reply }}
    >
      <div class="flex items-center gap-2 text-13-regular">
        <span class="text-text-strong">{note.note.by}</span>
        <span class="text-text-weak">{note.note.lag}</span>
      </div>
      <div
        class="ck-content text-14-regular text-text-strong [&_img]:max-w-[40%]"
        innerHTML={DOMPurify.sanitize(note.note.html)}
      />
      <For each={note.note.replies}>{(reply) => <One note={reply} reply />}</For>
    </div>
  )
  return (
    <div
      class="min-h-[60px] px-5 py-2.5 rounded-[5px] border border-border-weak-base"
      classList={{ "border-dashed": !list()?.length }}
    >
      <Show when={!list.loading} fallback={<Spinner class="size-4" />}>
        <Show
          when={list()?.length}
          fallback={
            <div class="relative group/tip py-2 flex flex-col items-center gap-2">
              <img src="/p1/attachment/chat.svg" alt="" class="h-8 opacity-30" />
              <span class="flex items-center text-14-regular text-[#2d8cf0]">
                <img src="/p1/attachment/add.svg" alt="" class="size-4 mr-[5px]" />
                {language.t("p1.files.comment")}
              </span>
              <Tip text={language.t("p1.tab.soon")} />
            </div>
          }
        >
          <For each={list()}>{(note) => <One note={note} />}</For>
        </Show>
      </Show>
    </div>
  )
}
