import { For, Show, createMemo, onCleanup, onMount, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useLanguage } from "@/context/language"
import type { Choice, Field, Page, State } from "@/p1/form"
import { arrange } from "@/p1/layout"
import { upload } from "@/p1/files"
import { folders, root, type Node } from "@/p1/links"
import { useP1 } from "@/p1/settings"
import { access, create, env, fields, open, rich, select, type Rules, type Values } from "@/p1/template"
import { Ck } from "./p1-ck"
import { Fold, FolderType } from "./p1-icons"
import { Attachments } from "./p1-files"
import { Frame } from "./p1-item"
import { layer } from "./p1-pop"
import { Tip } from "./p1-tip"

/**
 * P1's New Template dialog for a test case under a spec: state buttons, the tabs P1's admin chose for new test cases
 * laid out as designed, the Template Folder above them, and the fields each state requires, hides or locks. The
 * spec's title and description start it off; Submit creates it in the chosen folder and links it to the spec.
 */
export function P1Template(props: {
  test: { project: number; space: number; name: string }
  spec: { project: number; id: number; title: string }
  onCreated: (item: { id: number; project: number; title: string; state: string; owner: string }) => void
  onClose: () => void
}) {
  const p1 = useP1()
  const language = useLanguage()
  const [state, setState] = createStore({
    loading: true,
    busy: false,
    err: "",
    pages: [] as Page[],
    page: 0,
    states: [] as State[],
    rules: { required: [], readonly: [], hidden: [] } as Rules,
    owners: [] as Choice[],
    choices: {} as Record<number, Choice[]>,
    values: {} as Values,
    id: 0,
    folder: { id: props.test.space, name: props.test.name },
    // Files dropped on the attachment box, uploaded once the test case exists.
    files: [] as File[],
    // Created already, so Submit doesn't create it twice after a file fails to upload.
    done: false,
    picking: false,
    width: 0,
  })
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err))
  const at = layer()

  onMount(() => {
    void open(p1.server(), p1.token(), props.test, props.spec, p1.user(), language.locale())
      .then((found) => setState({ ...found, loading: false }))
      .catch((err: unknown) => setState({ err: message(err), loading: false }))
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && at.top() && !state.picking) props.onClose()
    }
    window.addEventListener("keydown", key)
    onCleanup(() => window.removeEventListener("keydown", key))
  })

  const value = (id: number) => state.values[id] ?? ""
  const put = (id: number, next: string) => setState("values", id, next)
  const now = () => state.states.find((item) => String(item.id) === value(fields.state))
  const required = (field: Field) =>
    field.id === fields.title || !!field.must || state.rules.required.includes(field.id)
  const readonly = (field: Field) =>
    field.id === fields.state || field.id === fields.parent || state.rules.readonly.includes(field.id)
  const shown = (field: Field) => !state.rules.hidden.includes(field.id)
  const page = () => state.pages[state.page]
  const rows = createMemo(() => {
    const list = (page()?.fields ?? []).filter(shown)
    if (state.width <= 500 || !list.some((field) => field.at)) return
    return arrange(list, state.width)
  })
  const watch = (el: HTMLDivElement) => {
    const resize = new ResizeObserver(() => setState("width", Math.trunc(el.clientWidth - 48)))
    resize.observe(el)
    onCleanup(() => resize.disconnect())
  }

  const move = async (next: State) => {
    put(fields.state, String(next.id))
    const found = await access(
      p1.server(),
      p1.token(),
      props.test.project,
      next.id,
      p1.user(),
      language.locale(),
    ).catch(() => undefined)
    if (found) setState("rules", found)
  }

  const submit = async () => {
    const missing = state.pages
      .flatMap((item) => item.fields)
      .filter(
        (field) =>
          shown(field) && required(field) && !readonly(field) && !value(field.id).replace(/<[^>]*>|&nbsp;|\s/g, ""),
      )
      .map((field) => field.name)
    if (!state.folder.id && state.folder.id !== 0) missing.unshift(language.t("p1.template.folder"))
    if (missing.length)
      return setState("err", language.t("p1.template.missing", { fields: [...new Set(missing)].join(", ") }))
    if (state.done) return props.onClose()
    setState({ busy: true, err: "" })
    const id = await create(
      p1.server(),
      p1.token(),
      {
        project: props.test.project,
        folder: state.folder.id,
        id: state.id,
        values: state.values,
        pages: state.pages,
        spec: { project: props.spec.project, id: props.spec.id },
      },
      language.locale(),
    ).catch((err: unknown) => {
      setState({ err: message(err), busy: false })
      return undefined
    })
    if (id === undefined) return
    props.onCreated({
      id,
      project: props.test.project,
      title: value(fields.title),
      state: now()?.name ?? "",
      owner: state.owners.find((item) => String(item.id) === value(fields.owner))?.name ?? "",
    })
    // As P1 does, the files go up once the test case exists.
    const failed: string[] = []
    for (const file of state.files)
      await upload(p1.server(), p1.token(), props.test.project, id, file, language.locale(), 201).catch(() =>
        failed.push(file.name),
      )
    if (!failed.length) return props.onClose()
    setState({ busy: false, done: true, err: language.t("p1.template.unsent", { files: failed.join(", ") }) })
  }

  const box =
    "w-full h-8 px-2.5 rounded-[5px] border border-border-weak-base bg-transparent text-14-regular text-text-strong outline-none focus:border-border-interactive-base disabled:bg-surface-base disabled:text-text-weak"

  const Control = (item: { field: Field }): JSX.Element => {
    const field = item.field
    const locked = () => readonly(field)
    if (field.type === 18) return <div class="text-14-regular text-text-strong whitespace-pre-wrap">{field.name}</div>
    if (field.id === fields.state)
      return <div class={`${box} flex items-center bg-surface-base text-text-base`}>{now()?.name ?? ""}</div>
    if (field.id === fields.parent)
      return (
        <div class={`${box} flex items-center gap-1.5 bg-surface-base`}>
          <span class="text-text-weak tabular-nums">{props.spec.id}</span>
          <span class="truncate">{props.spec.title}</span>
        </div>
      )
    if (fields.feature.includes(field.id))
      return (
        <div class="relative group/tip">
          <div class={`${box} flex items-center justify-between text-text-weaker`}>
            {language.t("p1.item.select")}
            <Icon name="chevron-down" size="small" />
          </div>
          <Tip side="left" text={language.t("p1.tab.soon")} />
        </div>
      )
    if (rich(field)) return <Ck html={value(field.id)} readonly={locked()} onChange={(html) => put(field.id, html)} />
    if (field.id === fields.setup || field.id === fields.test) {
      const total = () => Number(value(field.id)) || 0
      const part = (unit: "h" | "m") => (unit === "h" ? Math.floor(total() / 3600) : Math.floor((total() % 3600) / 60))
      const change = (unit: "h" | "m", next: number) => {
        const hours = unit === "h" ? next : part("h")
        const minutes = unit === "m" ? next : part("m")
        put(field.id, String(Math.max(0, hours) * 3600 + Math.max(0, minutes) * 60))
      }
      return (
        <div class="flex items-center gap-2">
          <For each={["h", "m"] as const}>
            {(unit) => (
              <>
                <input
                  type="number"
                  min="0"
                  max={unit === "m" ? 59 : undefined}
                  disabled={locked()}
                  class={box}
                  value={part(unit)}
                  onInput={(event) => change(unit, Math.trunc(Number(event.currentTarget.value) || 0))}
                />
                <span class="shrink-0 text-13-regular text-text-weak">{language.t(`p1.template.${unit}`)}</span>
              </>
            )}
          </For>
        </div>
      )
    }
    if (field.id === fields.owner || select(field)) {
      const list = () => (field.id === fields.owner ? state.owners : (state.choices[field.id] ?? []))
      return (
        <select
          disabled={locked()}
          class={box}
          value={value(field.id)}
          onChange={(event) => put(field.id, event.currentTarget.value)}
        >
          <option value="" />
          <For each={list()}>{(choice) => <option value={String(choice.id)}>{choice.name}</option>}</For>
        </select>
      )
    }
    return (
      <input
        type={field.type === 1 || field.type === 2 ? "number" : field.type === 3 ? "date" : "text"}
        disabled={locked()}
        class={box}
        value={value(field.id)}
        onInput={(event) => put(field.id, event.currentTarget.value)}
      />
    )
  }

  // A field as P1 draws it: its label right-aligned in the room the designer gave it, then the control. File
  // attachments are the requirement's attachment box, holding files until the test case is created.
  const Item = (item: { field: Field; label?: number; split?: number; bare?: boolean }) => (
    <Show
      when={item.field.type !== 23}
      fallback={
        <div class="px-2.5 py-[5px]">
          <Attachments
            project={props.test.project}
            name={item.field.name}
            label={item.bare ? 0 : (item.label ?? 120)}
            split={item.split ?? 0}
            must={required(item.field)}
            readonly={readonly(item.field)}
            view={201}
            queue={state.files}
            onQueue={(list) => setState("files", list)}
          />
        </div>
      }
    >
      <div class="flex min-h-11 px-2.5 py-[5px]" classList={{ "items-center": !rich(item.field) }}>
        <Show when={!item.bare}>
          <span
            class="shrink-0 mr-2.5 text-14-regular text-right line-clamp-2 break-words"
            classList={{
              "text-[#d7201f]": required(item.field),
              "text-text-strong": !required(item.field),
              "pt-1.5": rich(item.field),
            }}
            style={{ width: `${item.label ?? 120}px` }}
          >
            {item.field.name}
          </span>
          <Show when={item.split}>
            <span class="shrink-0" style={{ width: `${item.split}px` }} />
          </Show>
        </Show>
        <div class="min-w-0 flex-1">
          <Control field={item.field} />
        </div>
      </div>
    </Show>
  )

  return (
    <Portal>
      <div style={{ position: "relative", "z-index": at.z }}>
        <Frame name="p1-template" class="max-w-[min(1440px,92vw)] h-[88vh]">
          <header class="shrink-0 px-5 py-2.5 flex items-center gap-2.5 border-b border-border-weaker-base">
            <div class="min-w-0 flex-1 truncate text-18-medium text-text-strong">{language.t("p1.template.new")}</div>
            <Button variant="primary" size="large" disabled={state.loading || state.busy} onClick={() => void submit()}>
              <Show when={state.busy}>
                <Spinner class="size-4" />
              </Show>
              {language.t("p1.form.submit")}
            </Button>
            <Button variant="ghost" size="large" onClick={props.onClose}>
              {language.t("p1.form.cancel")}
            </Button>
          </header>
          <Show when={state.err}>
            <p class="shrink-0 px-5 pt-3 text-13-regular text-text-diff-delete-base">{state.err}</p>
          </Show>
          <Show
            when={!state.loading}
            fallback={
              <div class="flex-1 flex items-center justify-center">
                <Spinner class="size-5" />
              </div>
            }
          >
            <Show when={state.states.length}>
              <div class="shrink-0 px-5 pb-2.5 flex flex-wrap gap-2.5">
                <For each={state.states}>
                  {(item) => {
                    const on = () => value(fields.state) === String(item.id)
                    const color = item.closed ? "#E99A16" : "#00AAFF"
                    return (
                      <button
                        type="button"
                        class="mt-2.5 px-2.5 py-[5px] rounded-[5px] border text-14-regular"
                        style={{
                          "border-color": color,
                          background: on() ? color : "transparent",
                          color: on() ? "#fff" : "var(--text-strong)",
                        }}
                        onClick={() => void move(item)}
                      >
                        {item.name}
                      </button>
                    )
                  }}
                </For>
              </div>
            </Show>
            <nav class="relative shrink-0 px-2.5 flex overflow-x-auto">
              <span class="absolute inset-x-0 bottom-0 border-b border-border-weaker-base" />
              <For each={state.pages}>
                {(item, index) => (
                  <button
                    type="button"
                    class="relative z-[1] shrink-0 px-2.5 py-[5px] whitespace-nowrap text-14-regular border-b"
                    classList={{
                      "text-[#00AAFF] border-[#00AAFF]": state.page === index(),
                      "text-text-strong border-transparent": state.page !== index(),
                    }}
                    onClick={() => setState("page", index())}
                  >
                    {item.name}
                  </button>
                )}
              </For>
            </nav>
            <div class="flex-1 min-h-0 overflow-y-auto">
              <Show
                when={page()?.id !== env}
                fallback={
                  <div class="h-32 flex items-center justify-center text-13-regular text-text-weak">
                    {language.t("p1.tab.soon")}
                  </div>
                }
              >
                <div ref={watch} class="py-2.5 pl-5 pr-7">
                  <div class="relative flex items-center min-h-11 px-2.5 py-[5px]">
                    <span class="shrink-0 w-[120px] mr-2.5 text-14-regular text-right text-[#d7201f]">
                      {language.t("p1.template.folder")}
                    </span>
                    <div class="relative min-w-0 flex-1 flex">
                      <div class={`${box} rounded-r-none flex items-center bg-surface-base truncate`}>
                        {state.folder.name}
                      </div>
                      <button
                        type="button"
                        class="shrink-0 w-11 h-8 rounded-r-[5px] border border-l-0 border-border-weak-base flex items-center justify-center text-text-base hover:text-text-strong"
                        aria-label={language.t("p1.template.folder")}
                        onClick={() => setState("picking", (open) => !open)}
                      >
                        <span class="text-16-medium leading-none">…</span>
                      </button>
                      <Show when={state.picking}>
                        <Folders
                          test={props.test}
                          onPick={(node) => setState({ folder: { id: node.id, name: node.name }, picking: false })}
                          onClose={() => setState("picking", false)}
                        />
                      </Show>
                    </div>
                  </div>
                  <Show
                    when={rows()}
                    fallback={
                      <div class="grid grid-cols-2">
                        <For each={(page()?.fields ?? []).filter(shown)}>
                          {(field) => (
                            <div classList={{ "col-span-2": field.id === fields.title || rich(field) }}>
                              <Item field={field} bare={field.type === 18} />
                            </div>
                          )}
                        </For>
                      </div>
                    }
                  >
                    {(list) => (
                      <For each={list()}>
                        {(row) => (
                          <div class="flex">
                            <For each={row.columns}>
                              {(column) => (
                                <div
                                  class="shrink-0 grid items-start"
                                  style={{
                                    width: `${column.width}px`,
                                    "margin-left": `${column.left}px`,
                                    "margin-top": `${column.top}px`,
                                  }}
                                >
                                  <For each={column.items}>
                                    {(item) => (
                                      <div
                                        class="col-start-1 self-start"
                                        style={{
                                          "grid-row": String(item.line + 1),
                                          width: `${item.width}px`,
                                          "margin-left": `${item.left}px`,
                                          "margin-top": `${item.top}px`,
                                        }}
                                      >
                                        <Item
                                          field={item.field}
                                          label={item.label}
                                          split={item.split}
                                          bare={item.bare}
                                        />
                                      </div>
                                    )}
                                  </For>
                                </div>
                              )}
                            </For>
                          </div>
                        )}
                      </For>
                    )}
                  </Show>
                </div>
              </Show>
            </div>
          </Show>
        </Frame>
      </div>
    </Portal>
  )
}

/** The Template Folder picker: the test library's tree in a framed popup under the field. */
function Folders(props: {
  test: { project: number; space: number; name: string }
  onPick: (node: Node) => void
  onClose: () => void
}) {
  const p1 = useP1()
  const language = useLanguage()
  const top = root(props.test)
  const [state, setState] = createStore({
    kids: {} as Record<number, Node[]>,
    open: { [top.id]: true } as Record<number, boolean>,
  })
  const expand = async (node: Node) => {
    const found = await folders(
      p1.server(),
      p1.token(),
      "test",
      props.test.project,
      node,
      node.id === top.id,
      "",
      language.locale(),
    ).catch(() => [] as Node[])
    setState("kids", node.id, found)
  }
  onMount(() => void expand(top))
  // `path` holds the folders above, so a folder listed under itself is never drawn again.
  const Tree = (box: { node: Node; depth: number; path: number[] }) => (
    <>
      <div
        class="h-8 flex items-center gap-1.5 pr-2 rounded-md cursor-pointer text-text-base hover:bg-surface-base-hover"
        style={{ "padding-left": `${4 + box.depth * 16}px` }}
        onClick={() => props.onPick(box.node)}
      >
        <button
          type="button"
          class="size-4 shrink-0 flex items-center justify-center text-icon-base"
          classList={{ invisible: !box.node.more && !state.kids[box.node.id]?.length }}
          onClick={(event) => {
            event.stopPropagation()
            const next = !state.open[box.node.id]
            setState("open", box.node.id, next)
            if (next && !state.kids[box.node.id]) void expand(box.node)
          }}
        >
          <Fold open={!!state.open[box.node.id]} />
        </button>
        <FolderType type={box.node.type} closed={box.node.closed} />
        <span class="min-w-0 truncate text-13-regular">{box.node.name}</span>
      </div>
      <Show when={state.open[box.node.id]}>
        <For each={state.kids[box.node.id]?.filter((child) => !box.path.includes(child.id))}>
          {(child) => <Tree node={child} depth={box.depth + 1} path={[...box.path, box.node.id]} />}
        </For>
      </Show>
    </>
  )
  return (
    <>
      <div class="fixed inset-0 z-20" onClick={props.onClose} />
      <div
        class="absolute right-2.5 top-full mt-1 z-30 w-80 max-h-80 overflow-auto p-1.5 rounded-lg border border-border-strong-base bg-surface-raised-stronger-non-alpha"
        style={{ "box-shadow": "0 12px 32px rgb(0 0 0 / 0.35)" }}
      >
        <Tree node={top} depth={0} path={[]} />
      </div>
    </>
  )
}
