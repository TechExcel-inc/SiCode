import DOMPurify from "dompurify"
import { For, Show, createResource, type JSX } from "solid-js"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useLanguage } from "@/context/language"
import { content, events, history, versions } from "@/p1/pages"
import { useP1 } from "@/p1/settings"

/** One of P1's own requirement pages: history (104), version (105), event (106), document content (125); links and the relationship map come later. */
export function P1Page(props: { kind: number; project: number; id: number; folder: number }) {
  const p1 = useP1()
  const language = useLanguage()
  const args = () => [p1.server(), p1.token(), props.project, props.id] as const
  const date = (value: string) => value.replace("T", " ").slice(0, 16)

  const Wait = (box: { children: JSX.Element; loading: boolean; error: unknown; empty: boolean }) => (
    <Show
      when={!box.loading}
      fallback={
        <div class="h-32 flex items-center justify-center">
          <Spinner class="size-4" />
        </div>
      }
    >
      <Show
        when={!box.error}
        fallback={<p class="p-5 text-13-regular text-text-diff-delete-base">{String(box.error)}</p>}
      >
        <Show
          when={!box.empty}
          fallback={<p class="p-5 text-13-regular text-text-weak">{language.t("p1.page.none")}</p>}
        >
          {box.children}
        </Show>
      </Show>
    </Show>
  )

  const head = "px-3 py-2 text-left text-13-medium text-text-weak border-b border-border-weaker-base whitespace-nowrap"
  const cell = "px-3 py-2 text-13-regular text-text-strong border-b border-border-weaker-base align-top"

  if (props.kind === 104) {
    const [data] = createResource(args, (a) => history(...a, language.locale()))
    return (
      <Wait loading={data.loading} error={data.error} empty={!data()?.handoffs.length && !data()?.logs.length}>
        <div class="p-5 flex flex-col gap-5">
          <section class="flex flex-col gap-2.5">
            <h3 class="text-14-medium text-text-strong">{language.t("p1.page.handoffs")}</h3>
            <div class="flex gap-2.5 overflow-x-auto pb-1">
              <For each={data()?.handoffs}>
                {(item, index) => (
                  <div class="shrink-0 w-56 flex rounded-lg border border-border-weaker-base overflow-hidden">
                    <div class="w-20 p-2 flex flex-col items-center justify-center gap-1 text-center">
                      <span class="text-12-medium text-text-strong">
                        {language.t(index() ? "p1.page.forwarded" : "p1.page.submitted")}
                      </span>
                      <span class="text-12-regular text-text-weak break-words">{item.by}</span>
                    </div>
                    <div class="flex-1 flex flex-col border-l border-border-weaker-base text-center">
                      <span class="px-2 py-1.5 bg-surface-base text-13-medium text-text-strong">{item.state}</span>
                      <span class="px-2 py-1.5 text-12-regular text-text-weak">{date(item.date)}</span>
                      <span class="px-2 py-1.5 bg-surface-base text-12-regular text-text-weak">
                        {language.t("p1.page.owner")}
                        <span class="block text-13-medium text-text-strong">{item.owner}</span>
                      </span>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </section>
          <section class="flex flex-col gap-2.5">
            <h3 class="text-14-medium text-text-strong">{language.t("p1.page.log")}</h3>
            <For each={data()?.logs}>
              {(item) => (
                <div class="p-3 flex flex-col gap-1 rounded-lg border border-border-weaker-base">
                  <div class="flex items-center gap-3 text-12-regular text-text-weak">
                    <span>{date(item.date)}</span>
                    <span>{item.by}</span>
                  </div>
                  <p class="text-13-regular text-text-strong whitespace-pre-wrap break-words">{item.text}</p>
                </div>
              )}
            </For>
          </section>
        </div>
      </Wait>
    )
  }

  if (props.kind === 105) {
    const [data] = createResource(args, (a) => versions(...a, language.locale()))
    return (
      <Wait loading={data.loading} error={data.error} empty={!data()?.length}>
        <table class="w-full border-collapse">
          <thead>
            <tr>
              <th class={head}>{language.t("p1.page.version")}</th>
              <th class={head}>{language.t("p1.page.by")}</th>
              <th class={head}>{language.t("p1.page.created")}</th>
            </tr>
          </thead>
          <tbody>
            <For each={data()}>
              {(item) => (
                <tr>
                  <td class={cell}>{item.name}</td>
                  <td class={cell}>{item.by}</td>
                  <td class={cell}>{date(item.date)}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Wait>
    )
  }

  if (props.kind === 106) {
    const [data] = createResource(
      () => [...args(), props.folder] as const,
      (a) => events(a[0], a[1], a[2], a[3], a[4], language.locale()),
    )
    return (
      <Wait loading={data.loading} error={data.error} empty={!data()?.length}>
        <table class="w-full border-collapse">
          <thead>
            <tr>
              <For each={["name", "start", "due", "owner", "state", "text"]}>
                {(key) => <th class={head}>{language.t(`p1.page.event.${key}`)}</th>}
              </For>
            </tr>
          </thead>
          <tbody>
            <For each={data()}>
              {(item) => (
                <tr>
                  <td class={cell}>{item.title}</td>
                  <td class={cell}>{item.start.slice(0, 10)}</td>
                  <td class={cell}>{item.due.slice(0, 10)}</td>
                  <td class={cell}>{item.owner}</td>
                  <td class={cell}>{item.state}</td>
                  <td class={`${cell} max-w-80`}>
                    <div class="line-clamp-3" innerHTML={DOMPurify.sanitize(item.text)} />
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Wait>
    )
  }

  if (props.kind === 125) {
    const [data] = createResource(args, (a) => content(...a, language.locale()))
    return (
      <Wait loading={data.loading} error={data.error} empty={!data()}>
        <div
          class="ck-content px-5 py-3 text-14-regular text-text-strong [&_img]:max-w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border-weaker-base [&_td]:px-2 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5"
          innerHTML={DOMPurify.sanitize(data() ?? "")}
        />
      </Wait>
    )
  }

  return (
    <div class="h-32 flex items-center justify-center text-13-regular text-text-weak">{language.t("p1.tab.soon")}</div>
  )
}
