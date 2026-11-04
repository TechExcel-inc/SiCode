import { For, Show, createMemo, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useLanguage } from "@/context/language"
import { folders, items, root, size, type Item, type Kind, type Node } from "@/p1/links"
import type { Relation } from "@/p1/pages"
import { useP1 } from "@/p1/settings"
import { BookIcon, Fold, FolderType, SpecIcon, TestIcon } from "./p1-icons"
import { P1Pop } from "./p1-pop"

export type Change = { item: Item; from?: Relation; to?: Relation }

const key = (item: { project: number; id: number }) => `${item.project}:${item.id}`

/**
 * P1's Link Requirement, Link Test Case and Link Knowledge dialog: the space's folder tree on the left, the chosen
 * folder's items (with its subfolders') on the right, 100 to a page. Ticking an item links it and unticking a linked one
 * unlinks it; requirements also pick how they link. Nothing is sent until Submit, and choices survive paging.
 */
export function P1Pick(props: {
  kind: Kind
  at: { project: number; space: number; name: string }
  self: { project: number; id: number }
  linked: Record<string, Relation>
  onSubmit: (changes: Change[]) => Promise<void>
  onClose: () => void
}) {
  const p1 = useP1()
  const language = useLanguage()
  const top = root(props.at)
  const [state, setState] = createStore({
    kids: {} as Record<number, Node[]>,
    open: { [top.id]: true } as Record<number, boolean>,
    node: top,
    find: "",
    query: "",
    page: 1,
    total: 0,
    rows: [] as Item[],
    loading: true,
    // What you ticked, unticked or relinked, by item, until Submit.
    picks: {} as Record<string, { item: Item; to?: Relation }>,
    busy: false,
    err: "",
  })
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

  const expand = async (node: Node, query = "") => {
    const found = await folders(
      p1.server(),
      p1.token(),
      props.kind,
      props.at.project,
      node,
      node.id === top.id,
      query,
      language.locale(),
    ).catch((err: unknown) => {
      setState("err", message(err))
      return [] as Node[]
    })
    setState("kids", node.id, found)
  }
  let stamp = 0
  const load = async () => {
    const at = ++stamp
    setState({ loading: true, err: "" })
    const found = await items(
      p1.server(),
      p1.token(),
      props.kind,
      props.at.project,
      state.node,
      state.query.trim(),
      state.page,
      language.locale(),
    ).catch((err: unknown) => {
      setState("err", message(err))
      return { items: [] as Item[], total: 0 }
    })
    if (at !== stamp) return
    setState({ rows: found.items, total: found.total, loading: false })
  }
  onMount(() => {
    void expand(top)
    void load()
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  const search = (value: string) => {
    setState("query", value)
    clearTimeout(timer)
    timer = setTimeout(() => {
      setState("page", 1)
      void load()
    }, 300)
  }
  const choose = (node: Node) => {
    setState({ node, page: 1 })
    void load()
  }
  const toggle = (node: Node) => {
    const next = !state.open[node.id]
    setState("open", node.id, next)
    if (next && !state.kids[node.id]) void expand(node)
  }

  // Where an item stands: as you set it, else as it's linked now.
  const now = (item: Item) => {
    const pick = state.picks[key(item)]
    return pick ? pick.to : props.linked[key(item)]
  }
  const set = (item: Item, to?: Relation) => {
    const was = props.linked[key(item)]
    if (was === to) {
      const { [key(item)]: _, ...rest } = state.picks
      setState("picks", rest)
      return
    }
    setState("picks", key(item), { item, to })
  }
  const self = (item: Item) => item.project === props.self.project && item.id === props.self.id && props.kind === "spec"
  const changes = createMemo(() =>
    Object.values(state.picks).map((pick) => ({ item: pick.item, from: props.linked[key(pick.item)], to: pick.to })),
  )
  const pages = () => Math.max(1, Math.ceil(state.total / size))
  const submit = async () => {
    if (!changes().length) return props.onClose()
    setState({ busy: true, err: "" })
    const ok = await props
      .onSubmit(changes())
      .then(() => true)
      .catch((err: unknown) => {
        setState("err", message(err))
        return false
      })
    setState("busy", false)
    if (ok) props.onClose()
  }

  // `path` holds the folders above, so a folder listed under itself is never drawn again.
  const Tree = (box: { node: Node; depth: number; path: number[] }) => (
    <>
      <div
        class="h-8 flex items-center gap-1.5 pr-2 rounded-md cursor-pointer select-none"
        classList={{
          "bg-surface-base-active text-text-strong": state.node.id === box.node.id,
          "text-text-base hover:bg-surface-base-hover": state.node.id !== box.node.id,
        }}
        style={{ "padding-left": `${4 + box.depth * 16}px` }}
        onClick={() => choose(box.node)}
      >
        <button
          type="button"
          class="size-4 shrink-0 flex items-center justify-center text-icon-base"
          classList={{ invisible: !box.node.more && !state.kids[box.node.id]?.length }}
          onClick={(event) => {
            event.stopPropagation()
            toggle(box.node)
          }}
        >
          <Fold open={!!state.open[box.node.id]} />
        </button>
        <FolderType type={box.node.type} closed={box.node.closed} />
        <span class="min-w-0 truncate text-13-regular" classList={{ "text-14-medium": box.depth === 0 }}>
          {box.node.name}
        </span>
      </div>
      <Show when={state.open[box.node.id]}>
        <For each={state.kids[box.node.id]?.filter((child) => !box.path.includes(child.id))}>
          {(child) => <Tree node={child} depth={box.depth + 1} path={[...box.path, box.node.id]} />}
        </For>
      </Show>
    </>
  )

  const title = () =>
    language.t(
      props.kind === "spec" ? "p1.page.links.addspec" : props.kind === "test" ? "p1.page.links.addtest" : "p1.page.links.addnote",
    )

  return (
    <P1Pop
      name={`p1-pick-${props.kind}`}
      x={window.innerWidth / 2}
      y={48}
      width={Math.min(1200, window.innerWidth * 0.82)}
      min={{ w: 760, h: 480 }}
      onClose={props.onClose}
    >
      <div class="h-[min(78vh,820px)] flex flex-col">
        <header
          data-drag
          class="shrink-0 px-5 py-3 flex items-center gap-3 border-b border-border-weaker-base cursor-move select-none"
        >
          <div class="min-w-0 flex-1">
            <div class="text-16-medium text-text-strong truncate">{title()}</div>
            <div class="text-12-regular text-text-weak truncate">{props.at.name}</div>
          </div>
          <Show when={changes().length}>
            <span class="text-13-regular text-text-weak">
              {language.t("p1.page.links.changes", { count: changes().length })}
            </span>
          </Show>
          <Button variant="primary" size="large" disabled={state.busy} onClick={() => void submit()}>
            <Show when={state.busy}>
              <Spinner class="size-4" />
            </Show>
            {language.t("p1.form.submit")}
          </Button>
          <Button variant="ghost" size="large" onClick={props.onClose}>
            {language.t("p1.form.cancel")}
          </Button>
        </header>
        <div class="flex-1 min-h-0 flex">
          <aside class="w-64 shrink-0 flex flex-col border-r border-border-weaker-base">
            <Show when={props.kind !== "knowledge"}>
              <div class="shrink-0 p-3 pb-2">
                <div class="h-8 px-2.5 flex items-center gap-2 rounded-md border border-border-weaker-base focus-within:border-border-strong-base">
                  <Icon name="magnifying-glass" size="small" class="text-icon-weak" />
                  <input
                    value={state.find}
                    placeholder={language.t("p1.page.links.findfolder")}
                    class="min-w-0 flex-1 bg-transparent text-13-regular text-text-strong outline-none"
                    onInput={(event) => setState("find", event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void expand(top, state.find.trim())
                    }}
                    onBlur={() => void expand(top, state.find.trim())}
                  />
                </div>
              </div>
            </Show>
            <div class="flex-1 min-h-0 overflow-auto px-2 pb-3" classList={{ "pt-3": props.kind === "knowledge" }}>
              <Tree node={top} depth={0} path={[]} />
            </div>
          </aside>
          <section class="flex-1 min-w-0 flex flex-col">
            <div class="shrink-0 p-3 pb-2 flex items-center gap-3">
              <div class="w-80 h-8 px-2.5 flex items-center gap-2 rounded-md border border-border-weaker-base focus-within:border-border-strong-base">
                <Icon name="magnifying-glass" size="small" class="text-icon-weak" />
                <input
                  value={state.query}
                  autofocus
                  placeholder={language.t("p1.page.links.keyword")}
                  class="min-w-0 flex-1 bg-transparent text-13-regular text-text-strong outline-none"
                  onInput={(event) => search(event.currentTarget.value)}
                />
                <Show when={state.query}>
                  <button
                    type="button"
                    class="text-icon-weak hover:text-text-strong"
                    aria-label={language.t("p1.page.links.clear")}
                    onClick={() => search("")}
                  >
                    <Icon name="close-small" size="small" />
                  </button>
                </Show>
              </div>
              <span class="min-w-0 truncate text-13-regular text-text-weak">{state.node.name}</span>
            </div>
            <div class="flex-1 min-h-0 overflow-auto mx-3 rounded-lg border border-border-weaker-base">
              <table class="w-full border-collapse text-left">
                <thead class="sticky top-0 z-[1] bg-surface-base">
                  <tr class="text-12-medium text-text-weak">
                    <th class="w-10 px-3 py-2" />
                    <th class="w-10 py-2" />
                    <th class="w-28 px-2 py-2">{language.t("p1.page.links.id")}</th>
                    <th class="px-2 py-2">{language.t("p1.page.links.title")}</th>
                    <th class="w-32 px-2 py-2">{language.t("p1.page.links.status")}</th>
                    <Show when={props.kind === "spec"}>
                      <th class="w-36 px-2 py-2">{language.t("p1.page.links.type")}</th>
                    </Show>
                    <Show when={props.kind !== "spec"}>
                      <th class="w-36 px-2 py-2">{language.t("p1.page.links.owner")}</th>
                    </Show>
                  </tr>
                </thead>
                <tbody class="relative">
                  <For each={state.rows}>
                    {(item) => {
                      const on = () => !!now(item)
                      const changed = () => !!state.picks[key(item)]
                      return (
                        <tr
                          class="border-t border-border-weaker-base text-13-regular text-text-strong"
                          classList={{
                            "cursor-pointer hover:bg-surface-base-hover": !self(item),
                            "opacity-50": self(item),
                            "bg-surface-base-active": on(),
                          }}
                          onClick={() => !self(item) && set(item, on() ? undefined : "related")}
                        >
                          <td class="px-3 py-2">
                            <span
                              class="size-4 rounded border flex items-center justify-center"
                              classList={{
                                "bg-[#00AAFF] border-[#00AAFF] text-white": on(),
                                "border-border-strong-base": !on(),
                              }}
                            >
                              <Show when={on()}>
                                <svg class="size-3" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                                  <path
                                    d="M2.5 6.25L5 8.5L9.5 3.5"
                                    stroke="currentColor"
                                    stroke-width="1.75"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                  />
                                </svg>
                              </Show>
                            </span>
                          </td>
                          <td class="py-1.5">
                            <Show
                              when={props.kind === "spec"}
                              fallback={<Show when={props.kind === "test"} fallback={<BookIcon />}><TestIcon /></Show>}
                            >
                              <SpecIcon name={item.icon} />
                            </Show>
                          </td>
                          <td class="px-2 py-2 text-text-weak tabular-nums whitespace-nowrap">
                            <Show when={changed()}>
                              <span class="inline-block size-1.5 mr-1.5 mb-0.5 rounded-full bg-[#00AAFF]" />
                            </Show>
                            {item.id}
                          </td>
                          <td class="px-2 py-2">
                            <span class="line-clamp-2 break-words">{item.title}</span>
                          </td>
                          <td class="px-2 py-2 text-text-base">
                            <span class="line-clamp-1">{item.state}</span>
                          </td>
                          <Show when={props.kind === "spec"}>
                            <td class="px-2 py-1.5" onClick={(event) => event.stopPropagation()}>
                              <Show when={!self(item)}>
                                <select
                                  class="w-full h-7 px-1.5 rounded-md border border-border-weaker-base bg-transparent text-13-regular outline-none"
                                  classList={{ "text-text-strong": on(), "text-text-weaker": !on() }}
                                  value={now(item) ?? ""}
                                  onChange={(event) => set(item, (event.currentTarget.value || undefined) as Relation | undefined)}
                                >
                                  <option value="">{language.t("p1.page.links.as.none")}</option>
                                  <For each={["related", "parent", "child"] as Relation[]}>
                                    {(kind) => <option value={kind}>{language.t(`p1.page.links.as.${kind}`)}</option>}
                                  </For>
                                </select>
                              </Show>
                            </td>
                          </Show>
                          <Show when={props.kind !== "spec"}>
                            <td class="px-2 py-2 text-text-base">
                              <span class="line-clamp-1">{item.owner}</span>
                            </td>
                          </Show>
                        </tr>
                      )
                    }}
                  </For>
                </tbody>
              </table>
              <Show when={state.loading && !state.rows.length}>
                <div class="h-32 flex items-center justify-center">
                  <Spinner class="size-4" />
                </div>
              </Show>
              <Show when={!state.loading && !state.rows.length}>
                <p class="px-3 py-6 text-center text-13-regular text-text-weak">{language.t("p1.page.links.nomatch")}</p>
              </Show>
            </div>
            <footer class="shrink-0 px-3 py-2.5 flex items-center gap-2 text-13-regular text-text-weak">
              <Show when={state.err}>
                <span class="min-w-0 truncate text-text-diff-delete-base">{state.err}</span>
              </Show>
              <Show when={state.loading && state.rows.length}>
                <Spinner class="size-3.5" />
              </Show>
              <div class="flex-1" />
              <span class="tabular-nums">{language.t("p1.page.total", { count: state.total })}</span>
              <button
                type="button"
                class="size-8 rounded-lg flex items-center justify-center border border-border-weaker-base bg-surface-base text-text-strong hover:bg-surface-base-hover disabled:opacity-40 disabled:hover:bg-surface-base"
                aria-label={language.t("p1.page.prev")}
                disabled={state.loading || state.page <= 1}
                onClick={() => {
                  setState("page", state.page - 1)
                  void load()
                }}
              >
                <Icon name="chevron-left" size="small" />
              </button>
              <span class="min-w-8 h-8 px-2 rounded-lg flex items-center justify-center border border-border-interactive-base text-13-medium text-text-strong tabular-nums">
                {state.page} / {pages()}
              </span>
              <button
                type="button"
                class="size-8 rounded-lg flex items-center justify-center border border-border-weaker-base bg-surface-base text-text-strong hover:bg-surface-base-hover disabled:opacity-40 disabled:hover:bg-surface-base"
                aria-label={language.t("p1.page.next")}
                disabled={state.loading || state.page >= pages()}
                onClick={() => {
                  setState("page", state.page + 1)
                  void load()
                }}
              >
                <Icon name="chevron-right" size="small" />
              </button>
            </footer>
          </section>
        </div>
      </div>
    </P1Pop>
  )
}
