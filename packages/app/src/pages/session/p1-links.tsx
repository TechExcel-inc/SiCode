import { ErrorBoundary, For, Show, lazy, onMount, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore, produce } from "solid-js/store"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useLanguage } from "@/context/language"
import type { Space } from "@/p1/api"
import { specIcon } from "@/p1/files"
import { home, type Kind } from "@/p1/links"
import { links, relate, runs, type Link, type Note, type Relation, type Run, type Test } from "@/p1/pages"
import { useP1 } from "@/p1/settings"
import { BookIcon, LinkIcon, RunIcon, SpecIcon, TestIcon } from "./p1-icons"
import { P1Pick, type Change } from "./p1-pick"
import { layer } from "./p1-pop"
import { P1Template } from "./p1-template"

type Links = { specs: Link[]; knowledge: Note[]; tests: Test[] }

// The spec editor for a linked requirement's Edit, loaded when first used: it shows this tab itself.
const P1Item = lazy(() => import("./p1-item").then((found) => ({ default: found.P1Item })))

// What each spec's All Links showed last, so coming back to the tab shows it at once while it refreshes quietly.
const kept = new Map<string, { links: Links; runs: Record<number, Run[]> }>()

const key = (item: { project: number; id: number }) => `${item.project}:${item.id}`

/**
 * P1's All Links for a spec: the spec itself on top with P1's New & Link menu, then its linked requirements (parents
 * and children first), its linked test cases with the test runs under each, and its linked knowledge. Links change
 * in place, without reloading the tab.
 */
export function P1Links(props: {
  project: number
  id: number
  space?: Space
  head?: { title: string; state: string; kind: number }
  /** Called once links change, so the list can update its link checks' flags. */
  onChanged?: () => void
}) {
  const p1 = useP1()
  const language = useLanguage()
  const id = () => `${p1.server()}|${props.project}|${props.id}`
  const found = kept.get(id())
  const [state, setState] = createStore({
    links: found?.links as Links | undefined,
    runs: found?.runs ?? ({} as Record<number, Run[]>),
    err: "",
    menu: false,
    pick: undefined as Kind | undefined,
    make: false,
    // The row whose actions menu is open, whether Delete Link was asked once, and the link being changed.
    act: undefined as { id: string; x: number; y: number; edit?: () => void; drop: () => void } | undefined,
    sure: false,
    busy: "",
    // A linked requirement opened from its Edit action.
    edit: undefined as { project: number; id: number } | undefined,
    shut: {} as Record<number, boolean>,
  })
  const message = (err: unknown) => (err instanceof Error ? err.message : String(err))
  const keep = () => state.links && kept.set(id(), { links: state.links, runs: state.runs })

  // Reads the links and the test runs in the background; what's shown stays until they arrive.
  const refresh = async () => {
    const args = [p1.server(), p1.token(), props.project, props.id, language.locale()] as const
    const [next, more] = await Promise.all([
      links(...args).catch((err: unknown) => {
        if (!state.links) setState("err", message(err))
        return undefined
      }),
      runs(...args).catch(() => undefined),
    ])
    if (next) setState("links", next)
    if (more) setState("runs", more)
    keep()
  }

  onMount(() => void refresh())

  const order = { parent: 0, child: 1, related: 2 }
  const self = { project: props.project, id: props.id }

  // Removes one link at once on screen, then in P1; a failure puts it back.
  const unlink = async (item: { project: number; id: number }, kind: Relation | "test" | "knowledge", ref = 0) => {
    const before = state.links
    setState({ busy: `${kind}-${key(item)}`, err: "" })
    const drop = <T extends { project: number; id: number }>(list: T[]) =>
      list.filter((link) => key(link) !== key(item))
    setState(
      "links",
      produce((links) => {
        if (!links) return
        if (kind === "test") links.tests = drop(links.tests)
        else if (kind === "knowledge") links.knowledge = drop(links.knowledge)
        else links.specs = drop(links.specs)
      }),
    )
    const ok = await relate(p1.server(), p1.token(), language.locale(), {
      ...self,
      other: item,
      kind,
      add: false,
      ref,
    })
      .then(() => true)
      .catch((err: unknown) => {
        setState({ err: message(err), links: before })
        return false
      })
    setState("busy", "")
    if (ok) {
      keep()
      void refresh()
      props.onChanged?.()
    }
  }

  // Applies a picker's choices: unlinks first, then links, and shows the result before P1's list comes back.
  const apply = async (kind: Kind, changes: Change[]) => {
    for (const change of changes) {
      const other = { project: change.item.project, id: change.item.id }
      const was = kind === "spec" ? state.links?.specs.find((link) => key(link) === key(other)) : undefined
      if (change.from)
        await relate(p1.server(), p1.token(), language.locale(), {
          ...self,
          other,
          kind: kind === "spec" ? change.from : kind,
          add: false,
          ref: was?.ref,
        })
      if (change.to)
        await relate(p1.server(), p1.token(), language.locale(), {
          ...self,
          other,
          kind: kind === "spec" ? change.to : kind,
          add: true,
        })
    }
    setState(
      "links",
      produce((links) => {
        if (!links) return
        const gone = new Set(changes.map((change) => key(change.item)))
        const added = changes.filter((change) => change.to)
        if (kind === "spec")
          links.specs = [
            ...links.specs.filter((link) => !gone.has(key(link))),
            ...added.map((change) => ({
              id: change.item.id,
              project: change.item.project,
              title: change.item.title,
              state: change.item.state,
              owner: change.item.owner,
              kind: 1,
              icon: change.item.icon,
              relation: change.to!,
              ref: change.to === "parent" ? 3 : change.to === "child" ? 4 : 0,
            })),
          ]
        const rest = added.map((change) => ({
          id: change.item.id,
          project: change.item.project,
          title: change.item.title,
          state: change.item.state,
          owner: change.item.owner,
        }))
        if (kind === "test") links.tests = [...links.tests.filter((link) => !gone.has(key(link))), ...rest]
        if (kind === "knowledge") links.knowledge = [...links.knowledge.filter((link) => !gone.has(key(link))), ...rest]
      }),
    )
    keep()
    void refresh()
    props.onChanged?.()
  }

  const linked = (kind: Kind) =>
    Object.fromEntries(
      kind === "spec"
        ? (state.links?.specs ?? []).map((link) => [key(link), link.relation])
        : ((kind === "test" ? state.links?.tests : state.links?.knowledge) ?? []).map((link) => [key(link), "related"]),
    ) as Record<string, Relation>

  const Section = (box: { title: string; count: number; empty: string; children: JSX.Element }) => (
    <section class="flex flex-col gap-2">
      <div class="h-8 flex items-center gap-2">
        <h3 class="text-14-medium text-text-strong">{box.title}</h3>
        <span class="px-1.5 min-w-5 h-5 inline-flex items-center justify-center rounded-full bg-surface-base text-12-medium text-text-weak tabular-nums">
          {box.count}
        </span>
      </div>
      <div class="rounded-lg border border-border-weaker-base divide-y divide-border-weaker-base">
        <Show when={box.count} fallback={<p class="px-3 py-3 text-13-regular text-text-weak">{box.empty}</p>}>
          {box.children}
        </Show>
      </div>
    </section>
  )

  // A row's actions: a menu button that shows when the row is hovered, as P1's lists do, with Edit and Delete Link.
  const Actions = (box: { id: string; onEdit?: () => void; onDrop: () => void }) => (
    <button
      type="button"
      aria-label={language.t("p1.page.links.actions")}
      class="shrink-0 size-6 flex items-center justify-center rounded text-text-weak hover:text-text-strong hover:bg-surface-base-active focus-visible:opacity-100 group-hover/row:opacity-100"
      classList={{ "opacity-0": state.act?.id !== box.id && state.busy !== box.id }}
      onClick={(event) => {
        const at = event.currentTarget.getBoundingClientRect()
        setState({ act: { id: box.id, x: at.right, y: at.bottom, edit: box.onEdit, drop: box.onDrop }, sure: false })
      }}
    >
      <Show when={state.busy === box.id} fallback={<Lines />}>
        <Spinner class="size-3.5" />
      </Show>
    </button>
  )

  // The actions menu, framed under its button; Delete Link asks once more before it removes the link.
  const Act = (box: { act: NonNullable<typeof state.act> }) => {
    const at = layer()
    return (
      <Portal>
        <div class="fixed inset-0" style={{ "z-index": at.z }} onClick={() => setState("act", undefined)} />
        <div
          class="fixed w-48 py-1.5 rounded-xl border border-border-strong-base bg-surface-raised-stronger-non-alpha"
          style={{
            "z-index": at.z + 1,
            left: `${box.act.x - 192}px`,
            top: `${box.act.y + 4}px`,
            "box-shadow": "0 12px 32px rgb(0 0 0 / 0.35)",
          }}
        >
          <button
            type="button"
            disabled={!box.act.edit}
            class="w-full h-8 px-4 flex items-center justify-between gap-3 text-left text-14-regular text-text-strong hover:bg-surface-base-hover disabled:text-text-weaker disabled:hover:bg-transparent"
            onClick={() => {
              // Taken before the menu closes, which ends this menu and its act.
              const edit = box.act.edit
              setState("act", undefined)
              edit?.()
            }}
          >
            {language.t("p1.page.links.edit")}
            <Show when={!box.act.edit}>
              <span class="text-11-regular text-text-weaker">{language.t("p1.tab.soon")}</span>
            </Show>
          </button>
          <button
            type="button"
            class="w-full h-8 px-4 flex items-center text-left text-14-regular text-text-strong hover:bg-surface-base-hover"
            onClick={() => {
              if (!state.sure) return setState("sure", true)
              const drop = box.act.drop
              setState("act", undefined)
              drop()
            }}
          >
            {language.t(state.sure ? "p1.page.links.sure" : "p1.page.links.unlink")}
          </button>
        </div>
      </Portal>
    )
  }

  const Row = (box: {
    lead?: JSX.Element
    icon: JSX.Element
    id: number
    title: string
    tag?: string
    state: string
    owner?: string
    /** Plain text in the owner's column, such as a test run's environment. */
    note?: string
    end?: JSX.Element
    class?: string
  }) => (
    <div
      class={`group/row @container px-3 py-2 flex items-center gap-2.5 hover:bg-surface-base-hover ${box.class ?? ""}`}
    >
      {box.lead}
      {box.icon}
      <span class="shrink-0 text-12-regular text-text-weak tabular-nums">{box.id}</span>
      <span class="flex-1 min-w-0 truncate text-13-regular text-text-strong">{box.title}</span>
      <Show when={box.tag}>
        <span class="shrink-0 px-1.5 rounded border border-border-weaker-base text-11-regular text-text-weak">
          {box.tag}
        </span>
      </Show>
      <span class="shrink-0 w-24 flex">
        <Show when={box.state}>
          <span class="max-w-full truncate px-2 py-0.5 rounded-full bg-surface-base text-12-medium text-text-base">
            {box.state}
          </span>
        </Show>
      </span>
      <span class="hidden @md:flex shrink-0 w-32 items-center gap-1.5 text-12-regular text-text-weak">
        <Show when={box.note}>
          <span class="truncate">{box.note}</span>
        </Show>
        <Show when={box.owner}>
          <span class="size-5 shrink-0 rounded-full bg-surface-base flex items-center justify-center text-11-medium text-text-base">
            {box.owner!.trim().charAt(0).toUpperCase()}
          </span>
          <span class="truncate">{box.owner}</span>
        </Show>
      </span>
      <span class="shrink-0 min-w-6 flex justify-end">{box.end}</span>
    </div>
  )

  // P1's New & Link menu, framed under its button.
  const Menu = () => {
    const at = layer()
    const test = () => home(props.space, "test")
    const options = () =>
      [
        { key: "addspec", on: true, run: () => setState("pick", "spec") },
        { key: "newtest", on: !!test(), run: () => setState("make", true) },
        { key: "addtest", on: !!test(), run: () => setState("pick", "test") },
        { key: "addnote", on: !!home(props.space, "knowledge"), run: () => setState("pick", "knowledge") },
      ] as const
    return (
      <>
        <div class="fixed inset-0" style={{ "z-index": at.z }} onClick={() => setState("menu", false)} />
        <div
          class="absolute right-0 top-full mt-1.5 w-56 py-1.5 rounded-xl border border-border-strong-base bg-surface-raised-stronger-non-alpha"
          style={{ "z-index": at.z + 1, "box-shadow": "0 12px 32px rgb(0 0 0 / 0.35)" }}
        >
          <For each={options()}>
            {(option) => (
              <button
                type="button"
                disabled={!option.on}
                class="w-full h-8 px-4 flex items-center text-left text-14-regular text-text-strong hover:bg-surface-base-hover disabled:text-text-weaker disabled:hover:bg-transparent"
                onClick={() => {
                  setState("menu", false)
                  option.run()
                }}
              >
                {language.t(`p1.page.links.${option.key}`)}
              </button>
            )}
          </For>
        </div>
      </>
    )
  }

  return (
    <div class="relative p-5 flex flex-col gap-5">
      {/* New & Link sits beside the first section's title, so the links start at the top. */}
      <div class="absolute right-5 top-5 z-[1]">
        <button
          type="button"
          class="h-8 px-2.5 flex items-center gap-1.5 rounded-md text-[#00AAFF] hover:bg-surface-base-hover"
          onClick={() => setState("menu", (open) => !open)}
        >
          <LinkIcon />
          <span class="text-13-medium">{language.t("p1.page.links.menu")}</span>
        </button>
        <Show when={state.menu}>
          <Menu />
        </Show>
      </div>
      <Show when={state.err}>
        <p class="min-h-8 pr-36 flex items-center text-13-regular text-text-diff-delete-base">{state.err}</p>
      </Show>
      <Show
        when={state.links}
        fallback={
          <div class="h-8 flex items-center">
            <Spinner class="size-4" />
          </div>
        }
      >
        {(data) => (
          <>
            <Show when={!data().specs.length && !data().tests.length && !data().knowledge.length}>
              <p class="h-8 flex items-center text-13-regular text-text-weak">{language.t("p1.page.links.none")}</p>
            </Show>
            <Show when={data().specs.length}>
              <Section
                title={language.t("p1.page.links.specs")}
                count={data().specs.length}
                empty={language.t("p1.page.links.nospecs")}
              >
                <For each={data().specs.toSorted((a, b) => order[a.relation] - order[b.relation])}>
                  {(item) => (
                    <Row
                      icon={
                        <SpecIcon
                          name={
                            item.icon ?? specIcon({ kind: item.kind, closed: false, shortcut: false, attached: false })
                          }
                        />
                      }
                      id={item.id}
                      title={item.title}
                      tag={item.relation === "related" ? undefined : language.t(`p1.page.links.${item.relation}`)}
                      state={item.state}
                      owner={item.owner}
                      end={
                        <Actions
                          id={`${item.relation}-${key(item)}`}
                          onEdit={() => setState("edit", { project: item.project, id: item.id })}
                          onDrop={() => void unlink(item, item.relation, item.ref)}
                        />
                      }
                    />
                  )}
                </For>
              </Section>
            </Show>
            <Show when={data().tests.length}>
              <Section
                title={language.t("p1.page.links.tests")}
                count={data().tests.length}
                empty={language.t("p1.page.links.notests")}
              >
                <For each={data().tests}>
                  {(item) => {
                    const list = () => state.runs[item.id] ?? []
                    const open = () => !state.shut[item.id]
                    return (
                      <div>
                        <Row
                          lead={
                            <button
                              type="button"
                              aria-label={language.t("p1.page.links.runs")}
                              disabled={!list().length}
                              class="shrink-0 size-4 flex items-center justify-center text-text-weaker hover:text-text-strong disabled:invisible"
                              onClick={() => setState("shut", item.id, open())}
                            >
                              <Caret open={open()} />
                            </button>
                          }
                          icon={<TestIcon />}
                          id={item.id}
                          title={item.title}
                          state={item.state}
                          owner={item.owner}
                          end={<Actions id={`test-${key(item)}`} onDrop={() => void unlink(item, "test")} />}
                        />
                        <Show when={open() && list().length}>
                          <div class="ml-[37px] mb-1.5 border-l border-border-weaker-base">
                            <For each={list()}>
                              {(run) => (
                                <Row
                                  class="py-1.5"
                                  icon={<RunIcon closed={run.closed} />}
                                  id={run.id}
                                  title={run.title}
                                  state={run.state}
                                  note={run.env}
                                />
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    )
                  }}
                </For>
              </Section>
            </Show>
            <Show when={data().knowledge.length}>
              <Section title={language.t("p1.page.links.notes")} count={data().knowledge.length} empty="">
                <For each={data().knowledge}>
                  {(item) => (
                    <Row
                      icon={<BookIcon />}
                      id={item.id}
                      title={item.title}
                      state={item.state}
                      owner={item.owner}
                      end={<Actions id={`knowledge-${key(item)}`} onDrop={() => void unlink(item, "knowledge")} />}
                    />
                  )}
                </For>
              </Section>
            </Show>
          </>
        )}
      </Show>
      <Show when={state.act}>{(act) => <Act act={act()} />}</Show>
      <Show when={state.edit}>
        {(edit) => (
          <Portal>
            <P1Item
              project={edit().project}
              folder={0}
              id={edit().id}
              space={props.space}
              onClose={() => setState("edit", undefined)}
              onSaved={() => void refresh()}
            />
          </Portal>
        )}
      </Show>
      {/* A dialog that fails closes with its error here instead of taking the app down. */}
      <ErrorBoundary
        fallback={(err) => {
          queueMicrotask(() => setState({ pick: undefined, make: false, err: message(err) }))
          return null
        }}
      >
        <Show when={state.pick && home(props.space, state.pick)}>
          {(at) => (
            <P1Pick
              kind={state.pick!}
              at={at()}
              self={self}
              linked={linked(state.pick!)}
              onSubmit={(changes) => apply(state.pick!, changes)}
              onClose={() => setState("pick", undefined)}
            />
          )}
        </Show>
        <Show when={state.make && home(props.space, "test")}>
          {(test) => (
            <P1Template
              test={test()}
              spec={{ ...self, title: props.head?.title ?? "" }}
              onCreated={(item) => {
                setState("links", "tests", (list) => [...list, item])
                keep()
                void refresh()
                props.onChanged?.()
              }}
              onClose={() => setState("make", false)}
            />
          )}
        </Show>
      </ErrorBoundary>
    </div>
  )
}

function Lines() {
  return (
    <svg class="size-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 4.5H13M3 8H13M3 11.5H13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  )
}

function Caret(props: { open: boolean }) {
  return (
    <svg
      class="size-3 transition-transform"
      classList={{ "-rotate-90": !props.open }}
      viewBox="0 0 12 12"
      aria-hidden="true"
    >
      <path d="M2.5 4.25L6 8L9.5 4.25Z" fill="currentColor" />
    </svg>
  )
}
