import { For, Show, createEffect, createSignal, on, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useLanguage } from "@/context/language"
import { linked, reach, relevant, whole, type Feature as Node } from "@/p1/features"
import { useP1 } from "@/p1/settings"
import { Feature, Fold, Module, Petals, Product, Refresh } from "./p1-icons"

export type Pick = { id: number; title: string; ids: number[] }

// Trees already read, by scope and place, so switching scope or coming back to a folder shows at once.
const kept = new Map<string, Node[]>()

/**
 * The product feature map beside the list, as P1 shows it: the project's products, their modules and feature
 * folders, either those the folder's specs link to (relevant) or all of them. Picking a feature lists its specs.
 */
export function P1Features(props: {
  place: { project: number; space: number; folder: number }
  products: number[]
  picked?: number
  onPick: (pick?: Pick) => void
}) {
  const p1 = useP1()
  const language = useLanguage()
  const [state, setState] = createStore({
    tree: [] as Node[],
    loading: false,
    err: "",
    // Nodes opened or closed by hand; products and modules start open.
    open: {} as Record<number, boolean>,
    menu: false,
    busy: 0,
    // The width while its edge is being dragged.
    wide: undefined as number | undefined,
  })
  // The panel's width, dragged between 200 and 560px and kept in P1 settings.
  const breadth = () => Math.min(560, Math.max(200, state.wide ?? p1.width("features") ?? 300))
  const drag = (event: PointerEvent) => {
    event.preventDefault()
    const from = event.clientX
    const start = breadth()
    const move = (next: PointerEvent) => setState("wide", Math.min(560, Math.max(200, start + next.clientX - from)))
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      p1.size("features", breadth())
      setState("wide", undefined)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }
  const [wave, setWave] = createSignal(0)
  const key = () =>
    p1.scope() === "all"
      ? `all|${props.products.join(",")}`
      : `relevant|${props.place.project}|${props.place.folder}`

  const load = async (fresh = false) => {
    if (!props.products.length || !props.place.folder) return setState({ tree: [], loading: false, err: "" })
    const tag = key()
    const hit = kept.get(tag)
    if (hit && !fresh) return setState({ tree: hit, loading: false, err: "" })
    const mine = setWave((value) => value + 1)
    setState({ loading: true, err: "" })
    const map = await reach(p1.server(), p1.token(), p1.user(), language.locale()).catch(() => undefined)
    if (!map) {
      if (mine === wave()) setState({ loading: false, tree: [], err: language.t("p1.features.nokloud") })
      return
    }
    const tree = await (p1.scope() === "all"
      ? whole(map, props.products)
      : relevant(map, p1.server(), language.locale(), props.place, props.products)
    ).catch((err: unknown) => {
      if (mine === wave()) setState({ err: err instanceof Error ? err.message : String(err) })
      return undefined
    })
    if (mine !== wave()) return
    if (tree) kept.set(tag, tree)
    setState({ loading: false, tree: tree ?? [] })
  }

  createEffect(on(key, () => void load()))

  const pick = async (node: Node) => {
    if (state.busy) return
    setState("busy", node.id)
    const map = await reach(p1.server(), p1.token(), p1.user(), language.locale()).catch(() => undefined)
    const ids = map ? await linked(map, node.id).catch(() => undefined) : undefined
    setState("busy", 0)
    if (!ids) return setState("err", language.t("p1.features.failed"))
    setState("err", "")
    props.onPick({ id: node.id, title: node.title, ids })
  }

  const scope = (next: "relevant" | "all") => {
    setState("menu", false)
    p1.reach(next)
  }

  const row = (node: Node, depth: number): JSX.Element => {
    const open = () => state.open[node.id] ?? depth < 1
    return (
      <>
        <div
          data-action="p1-feature"
          class="group h-8 pr-2 flex items-center gap-1.5 rounded-md cursor-pointer text-13-regular"
          classList={{
            "bg-surface-raised-base-active text-text-strong": props.picked === node.id,
            "text-text-base hover:bg-surface-raised-base-hover": props.picked !== node.id,
          }}
          style={{ "padding-left": `${4 + depth * 16}px` }}
          onClick={() => void pick(node)}
        >
          <button
            type="button"
            class="size-5 shrink-0 rounded flex items-center justify-center text-icon-weak hover:text-text-strong"
            classList={{ invisible: !node.children.length }}
            aria-expanded={open()}
            onClick={(event) => {
              event.stopPropagation()
              setState("open", node.id, !open())
            }}
          >
            <Fold open={open()} />
          </button>
          {depth === 0 ? <Product /> : depth === 1 ? <Module /> : <Feature />}
          <span class="min-w-0 flex-1 truncate">{node.title}</span>
          <Show when={state.busy === node.id}>
            <Spinner class="size-3.5 shrink-0" />
          </Show>
        </div>
        <Show when={open()}>
          <For each={node.children}>{(child) => row(child, depth + 1)}</For>
        </Show>
      </>
    )
  }

  return (
    <aside
      data-component="p1-features"
      class="relative shrink-0 border-r border-border-weaker-base flex flex-col min-h-0 bg-[color-mix(in_srgb,var(--text-interactive-base)_4%,var(--background-base))]"
      style={{ width: `${breadth()}px` }}
    >
      <div
        data-action="p1-features-resize"
        class="group absolute top-0 -right-1.5 z-10 h-full w-3 cursor-col-resize flex justify-center"
        title={language.t("p1.features.resize")}
        onPointerDown={drag}
        onDblClick={() => p1.size("features", undefined)}
      >
        <div class="w-px h-full bg-transparent group-hover:w-0.5 group-hover:bg-border-strong-base group-active:w-0.5 group-active:bg-border-interactive-base" />
      </div>
      <div class="shrink-0 h-12 pl-4 pr-2 flex items-center gap-1 border-b border-border-weaker-base">
        <span class="min-w-0 flex-1 truncate text-14-medium text-text-strong">{language.t("p1.features.title")}</span>
        <button
          type="button"
          data-action="p1-features-refresh"
          class="size-8 shrink-0 rounded-md flex items-center justify-center text-icon-base hover:text-text-strong hover:bg-surface-base-hover disabled:opacity-50"
          aria-label={language.t("p1.refresh")}
          title={language.t("p1.refresh")}
          disabled={state.loading}
          onClick={() => void load(true)}
        >
          <Refresh spin={state.loading} />
        </button>
        <div class="relative">
          <button
            type="button"
            data-action="p1-features-menu"
            class="size-8 rounded-md flex items-center justify-center text-icon-base hover:text-text-strong hover:bg-surface-base-hover"
            aria-label={language.t("p1.features.option")}
            aria-expanded={state.menu}
            onClick={() => setState("menu", !state.menu)}
          >
            <Icon name="dot-grid" size="small" class="rotate-90" />
          </button>
          <Show when={state.menu}>
            <div class="fixed inset-0 z-40" onClick={() => setState("menu", false)} />
            <div
              data-component="p1-features-options"
              class="absolute right-0 top-full mt-1 z-50 w-56 p-1.5 rounded-xl border border-border-weak-base bg-background-base shadow-lg"
            >
              <div class="px-2.5 pt-1.5 pb-1 text-12-medium text-text-weak">{language.t("p1.features.option")}</div>
              <For each={["relevant", "all"] as const}>
                {(item) => (
                  <button
                    type="button"
                    data-action={`p1-features-${item}`}
                    class="w-full h-8 px-2.5 rounded-md flex items-center gap-2 text-13-regular hover:bg-surface-raised-base-hover"
                    classList={{
                      "text-text-interactive-base": p1.scope() === item,
                      "text-text-base": p1.scope() !== item,
                    }}
                    onClick={() => scope(item)}
                  >
                    <span class="flex-1 text-left">{language.t(`p1.features.${item}`)}</span>
                    <Show when={p1.scope() === item}>
                      <Icon name="check-small" size="small" />
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
      <button
        type="button"
        data-action="p1-features-every"
        class="shrink-0 mx-2 mt-2 h-8 px-2 flex items-center gap-2 rounded-md text-13-regular"
        classList={{
          "bg-surface-raised-base-active text-text-strong": !props.picked,
          "text-text-base hover:bg-surface-raised-base-hover": !!props.picked,
        }}
        onClick={() => props.onPick()}
      >
        <Petals />
        {language.t("p1.features.every")}
      </button>
      <Show when={state.err}>
        <p class="shrink-0 px-4 pt-2 text-12-regular text-text-diff-delete-base">{state.err}</p>
      </Show>
      <div class="flex-1 min-h-0 overflow-y-auto px-2 pt-1 pb-3 flex flex-col gap-0.5">
        <Show
          when={!state.loading}
          fallback={
            <div class="pt-10 flex flex-col items-center gap-2 text-12-regular text-text-weak">
              <Spinner class="size-4" />
              {language.t("p1.loading")}
            </div>
          }
        >
          <Show
            when={state.tree.length}
            fallback={
              <p class="px-4 pt-10 text-center text-12-regular text-text-weak">
                {language.t(props.products.length ? "p1.features.none" : "p1.features.off")}
              </p>
            }
          >
            <For each={state.tree}>{(node) => row(node, 0)}</For>
          </Show>
        </Show>
      </div>
    </aside>
  )
}
