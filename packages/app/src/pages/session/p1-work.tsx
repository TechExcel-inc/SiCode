import { For, Show, createEffect, createMemo, on, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { HELP_URL } from "@/components/about-popover"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import {
  children,
  denied,
  item,
  login,
  memory,
  remember,
  origin,
  pin,
  pins,
  projects,
  requirements,
  root,
  space,
  type Folder,
  type Pins,
  type Project,
  type Row,
  type Space,
} from "@/p1/api"
import { doc, file, prose } from "@/p1/doc"
import { useP1 } from "@/p1/settings"
import { setDesign } from "./design-state"
import { P1Item } from "./p1-item"
import { P1Folder } from "./p1-folder"
import { access, type Place } from "@/p1/folder"
import { warm } from "@/p1/form"

const field =
  "h-9 w-full px-3 rounded-lg bg-surface-base border border-border-weaker-base text-13-regular text-text-strong placeholder:text-text-weak outline-none focus:border-border-interactive-base"

const tabs = ["requirements", "development", "test", "defects"] as const

export function P1Work() {
  const p1 = useP1()
  const sdk = useSDK()
  const layout = useLayout()
  const language = useLanguage()
  const [state, setState] = createStore({
    server: "",
    user: "",
    pass: "",
    err: "",
    busy: false,
    edit: false,
    loading: false,
    projects: [] as Project[],
    // The folder tree: each folder by id, its loaded subfolders, which are open, and the top of the tree.
    folders: {} as Record<number, Folder>,
    kids: {} as Record<number, number[]>,
    open: {} as Record<number, boolean>,
    top: [] as number[],
    rows: [] as Row[],
    total: 0,
    space: undefined as Space | undefined,
    about: false,
    // The requirement dialog: an id to edit, 0 for a new one in the selected folder.
    item: undefined as number | undefined,
    // Each loaded folder's parent, for refreshing the right branch after a folder changes.
    parents: {} as Record<number, number>,
    // The folder dialog (a place means a new folder there) and the folder menu with your access level.
    dir: undefined as { id: number; place?: Place } | undefined,
    menu: undefined as { id: number; x: number; y: number; level: number } | undefined,
    project: 0,
    folder: 0,
    root: 0,
    query: "",
    opening: 0,
    // The project picker: open, which base family it shows, its search, and each family's pinned spaces.
    picker: false,
    family: 0,
    find: "",
    pins: {} as Record<number, Pins>,
  })
  let stamp = 0
  let wave = 0
  let timer: number | undefined
  let saving: number | undefined

  const message = (err: unknown) => (err instanceof Error ? err.message : String(err))
  const fail = (err: unknown) => {
    if (denied(err)) p1.clear()
    setState({ err: message(err), loading: false, busy: false, opening: 0 })
  }
  const chosen = () => state.projects.find((item) => item.id === state.project)
  const families = createMemo(() => {
    const seen = new Map<number, string>()
    for (const item of state.projects) if (!seen.has(item.base)) seen.set(item.base, item.group ?? "")
    return [...seen].map(([id, name]) => ({ id, name }))
  })
  const pinned = (item: Project) => !!state.pins[item.base]?.ids.includes(item.id)
  // Search looks through every family, so a project is found without knowing its family first.
  const listed = createMemo(() => {
    const query = state.find.trim().toLowerCase()
    if (!query) return state.projects.filter((item) => item.base === state.family)
    return state.projects.filter((item) => item.name.toLowerCase().includes(query))
  })
  const folder = () => state.folders[state.folder]
  const initials = () =>
    p1
      .name()
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => [...part][0])
      .slice(0, 2)
      .join("")
      .toUpperCase()
  const columns = createMemo(() => {
    const groups = new Map<string, Row[]>()
    for (const row of state.rows) groups.set(row.status, [...(groups.get(row.status) ?? []), row])
    return [...groups].map(([status, rows]) => ({ status, rows }))
  })

  const sign = async () => {
    const user = state.user.trim()
    const host = origin(state.server || p1.server())
    if (!host || !user || !state.pass) {
      setState("err", language.t("p1.login.missing"))
      return
    }
    setState({ busy: true, err: "" })
    const session = await login(host, user, state.pass).catch((err: unknown) => {
      fail(err)
    })
    setState("pass", "")
    if (!session) return
    p1.save({ server: session.server, token: session.token, user: session.user, name: session.name })
    setState({ busy: false, edit: false, server: "" })
  }

  const load = async () => {
    const host = p1.server()
    const token = p1.token()
    if (!host || !token) return
    const mark = ++stamp
    setState({ loading: true, err: "" })
    const list = await projects(host, token, language.locale()).catch((err: unknown) => {
      if (mark === stamp) fail(err)
    })
    if (mark !== stamp || !list) return
    setState("projects", list)
    const next = list.find((item) => item.id === p1.project()) ?? list[0]
    if (!next) {
      setState({ loading: false, folders: {}, kids: {}, top: [], rows: [], project: 0, folder: 0 })
      return
    }
    await pick(next.id, mark)
  }

  const pick = async (id: number, mark = ++stamp) => {
    const host = p1.server()
    const token = p1.token()
    const project = state.projects.find((item) => item.id === id)
    if (!host || !token || !project) return
    p1.choose(id)
    // A save still waiting belongs to the project being left.
    if (saving !== undefined) window.clearTimeout(saving)
    setState({ project: id, loading: true, err: "", query: "", picker: false })
    const found = await space(host, token, project, language.locale()).catch((err: unknown) => {
      if (mark === stamp) fail(err)
    })
    if (mark !== stamp) return
    if (!found) {
      setState({ loading: false, folders: {}, kids: {}, open: {}, top: [], rows: [], total: 0, folder: 0, root: 0, space: undefined })
      return
    }
    const tree = await root(host, token, found, language.locale()).catch((err: unknown) => {
      if (mark === stamp) fail(err)
    })
    if (mark !== stamp || !tree) return
    const first = tree[0]
    setState({
      folders: Object.fromEntries(tree.map((item) => [item.id, item])),
      kids: {},
      open: {},
      top: tree.map((item) => item.id),
      root: found.project,
      space: found,
    })
    if (!first) {
      setState({ loading: false, rows: [], total: 0, folder: 0 })
      return
    }
    // Reopen the tree as P1 last left it: the open folders, parents before children, then the selected one.
    const saved = await memory(host, token, p1.user(), found, language.locale()).catch(() => ({
      folder: 0,
      open: [first.id],
    }))
    if (mark !== stamp) return
    const wanted = saved.open.length ? saved.open : [first.id]
    const pending = new Set(wanted)
    while (pending.size) {
      const ready = [...pending].filter((id) => state.folders[id])
      if (!ready.length) break
      for (const id of ready) {
        pending.delete(id)
        setState("open", id, true)
        await branch(id)
        if (mark !== stamp) return
      }
    }
    const folder = state.folders[saved.folder] ? saved.folder : first.id
    reveal(folder)
    await fill(found.project, folder, "", mark)
  }

  // Scrolls the tree so a folder shows, once it's drawn: the one P1 last had selected may be far down.
  const reveal = (id: number) =>
    requestAnimationFrame(() =>
      document.querySelector(`[data-folder="${id}"]`)?.scrollIntoView({ block: "center" }),
    )

  // Saves the selected and open folders to P1 a moment after they change.
  const save = () => {
    if (saving !== undefined) window.clearTimeout(saving)
    saving = window.setTimeout(() => {
      const host = p1.server()
      const found = state.space
      if (!host || !found || !state.folder) return
      const open = Object.entries(state.open)
        .filter(([, value]) => value)
        .map(([id]) => Number(id))
      void remember(host, p1.token(), p1.user(), found, { folder: state.folder, open }, language.locale()).catch(
        () => undefined,
      )
    }, 400)
  }

  // Reads a folder's subfolders again after one was added or renamed in it.
  const refresh = async (id: number) => {
    setState("kids", id, undefined!)
    setState("folders", id, "count", (count) => Math.max(count, 1))
    setState("open", id, true)
    await branch(id)
  }

  const changed = async (id: number, name: string) => {
    const dir = state.dir
    if (!dir) return
    if (dir.place === undefined) {
      setState("folders", id, "name", name)
      return
    }
    const parent = dir.place === 0 ? dir.id : state.parents[dir.id]
    if (parent) await refresh(parent)
    if (!state.folders[id] || !state.root) return
    reveal(id)
    await fill(state.root, id, "")
    save()
  }

  const menu = (event: MouseEvent, id: number) => {
    event.preventDefault()
    const host = p1.server()
    if (!host || !state.root) return
    setState("menu", { id, x: event.clientX, y: event.clientY, level: -1 })
    void access(host, p1.token(), state.root, id, language.locale())
      .then((level) => {
        if (state.menu?.id === id) setState("menu", "level", level)
      })
      .catch(() => {
        if (state.menu?.id === id) setState("menu", "level", 0)
      })
  }

  // Opens or closes a folder, loading its subfolders the first time.
  const expand = async (id: number) => {
    const open = !state.open[id]
    setState("open", id, open)
    save()
    if (open) await branch(id)
  }

  const branch = async (id: number) => {
    const host = p1.server()
    if (state.kids[id] || !state.folders[id]?.count || !host) return
    const mark = stamp
    const list = await children(host, p1.token(), state.root, id, language.locale()).catch((err: unknown) => {
      if (mark === stamp) fail(err)
    })
    if (mark !== stamp || !list) return
    setState("folders", (prev) => ({ ...prev, ...Object.fromEntries(list.map((item) => [item.id, item])) }))
    setState("kids", id, list.map((item) => item.id))
    setState("parents", (prev) => ({ ...prev, ...Object.fromEntries(list.map((item) => [item.id, id])) }))
    // P1's count includes closed folders, which aren't listed; use what came back, as the web tree does.
    setState("folders", id, "count", list.length)
  }

  const fill = async (root: number, folder: number, query: string, mark = stamp) => {
    const host = p1.server()
    const token = p1.token()
    if (!host || !token) return
    const mine = ++wave
    setState({ loading: true, folder, query, root })
    const list = await requirements(host, token, root, folder, query, language.locale()).catch((err: unknown) => {
      if (mark === stamp && mine === wave) fail(err)
    })
    if (mark !== stamp || mine !== wave || !list) return
    setState({ rows: list.rows, total: list.total, loading: false, err: "" })
    // Get the requirement dialogs ready for this project and folder while the list is read.
    warm(host, token, root, folder, list.rows[0]?.id ?? 0, p1.user(), language.locale())
  }

  const search = (value: string) => {
    setState("query", value)
    if (timer !== undefined) window.clearTimeout(timer)
    const folder = state.folder
    if (!state.root || !folder) return
    timer = window.setTimeout(() => void fill(state.root, folder, value.trim()), 250)
  }

  // Pins are kept per family; all are read so search results across families show theirs too.
  const browse = (family: number) => {
    setState({ family, find: "" })
    const host = p1.server()
    if (!host) return
    for (const item of families()) {
      if (state.pins[item.id]) continue
      setState("pins", item.id, { ids: [], value: 0, text: 1 })
      void pins(host, p1.token(), p1.user(), item.id, language.locale())
        .then((found) => setState("pins", item.id, found))
        .catch(() => undefined)
    }
  }

  const toggle = async (item: Project) => {
    const host = p1.server()
    const prev = state.pins[item.base] ?? { ids: [], value: 0, text: 1 }
    const next = {
      ...prev,
      ids: prev.ids.includes(item.id) ? prev.ids.filter((id) => id !== item.id) : [...prev.ids, item.id],
    }
    if (!host) return
    setState("pins", item.base, next)
    await pin(host, p1.token(), p1.user(), item.base, next, language.locale()).catch((err: unknown) => {
      setState("pins", item.base, prev)
      fail(err)
    })
  }

  const open = async (row: Row) => {
    const host = p1.server()
    const root = state.root
    if (!host || !root) return
    setState({ opening: row.id, err: "" })
    const found = await item(host, p1.token(), root, row.id, language.locale()).catch((err: unknown) => {
      fail(err)
    })
    if (!found) return
    const path = file(root, row.id)
    const content = doc(
      { server: host, project: root, id: row.id, title: found.title || row.title, pulled: Date.now() },
      prose(found.title || row.title, found.html),
    )
    const written = await sdk.client.file
      .write({ path, content })
      .then(() => true)
      .catch((err: unknown) => {
        fail(err)
        return false
      })
    setState("opening", 0)
    if (!written) return
    setDesign("pending", path)
    layout.nav.set("design")
  }

  createEffect(
    on(
      () => p1.token(),
      (token) => {
        if (!token) {
          stamp++
          setState({
            projects: [],
            folders: {},
            kids: {},
            open: {},
            top: [],
            rows: [],
            project: 0,
            folder: 0,
            loading: false,
            pins: {},
          })
          return
        }
        void load()
      },
    ),
  )

  const close = (event: KeyboardEvent) => {
    if (event.key === "Escape") setState({ picker: false, about: false })
  }
  window.addEventListener("keydown", close)
  onCleanup(() => window.removeEventListener("keydown", close))

  const entry = (item: Project) => (
    <div
      class="group flex items-center gap-2.5 px-2.5 py-2 rounded-lg"
      classList={{
        "bg-surface-base-active": item.id === state.project,
        "hover:bg-surface-base-hover": item.id !== state.project,
      }}
    >
      <button
        type="button"
        data-action="p1-project"
        class="flex-1 min-w-0 flex items-center gap-2.5 text-left"
        onClick={() => void pick(item.id)}
      >
        <span class="size-7 shrink-0 rounded-md bg-surface-base flex items-center justify-center text-text-weak">
          <Icon name="grid" size="small" />
        </span>
        <span class="min-w-0 flex flex-col">
          <span class="truncate text-13-regular text-text-strong">{item.name}</span>
          <Show when={state.find.trim() && item.group}>
            <span class="truncate text-11-regular text-text-weak">{item.group}</span>
          </Show>
        </span>
      </button>
      <button
        type="button"
        data-action="p1-pin"
        class="shrink-0 size-7 rounded-md flex items-center justify-center hover:bg-surface-base-hover"
        classList={{ "text-text-interactive-base": pinned(item), "text-text-weaker": !pinned(item) }}
        aria-pressed={pinned(item)}
        aria-label={language.t(pinned(item) ? "p1.unpin" : "p1.pin", { name: item.name })}
        title={language.t(pinned(item) ? "p1.unpin" : "p1.pin", { name: item.name })}
        onClick={() => void toggle(item)}
      >
        <Icon name="pin" size="small" />
      </button>
    </div>
  )

  const node = (id: number, depth: number): JSX.Element => (
    <Show when={state.folders[id]}>
      {(item) => (
        <>
          <div
            class="w-full flex items-center gap-1 pr-2.5 rounded-lg text-13-regular"
            style={{ "padding-left": `${4 + depth * 16}px` }}
            onContextMenu={(event) => menu(event, id)}
            data-folder={id}
            classList={{
              "bg-surface-base-active text-text-strong": id === state.folder,
              "text-text-base hover:bg-surface-base-hover": id !== state.folder,
            }}
          >
            <button
              type="button"
              data-action="p1-folder-toggle"
              class="size-6 shrink-0 flex items-center justify-center rounded text-text-weak"
              classList={{ invisible: !item().count }}
              aria-expanded={!!state.open[id]}
              aria-label={item().name}
              onClick={() => void expand(id)}
            >
              <Icon name={state.open[id] ? "chevron-down" : "chevron-right"} size="small" />
            </button>
            <button
              type="button"
              data-action="p1-folder"
              class="flex-1 min-w-0 flex items-center gap-2 py-2 text-left"
              onClick={() => {
                if (!state.root) return
                void fill(state.root, id, state.query.trim())
                save()
              }}
            >
              <Icon name="folder" size="small" class="shrink-0 text-text-weak" />
              <span class="truncate">{item().name}</span>
            </button>
          </div>
          <Show when={state.open[id]}>
            <For each={state.kids[id] ?? []}>{(kid) => node(kid, depth + 1)}</For>
          </Show>
        </>
      )}
    </Show>
  )

  return (
    <div data-component="p1-work" class="absolute inset-0 z-40 bg-background-base flex flex-col">
      <Show
        when={p1.ready() && p1.signed()}
        fallback={
          <div class="flex-1 flex items-center justify-center px-6">
            <div class="w-full max-w-sm flex flex-col gap-5">
              <div>
                <div class="text-16-medium text-text-strong">{language.t("rail.work")}</div>
                <p class="mt-1 text-13-regular text-text-weak">{language.t("p1.login.lead")}</p>
              </div>
              <Show
                when={p1.ready()}
                fallback={
                  <div class="flex items-center gap-2 text-13-regular text-text-weak">
                    <Spinner class="size-4" />
                    {language.t("p1.loading")}
                  </div>
                }
              >
                <form
                  class="flex flex-col gap-3"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void sign()
                  }}
                >
                  <Show when={state.edit || !p1.server()}>
                    <label class="flex flex-col gap-1.5">
                      <span class="text-12-regular text-text-weak">{language.t("p1.login.server")}</span>
                      <input
                        class={field}
                        name="server"
                        value={state.server || p1.server()}
                        placeholder="https://"
                        onInput={(event) => setState("server", event.currentTarget.value)}
                      />
                    </label>
                  </Show>
                  <Show when={!state.edit && p1.server()}>
                    <div class="flex items-center justify-between gap-2">
                      <span class="min-w-0 truncate text-12-regular text-text-weak">{p1.server()}</span>
                      <button
                        type="button"
                        class="shrink-0 text-12-regular text-text-base"
                        onClick={() => setState({ edit: true, server: p1.server() })}
                      >
                        {language.t("p1.login.change")}
                      </button>
                    </div>
                  </Show>
                  <label class="flex flex-col gap-1.5">
                    <span class="text-12-regular text-text-weak">{language.t("p1.login.user")}</span>
                    <input
                      class={field}
                      name="username"
                      autocomplete="username"
                      value={state.user}
                      onInput={(event) => setState("user", event.currentTarget.value)}
                    />
                  </label>
                  <label class="flex flex-col gap-1.5">
                    <span class="text-12-regular text-text-weak">{language.t("p1.login.password")}</span>
                    <input
                      class={field}
                      type="password"
                      name="password"
                      autocomplete="current-password"
                      value={state.pass}
                      onInput={(event) => setState("pass", event.currentTarget.value)}
                    />
                  </label>
                  <Button type="submit" size="large" variant="primary" disabled={state.busy} data-action="p1-login">
                    {language.t("p1.login.submit")}
                  </Button>
                </form>
              </Show>
              <Show when={state.err}>
                <p class="text-12-regular text-text-diff-delete-base">{state.err}</p>
              </Show>
            </div>
          </div>
        }
      >
        <header class="shrink-0 h-16 px-4 flex items-center gap-6 border-b border-border-weaker-base">
          <div class="relative shrink-0">
            <button
              type="button"
              data-action="p1-pick-project"
              class="flex items-center gap-3 pl-1 pr-2 py-1 rounded-lg hover:bg-surface-base-hover max-w-80"
              aria-expanded={state.picker}
              aria-label={language.t("p1.project.pick")}
              onClick={() => {
                if (state.picker) return setState("picker", false)
                setState("picker", true)
                browse(chosen()?.base ?? families()[0]?.id ?? 0)
              }}
            >
              <span class="size-9 shrink-0 rounded-lg bg-surface-interactive-base text-text-on-interactive-base flex items-center justify-center text-13-medium">
                P1
              </span>
              <span class="min-w-0 flex flex-col items-start">
                <span class="text-11-regular text-text-weak">{language.t("p1.project.label")}</span>
                <span class="max-w-60 truncate text-14-medium text-text-strong">
                  {chosen()?.name ?? language.t("p1.project.pick")}
                </span>
              </span>
              <Icon name="chevron-down" size="small" class="shrink-0 text-text-weak" />
            </button>
            <Show when={state.picker}>
              <div class="fixed inset-0 z-40" onClick={() => setState("picker", false)} />
              <div
                data-component="p1-project-picker"
                class="absolute left-0 top-full mt-2 z-50 w-[440px] max-h-[70vh] flex flex-col rounded-xl border border-border-weaker-base bg-background-base shadow-lg"
              >
                <div class="shrink-0 p-3 flex flex-col gap-2 border-b border-border-weaker-base">
                  <Show when={families().length > 1}>
                    <label class="flex items-center gap-2 min-w-0">
                      <span class="shrink-0 text-12-medium text-text-weak">{language.t("p1.family")}</span>
                      <select
                        class="min-w-0 flex-1 h-8 px-2 rounded-lg bg-surface-base border border-border-weaker-base text-13-regular text-text-strong outline-none"
                        value={state.family}
                        onChange={(event) => setState({ family: Number(event.currentTarget.value), find: "" })}
                      >
                        <For each={families()}>{(item) => <option value={item.id}>{item.name || item.id}</option>}</For>
                      </select>
                    </label>
                  </Show>
                  <input
                    ref={(el) => setTimeout(() => el.focus())}
                    class={field}
                    value={state.find}
                    placeholder={language.t("p1.search.project")}
                    onInput={(event) => setState("find", event.currentTarget.value)}
                  />
                </div>
                <div class="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-0.5">
                  <Show when={listed().length} fallback={<Hint text={language.t("p1.empty.projects")} />}>
                    <Show when={listed().some(pinned)}>
                      <div class="rounded-lg bg-surface-base/50 pb-1">
                        <div class="px-2.5 pt-2 pb-1 text-12-medium text-text-weak">{language.t("p1.pinned")}</div>
                        <For each={listed().filter(pinned)}>{entry}</For>
                      </div>
                    </Show>
                    <Show when={listed().some((item) => !pinned(item))}>
                      <div class="px-2.5 pt-3 pb-1 text-12-medium text-text-weak">{language.t("p1.others")}</div>
                      <For each={listed().filter((item) => !pinned(item))}>{entry}</For>
                    </Show>
                  </Show>
                </div>
              </div>
            </Show>
          </div>
          <nav class="flex items-center gap-1 min-w-0">
            <For each={tabs}>
              {(tab) => (
                <button
                  type="button"
                  data-action={`p1-tab-${tab}`}
                  class="h-9 px-3 rounded-lg text-14-medium"
                  classList={{
                    "bg-surface-base-active text-text-strong": tab === "requirements",
                    "text-text-weaker cursor-default": tab !== "requirements",
                  }}
                  disabled={tab !== "requirements"}
                  title={tab === "requirements" ? undefined : language.t("p1.tab.soon")}
                >
                  {language.t(`p1.tab.${tab}`)}
                </button>
              )}
            </For>
          </nav>
          <div class="flex-1" />
          <div class="relative shrink-0">
            <button
              type="button"
              data-action="p1-account"
              class="size-9 rounded-full bg-surface-interactive-base text-text-on-interactive-base flex items-center justify-center text-13-medium"
              aria-expanded={state.about}
              aria-label={p1.name()}
              title={p1.name()}
              onClick={() => setState("about", !state.about)}
            >
              {initials() || "P1"}
            </button>
            <Show when={state.about}>
              <div class="fixed inset-0 z-40" onClick={() => setState("about", false)} />
              <div class="absolute right-0 top-full mt-2 z-50 w-56 p-1 rounded-xl border border-border-weaker-base bg-background-base shadow-lg">
                <AboutItem onDone={() => setState("about", false)} />
              </div>
            </Show>
          </div>
        </header>
        <Show when={state.err}>
          <p class="shrink-0 px-4 py-2 text-12-regular text-text-diff-delete-base border-b border-border-weaker-base">
            {state.err}
          </p>
        </Show>
        <div class="flex-1 min-h-0 flex">
          <aside class="w-64 shrink-0 border-r border-border-weaker-base flex flex-col min-h-0">
            <div class="shrink-0 px-4 pt-4 pb-2 text-12-medium text-text-weak uppercase tracking-wide">
              {language.t("p1.folders")}
            </div>
            <div class="flex-1 min-h-0 overflow-y-auto px-2 pb-3 flex flex-col gap-0.5">
              <Show
                when={state.top.length}
                fallback={<Hint text={language.t(state.loading ? "p1.loading" : "p1.empty.folders")} />}
              >
                <For each={state.top}>{(id) => node(id, 0)}</For>
              </Show>
            </div>
          </aside>
          <section class="flex-1 min-w-0 flex flex-col min-h-0">
            <div class="shrink-0 px-5 py-4 flex items-center gap-4 border-b border-border-weaker-base">
              <div class="min-w-0">
                <div class="flex items-center gap-1.5 min-w-0">
                  <div class="truncate text-16-medium text-text-strong">{folder()?.name ?? language.t("p1.requirements")}</div>
                  <Show when={state.folder}>
                    <button
                      type="button"
                      data-action="p1-folder-edit"
                      class="shrink-0 size-7 rounded-md flex items-center justify-center text-text-weak hover:text-text-strong hover:bg-surface-base-hover"
                      aria-label={language.t("p1.folder.actions")}
                      title={language.t("p1.folder.actions")}
                      onClick={(event) => menu(event, state.folder)}
                    >
                      <Icon name="dot-grid" size="small" />
                    </button>
                  </Show>
                </div>
                <div class="text-12-regular text-text-weak">{language.t("p1.count", { count: state.total })}</div>
              </div>
              <div class="flex-1" />
              <input
                class={`${field} max-w-xs`}
                value={state.query}
                placeholder={language.t("p1.search.requirement")}
                onInput={(event) => search(event.currentTarget.value)}
              />
              <Button
                variant="primary"
                size="large"
                icon="plus-small"
                disabled={!state.folder || !state.root}
                onClick={() => setState("item", 0)}
                data-action="p1-new"
              >
                {language.t("p1.new")}
              </Button>
              <div class="shrink-0 flex items-center p-0.5 rounded-lg bg-surface-base">
                <For each={["list", "board"] as const}>
                  {(view) => (
                    <button
                      type="button"
                      data-action={`p1-view-${view}`}
                      class="h-8 px-3 rounded-md text-13-medium"
                      classList={{
                        "bg-background-base text-text-strong shadow-xs": p1.view() === view,
                        "text-text-weak hover:text-text-base": p1.view() !== view,
                      }}
                      aria-pressed={p1.view() === view}
                      onClick={() => p1.show(view)}
                    >
                      {language.t(`p1.view.${view}`)}
                    </button>
                  )}
                </For>
              </div>
            </div>
            <div class="flex-1 min-h-0 overflow-auto">
              <Show when={!state.loading} fallback={<Hint text={language.t("p1.loading")} />}>
                <Show when={state.folder} fallback={<Hint text={language.t("p1.empty.folders")} />}>
                  <Show when={state.rows.length} fallback={<Hint text={language.t("p1.empty.requirements")} />}>
                    <Show
                      when={p1.view() === "board"}
                      fallback={
                        <table class="w-full text-left border-collapse">
                          <thead class="sticky top-0 bg-background-base">
                            <tr class="text-12-medium text-text-weak border-b border-border-weaker-base">
                              <th class="w-28 px-5 py-2.5 font-medium">{language.t("p1.col.id")}</th>
                              <th class="px-3 py-2.5 font-medium">{language.t("p1.col.title")}</th>
                              <th class="w-36 px-3 py-2.5 font-medium">{language.t("p1.col.type")}</th>
                              <th class="w-40 px-3 py-2.5 font-medium">{language.t("p1.col.status")}</th>
                              <th class="w-40 px-3 py-2.5 font-medium">{language.t("p1.col.owner")}</th>
                              <th class="w-20 px-5 py-2.5 font-medium text-right">{language.t("p1.col.points")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            <For each={state.rows}>
                              {(row) => (
                                <tr
                                  data-action="p1-requirement"
                                  class="border-b border-border-weaker-base cursor-pointer hover:bg-surface-base-hover"
                                  classList={{ "opacity-60": state.opening === row.id }}
                                  onClick={() => setState("item", row.id)}
                                >
                                  <td class="px-5 py-3 text-13-regular text-text-weak font-mono">#{row.id}</td>
                                  <td class="px-3 py-3 max-w-0">
                                    <div class="truncate text-14-medium text-text-strong">{row.title}</div>
                                  </td>
                                  <td class="px-3 py-3 truncate text-13-regular text-text-base">{row.type}</td>
                                  <td class="px-3 py-3">
                                    <Show when={state.opening === row.id} fallback={<Status text={row.status} />}>
                                      <span class="flex items-center gap-1.5 text-12-regular text-text-weak">
                                        <Spinner class="size-4" />
                                        {language.t("p1.opening")}
                                      </span>
                                    </Show>
                                  </td>
                                  <td class="px-3 py-3 truncate text-13-regular text-text-base">{row.owner}</td>
                                  <td class="px-5 py-3 text-13-regular text-text-base text-right">{row.points}</td>
                                </tr>
                              )}
                            </For>
                          </tbody>
                        </table>
                      }
                    >
                      <div class="h-full p-4 flex gap-3 items-start">
                        <For each={columns()}>
                          {(column) => (
                            <div class="w-72 shrink-0 max-h-full flex flex-col rounded-xl bg-surface-base/60">
                              <div class="shrink-0 px-3 py-2.5 flex items-center gap-2">
                                <span class="truncate text-13-medium text-text-strong">
                                  {column.status || language.t("p1.status.none")}
                                </span>
                                <span class="text-12-regular text-text-weak">{column.rows.length}</span>
                              </div>
                              <div class="min-h-0 overflow-y-auto px-2 pb-2 flex flex-col gap-2">
                                <For each={column.rows}>
                                  {(row) => (
                                    <button
                                      type="button"
                                      data-action="p1-requirement"
                                      class="w-full text-left p-3 rounded-lg bg-background-base border border-border-weaker-base hover:border-border-base disabled:opacity-60 flex flex-col gap-1.5"
                                      disabled={state.opening === row.id}
                                      onClick={() => setState("item", row.id)}
                                    >
                                      <div class="flex items-center justify-between gap-2 text-12-regular text-text-weak">
                                        <span class="font-mono">#{row.id}</span>
                                        <Show when={state.opening === row.id} fallback={<span class="truncate">{row.type}</span>}>
                                          <Spinner class="size-4" />
                                        </Show>
                                      </div>
                                      <div class="text-13-medium text-text-strong line-clamp-3">{row.title}</div>
                                      <Show when={row.owner || row.points}>
                                        <div class="flex items-center justify-between gap-2 text-12-regular text-text-weak">
                                          <span class="truncate">{row.owner}</span>
                                          <Show when={row.points}>
                                            <span class="shrink-0">
                                              {row.points} {language.t("p1.col.points").toLowerCase()}
                                            </span>
                                          </Show>
                                        </div>
                                      </Show>
                                    </button>
                                  )}
                                </For>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </Show>
                </Show>
              </Show>
            </div>
          </section>
        </div>
      </Show>
      <Show when={state.menu}>
        {(open) => (
          <>
            <div class="fixed inset-0 z-40" onClick={() => setState("menu", undefined)} onContextMenu={(event) => {
              event.preventDefault()
              setState("menu", undefined)
            }} />
            <div
              data-component="p1-folder-menu"
              class="fixed z-50 w-56 p-1 rounded-xl"
              style={{
                left: `${Math.min(open().x, window.innerWidth - 240)}px`,
                top: `${Math.min(open().y, window.innerHeight - 200)}px`,
                border: "1px solid var(--border-strong-base)",
                background: "var(--surface-raised-stronger-non-alpha)",
                "box-shadow": "0 12px 32px rgb(0 0 0 / 0.4)",
              }}
            >
              <Show
                when={open().level >= 0}
                fallback={
                  <div class="px-2.5 py-2 flex items-center gap-2 text-13-regular text-text-weak">
                    <Spinner class="size-4" />
                    {language.t("p1.loading")}
                  </div>
                }
              >
                <For
                  each={
                    [
                      { place: 0, label: "p1.folder.child", need: 3 },
                      { place: -1, label: "p1.folder.above", need: 3 },
                      { place: 1, label: "p1.folder.below", need: 3 },
                      { place: undefined, label: "p1.folder.edit", need: 2 },
                    ] as const
                  }
                >
                  {(entry) => (
                    <Show when={entry.place === undefined || entry.place === 0 || state.parents[open().id]}>
                      <button
                        type="button"
                        data-action="p1-folder-menu-item"
                        class="w-full px-2.5 py-2 rounded-lg text-left text-13-regular text-text-strong hover:bg-surface-base-hover disabled:text-text-weaker disabled:hover:bg-transparent"
                        disabled={open().level < entry.need}
                        onClick={() => setState({ menu: undefined, dir: { id: open().id, place: entry.place } })}
                      >
                        {language.t(entry.label)}
                      </button>
                    </Show>
                  )}
                </For>
              </Show>
            </div>
          </>
        )}
      </Show>
      <Show when={state.dir && state.root ? state.dir : undefined} keyed>
        {(dir) => (
          <P1Folder
            project={state.root}
            id={dir.id}
            place={dir.place}
            onClose={() => setState("dir", undefined)}
            onSaved={(id, name) => void changed(id, name)}
          />
        )}
      </Show>
      <Show when={state.item !== undefined && state.root}>
        <P1Item
          project={state.root}
          folder={state.folder}
          id={state.item || undefined}
          onClose={() => setState("item", undefined)}
          onSaved={() => void fill(state.root, state.folder, state.query.trim())}
          onDesign={
            state.item
              ? () => {
                  const row = state.rows.find((item) => item.id === state.item)
                  setState("item", undefined)
                  if (row) void open(row)
                }
              : undefined
          }
        />
      </Show>
    </div>
  )
}

function Hint(props: { text: string }) {
  return (
    <div class="h-full min-h-24 flex items-center justify-center px-6 text-13-regular text-text-weak">{props.text}</div>
  )
}

function Status(props: { text: string }) {
  return (
    <Show when={props.text}>
      <span class="inline-block max-w-36 truncate px-2 py-0.5 rounded-full bg-surface-base text-12-regular text-text-base">
        {props.text}
      </span>
    </Show>
  )
}

/** The account menu's one entry: About, which shows the product, version and build in place. */
function AboutItem(props: { onDone: () => void }) {
  const language = useLanguage()
  const platform = usePlatform()
  const [state, setState] = createStore({ open: false })
  return (
    <Show
      when={state.open}
      fallback={
        <button
          type="button"
          data-action="p1-about"
          class="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-13-regular text-text-strong hover:bg-surface-base-hover"
          onClick={() => setState("open", true)}
        >
          <Icon name="help" size="small" class="text-text-weak" />
          {language.t("about.label")}
        </button>
      }
    >
      <div class="flex flex-col gap-2 p-3 select-text">
        <span class="text-14-medium text-text-strong">{language.t("about.title")}</span>
        <span class="text-12-regular text-text-weak">{language.t("about.tagline")}</span>
        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-12-regular">
          <dt class="text-text-weak">{language.t("about.version")}</dt>
          <dd class="text-text-strong tabular-nums">{platform.version ?? "dev"}</dd>
          <dt class="text-text-weak">{language.t("about.build")}</dt>
          <dd class="text-text-strong font-mono">{import.meta.env.VITE_KLOUD_BUILD || "dev"}</dd>
        </dl>
        <button
          type="button"
          class="self-start text-12-medium text-text-interactive-base hover:underline"
          onClick={() => {
            props.onDone()
            platform.openLink(HELP_URL)
          }}
        >
          {language.t("about.help")}
        </button>
      </div>
    </Show>
  )
}
