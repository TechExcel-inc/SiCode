import { For, Show, onMount } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore } from "solid-js/store"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useLanguage } from "@/context/language"
import { item } from "@/p1/api"
import { files, icon, reports, type Attachment } from "@/p1/files"
import { kloud } from "@/p1/kloud"
import { useP1 } from "@/p1/settings"
import { layer } from "./p1-pop"
import type { useOpener } from "./p1-files"

const width = 340

/**
 * The menu P1's list opens from a requirement's icon: its LiveDoc Reports, its documents to open, and Ask Bot. It
 * sits beside the icon and lists what it finds as soon as the requirement's files and description arrive.
 */
export function P1Attach(props: {
  project: number
  id: number
  at: DOMRect
  opener: ReturnType<typeof useOpener>
  onClose: () => void
}) {
  const p1 = useP1()
  const language = useLanguage()
  const stack = layer()
  const [state, setState] = createStore({
    loading: true,
    err: "",
    reports: [] as ReturnType<typeof reports>,
    docs: [] as Attachment[],
    // Each document's Kloud document, where P1 is linked to Kloud.
    live: {} as Record<number, number>,
    // Ask Bot is offered where P1 is linked to Kloud, as P1 offers it.
    linked: false,
  })
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

  // P1 asks for the files and the description together; linked meetings aren't listed here.
  onMount(async () => {
    void kloud(p1.server(), p1.token(), language.locale())
      .then((found) => setState("linked", !!found))
      .catch(() => undefined)
    const [list, about] = await Promise.all([
      files(p1.server(), p1.token(), props.project, props.id, language.locale()).catch((err: unknown) => {
        setState("err", message(err))
        return [] as Attachment[]
      }),
      item(p1.server(), p1.token(), props.project, props.id, language.locale()).catch(() => undefined),
    ])
    const docs = list.filter((file) => file.kind !== 6)
    setState({ docs, reports: reports(about?.html ?? ""), loading: false })
    if (docs.length) setState("live", await props.opener.bind(props.project, props.id, docs))
  })

  const open = (file: Attachment) => {
    props.onClose()
    void props.opener.open(props.project, file, state.live[file.id]).catch(() => undefined)
  }
  const name = (file: Attachment) =>
    file.kind === 5 ? language.t("p1.attach.notes", { name: file.name }) : file.name

  // Beside the icon, as P1 places it, kept inside the window.
  const left = () => Math.max(8, Math.min(props.at.right + 8, window.innerWidth - width - 8))
  const top = () => Math.max(8, Math.min(props.at.top - 6, window.innerHeight - 280))
  const row = "w-full h-9 px-3 flex items-center gap-2.5 text-left text-14-regular text-text-strong"
  return (
    <Portal>
      <div class="fixed inset-0" style={{ "z-index": stack.z }} onClick={() => props.onClose()} />
      <div
        data-component="p1-attach"
        class="fixed max-h-[272px] py-1 flex flex-col overflow-y-auto rounded-[5px] border border-border-strong-base bg-surface-raised-stronger-non-alpha"
        style={{
          left: `${left()}px`,
          top: `${top()}px`,
          width: `${width}px`,
          "z-index": stack.z + 1,
          "box-shadow": "0 12px 32px rgb(0 0 0 / 0.35)",
        }}
      >
        <For each={state.reports}>
          {() => (
            <button type="button" data-action="p1-attach-report" class={`${row} hover:bg-surface-base-hover`}>
              <img src="/p1/document/liveImage.svg" alt="" class="size-5 shrink-0" />
              <span class="truncate">{language.t("p1.attach.report")}</span>
            </button>
          )}
        </For>
        <For each={state.docs}>
          {(file, index) => (
            <button
              type="button"
              data-action="p1-attach-open"
              class={`${row} hover:bg-surface-base-hover`}
              title={name(file)}
              onClick={() => open(file)}
            >
              <img src={`/p1/document/${icon(file)}.svg`} alt="" class="size-5 shrink-0" />
              <span class="truncate">
                {index() + 1}. {name(file)}
              </span>
            </button>
          )}
        </For>
        <Show when={state.loading}>
          <div class="h-9 px-3 flex items-center gap-2.5 text-13-regular text-text-weak">
            <Spinner class="size-4" />
            {language.t("p1.loading")}
          </div>
        </Show>
        <Show when={state.err}>
          <div class="px-3 py-1.5 text-12-regular text-text-diff-delete-base">{state.err}</div>
        </Show>
        <Show when={state.linked}>
          <button type="button" data-action="p1-attach-bot" class={`${row} hover:bg-surface-base-hover`}>
            <img src="/p1/attachment/bot.svg" alt="" class="size-5 shrink-0" />
            <span class="truncate">{language.t("p1.attach.bot")}</span>
          </button>
        </Show>
      </div>
    </Portal>
  )
}
