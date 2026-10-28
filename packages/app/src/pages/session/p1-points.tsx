import { For, Show, createMemo, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useLanguage } from "@/context/language"
import { load, members, modules, remove, save, type Choice, type Home, type Module } from "@/p1/points"
import { useP1 } from "@/p1/settings"

const cell = "h-8 w-full px-2 rounded-md bg-surface-base border border-border-weaker-base text-13-regular text-text-strong outline-none focus:border-border-interactive-base disabled:opacity-60"

/** P1's spec points popover: the requirement's points split by implementation module, each with an owner. */
export function P1Points(props: {
  project: number
  spec: number
  title: string
  home: Home
  readonly: boolean
  x: number
  y: number
  onClose: (changed: boolean) => void
}) {
  const p1 = useP1()
  const language = useLanguage()
  const [state, setState] = createStore({
    loading: true,
    busy: false,
    err: "",
    rows: [] as Module[],
    modules: [] as Choice[],
    owners: [] as Choice[],
    changed: false,
  })
  const free = (current: number) =>
    state.modules.filter((item) => item.id === current || !state.rows.some((row) => row.module === item.id))
  const total = createMemo(() => state.rows.reduce((sum, row) => sum + row.points, 0))
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

  const read = async () => {
    const host = p1.server()
    const token = p1.token()
    const [rows, mods, people] = await Promise.all([
      load(host, token, props.project, props.spec, props.home, language.locale()),
      modules(host, token, props.home, language.locale()).catch(() => [] as Choice[]),
      members(host, token, props.home, language.locale()).catch(() => [] as Choice[]),
    ]).catch((err: unknown) => {
      setState({ err: message(err), loading: false })
      return []
    })
    if (!rows) return
    setState({ rows, modules: mods ?? [], owners: people ?? [], loading: false })
  }

  // Each change saves at once, as P1's popover does when you leave the cell.
  const put = async (row: Module, moved: boolean, before?: number) => {
    const host = p1.server()
    const token = p1.token()
    setState({ busy: true, err: "" })
    const ok = await (async () => {
      if (before && before !== row.module) await remove(host, token, props.project, props.spec, before, language.locale())
      await save(host, token, { project: props.project, spec: props.spec, home: props.home, row, moved }, language.locale())
    })()
      .then(() => true)
      .catch((err: unknown) => {
        setState("err", message(err))
        return false
      })
    setState({ busy: false, changed: state.changed || ok })
    await read()
  }

  const drop = async (row: Module) => {
    setState({ busy: true, err: "" })
    const ok = await remove(p1.server(), p1.token(), props.project, props.spec, row.module, language.locale())
      .then(() => true)
      .catch((err: unknown) => {
        setState("err", message(err))
        return false
      })
    setState({ busy: false, changed: state.changed || ok })
    await read()
  }

  onMount(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose(state.changed)
    }
    window.addEventListener("keydown", key)
    onCleanup(() => window.removeEventListener("keydown", key))
    void read()
  })

  const width = 720
  return (
    <>
      <div class="fixed inset-0 z-40" onClick={() => props.onClose(state.changed)} />
      <div
        data-component="p1-points"
        class="fixed z-50 flex flex-col rounded-xl overflow-hidden"
        style={{
          width: `${width}px`,
          left: `${Math.max(8, Math.min(props.x - width / 2, window.innerWidth - width - 8))}px`,
          top: `${Math.max(8, Math.min(props.y + 12, window.innerHeight - 380))}px`,
          border: "1px solid var(--border-strong-base)",
          background: "var(--surface-raised-stronger-non-alpha)",
          "box-shadow": "var(--shadow-lg-border-base), 0 24px 64px rgb(0 0 0 / 0.5), 0 4px 16px rgb(0 0 0 / 0.3)",
        }}
      >
        <div class="shrink-0 px-5 pt-4 pb-3 flex items-start gap-3 border-b border-border-weaker-base">
          <div class="min-w-0 flex-1">
            <div class="text-12-medium text-text-weak">{language.t("p1.points.title", { id: String(props.spec) })}</div>
            <div class="mt-0.5 text-14-medium text-text-strong line-clamp-2">{props.title}</div>
          </div>
          <Show when={state.busy}>
            <Spinner class="size-4 mt-1" />
          </Show>
          <div class="shrink-0 text-13-regular text-text-weak">{language.t("p1.points.total", { count: total() })}</div>
        </div>
        <Show when={state.err}>
          <p class="px-5 pt-2 text-12-regular text-text-diff-delete-base">{state.err}</p>
        </Show>
        <div class="max-h-80 overflow-y-auto px-5 py-3">
          <Show
            when={!state.loading}
            fallback={
              <div class="h-24 flex items-center justify-center">
                <Spinner class="size-4" />
              </div>
            }
          >
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="text-12-medium text-text-weak">
                  <th class="py-1.5 pr-2 font-medium w-48">{language.t("p1.points.module")}</th>
                  <th class="py-1.5 pr-2 font-medium w-44">{language.t("p1.col.owner")}</th>
                  <th class="py-1.5 pr-2 font-medium w-20">{language.t("p1.col.points")}</th>
                  <th class="py-1.5 pr-2 font-medium w-14">{language.t("p1.points.tasks")}</th>
                  <th class="py-1.5 pr-2 font-medium w-20">{language.t("p1.points.time")}</th>
                  <th class="py-1.5 pr-2 font-medium w-16">{language.t("p1.points.finish")}</th>
                  <th class="w-8" />
                </tr>
              </thead>
              <tbody>
                <For each={state.rows}>
                  {(row) => (
                    <tr class="border-t border-border-weaker-base text-13-regular text-text-base" data-module={row.module}>
                      <td class="py-1.5 pr-2">
                        <select
                          class={cell}
                          disabled={props.readonly || state.busy}
                          value={String(row.module)}
                          onChange={(event) =>
                            void put({ ...row, module: Number(event.currentTarget.value) }, true, row.module)
                          }
                        >
                          <Show when={!state.modules.some((item) => item.id === row.module)}>
                            <option value={String(row.module)}>{row.name}</option>
                          </Show>
                          <For each={free(row.module)}>{(item) => <option value={String(item.id)}>{item.name}</option>}</For>
                        </select>
                      </td>
                      <td class="py-1.5 pr-2">
                        <select
                          class={cell}
                          disabled={props.readonly || state.busy}
                          value={String(row.owner)}
                          onChange={(event) => void put({ ...row, owner: Number(event.currentTarget.value) }, false)}
                        >
                          <option value="0" />
                          <Show when={row.owner && !state.owners.some((item) => item.id === row.owner)}>
                            <option value={String(row.owner)}>{row.person}</option>
                          </Show>
                          <For each={state.owners}>{(item) => <option value={String(item.id)}>{item.name}</option>}</For>
                        </select>
                      </td>
                      <td class="py-1.5 pr-2">
                        <input
                          class={cell}
                          type="number"
                          min="0"
                          step="any"
                          disabled={props.readonly || state.busy}
                          value={row.points}
                          onChange={(event) => {
                            const points = Number(event.currentTarget.value) || 0
                            if (points !== row.points) void put({ ...row, points }, false)
                          }}
                        />
                      </td>
                      <td class="py-1.5 pr-2">{row.tasks}</td>
                      <td class="py-1.5 pr-2">{row.time}</td>
                      <td class="py-1.5 pr-2">{row.finish}</td>
                      <td class="py-1.5">
                        <Show when={!props.readonly}>
                          <button
                            type="button"
                            data-action="p1-points-remove"
                            class="size-7 rounded-md flex items-center justify-center text-text-weak hover:text-text-strong hover:bg-surface-base-hover disabled:opacity-40"
                            aria-label={language.t("p1.points.remove", { name: row.name })}
                            title={language.t("p1.points.remove", { name: row.name })}
                            disabled={state.busy}
                            onClick={() => void drop(row)}
                          >
                            <Icon name="trash" size="small" />
                          </button>
                        </Show>
                      </td>
                    </tr>
                  )}
                </For>
                <Show when={!props.readonly && free(0).length}>
                  <tr class="border-t border-border-weaker-base">
                    <td class="py-1.5 pr-2">
                      <select
                        class={cell}
                        disabled={state.busy}
                        value=""
                        data-action="p1-points-add"
                        onChange={(event) => {
                          const id = Number(event.currentTarget.value)
                          const found = state.modules.find((item) => item.id === id)
                          if (!found) return
                          void put(
                            { module: id, name: found.name, owner: 0, person: "", points: 0, tasks: 0, time: "", finish: "" },
                            true,
                          )
                        }}
                      >
                        <option value="">{language.t("p1.points.add")}</option>
                        <For each={free(0)}>{(item) => <option value={String(item.id)}>{item.name}</option>}</For>
                      </select>
                    </td>
                    <td colSpan={6} />
                  </tr>
                </Show>
              </tbody>
            </table>
            <Show when={!state.rows.length && props.readonly}>
              <div class="py-4 text-13-regular text-text-weak">{language.t("p1.points.none")}</div>
            </Show>
          </Show>
        </div>
        <div class="shrink-0 px-5 py-3 flex justify-end border-t border-border-weaker-base">
          <Button variant="ghost" size="large" onClick={() => props.onClose(state.changed)} data-action="p1-points-close">
            {language.t("p1.form.close")}
          </Button>
        </div>
      </div>
    </>
  )
}
