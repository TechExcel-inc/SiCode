import { For, Show, createEffect, on } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { denied, folders, item, login, origin, projects, requirements, type Folder, type Project, type Row } from "@/p1/api"
import { doc, file, prose } from "@/p1/doc"
import { useP1 } from "@/p1/settings"
import { setDesign } from "./design-state"

const field =
  "h-9 w-full px-3 rounded-lg bg-surface-base border border-border-weaker-base text-13-regular text-text-strong placeholder:text-text-weak outline-none focus:border-border-interactive-base"

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
    folders: [] as Folder[],
    rows: [] as Row[],
    project: 0,
    folder: 0,
    root: 0,
    find: "",
    query: "",
    opening: 0,
  })
  let stamp = 0
  let wave = 0
  let timer: number | undefined

  const message = (err: unknown) => (err instanceof Error ? err.message : String(err))
  const fail = (err: unknown) => {
    if (denied(err)) p1.clear()
    setState({ err: message(err), loading: false, busy: false, opening: 0 })
  }
  const chosen = () => state.projects.find((item) => item.id === state.project)
  const shown = () => {
    const query = state.find.trim().toLowerCase()
    if (!query) return state.projects
    return state.projects.filter((item) => item.name.toLowerCase().includes(query))
  }

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
      setState({ loading: false, folders: [], rows: [], project: 0, folder: 0 })
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
    setState({ project: id, loading: true, err: "", query: "", find: state.find })
    const first = await folders(host, token, project.id, project.id, language.locale()).catch((err: unknown) => {
      if (mark === stamp) fail(err)
    })
    if (mark !== stamp || !first) return
    const tree =
      first.length || project.base === project.id
        ? first
        : await folders(host, token, project.base, project.id, language.locale()).catch((err: unknown) => {
            if (mark === stamp) fail(err)
          })
    if (mark !== stamp || !tree) return
    const root = first.length || project.base === project.id ? project.id : project.base
    const folder = tree[0]?.id ?? 0
    setState({ folders: tree, folder, root })
    await fill(root, folder, "", mark)
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
    setState({ rows: list, loading: false, err: "" })
  }

  const search = (value: string) => {
    setState("query", value)
    if (timer !== undefined) window.clearTimeout(timer)
    const folder = state.folder
    if (!state.root || !folder) return
    timer = window.setTimeout(() => void fill(state.root, folder, value.trim()), 250)
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
          setState({ projects: [], folders: [], rows: [], project: 0, folder: 0, loading: false })
          return
        }
        void load()
      },
    ),
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
        <header class="shrink-0 h-12 px-4 flex items-center gap-3 border-b border-border-weaker-base">
          <span class="text-14-medium text-text-strong">{language.t("rail.work")}</span>
          <span class="min-w-0 truncate text-12-regular text-text-weak">
            {p1.name()}
            <span class="px-1.5">·</span>
            {p1.server().replace(/^https?:\/\//, "")}
          </span>
          <div class="flex-1" />
          <button
            type="button"
            class="shrink-0 text-12-regular text-text-base hover:text-text-strong"
            data-action="p1-sign-out"
            onClick={() => p1.clear()}
          >
            {language.t("p1.signOut")}
          </button>
        </header>
        <Show when={state.err}>
          <p class="shrink-0 px-4 py-2 text-12-regular text-text-diff-delete-base border-b border-border-weaker-base">
            {state.err}
          </p>
        </Show>
        <div class="flex-1 min-h-0 flex">
          <aside class="w-72 shrink-0 border-r border-border-weaker-base flex flex-col min-h-0">
            <div class="shrink-0 px-3 pt-3 pb-2 flex flex-col gap-2">
              <div class="text-12-medium text-text-weak">{language.t("p1.projects")}</div>
              <input
                class={field}
                value={state.find}
                placeholder={language.t("p1.search.project")}
                onInput={(event) => setState("find", event.currentTarget.value)}
              />
            </div>
            <div class="flex-1 min-h-0 overflow-y-auto px-2 pb-3 flex flex-col gap-0.5">
              <Show when={!state.loading || state.projects.length} fallback={<Hint text={language.t("p1.loading")} />}>
                <Show when={shown().length} fallback={<Hint text={language.t("p1.empty.projects")} />}>
                  <For each={shown()}>
                    {(item, index) => (
                      <div>
                        <Show when={item.group && item.group !== shown()[index() - 1]?.group}>
                          <div class="px-2.5 pt-3 pb-1 text-12-regular text-text-weak truncate">{item.group}</div>
                        </Show>
                        <button
                          type="button"
                          data-action="p1-project"
                          class="w-full text-left px-2.5 py-2 rounded-lg text-13-regular truncate"
                          classList={{
                            "bg-surface-base-active text-text-strong": item.id === state.project,
                            "text-text-base hover:bg-surface-base-hover": item.id !== state.project,
                          }}
                          onClick={() => void pick(item.id)}
                        >
                          {item.name}
                        </button>
                      </div>
                    )}
                  </For>
                </Show>
              </Show>
            </div>
          </aside>
          <section class="flex-1 min-w-0 flex flex-col min-h-0">
            <div class="shrink-0 px-4 py-3 flex items-center gap-3 border-b border-border-weaker-base">
              <Show when={state.folders.length > 1}>
                <label class="shrink-0 flex items-center gap-2 min-w-0">
                  <span class="text-12-regular text-text-weak">{language.t("p1.folders")}</span>
                  <select
                    class="h-9 max-w-56 px-2 rounded-lg bg-surface-base border border-border-weaker-base text-13-regular text-text-strong outline-none"
                    value={state.folder}
                    onChange={(event) => {
                      const folder = Number(event.currentTarget.value)
                      if (!state.root || !folder) return
                      void fill(state.root, folder, state.query.trim())
                    }}
                  >
                    <For each={state.folders}>
                      {(item) => (
                        <option value={item.id}>
                          {"\u2003".repeat(item.depth)}
                          {item.name}
                        </option>
                      )}
                    </For>
                  </select>
                </label>
              </Show>
              <Show when={state.folders.length === 1}>
                <span class="shrink-0 truncate max-w-48 text-13-regular text-text-base">{state.folders[0]?.name}</span>
              </Show>
              <input
                class={`${field} max-w-xs`}
                value={state.query}
                placeholder={language.t("p1.search.requirement")}
                onInput={(event) => search(event.currentTarget.value)}
              />
            </div>
            <div class="flex-1 min-h-0 overflow-y-auto">
              <Show when={!state.loading} fallback={<Hint text={language.t("p1.loading")} />}>
                <Show when={state.folder} fallback={<Hint text={language.t("p1.empty.folders")} />}>
                  <Show when={state.rows.length} fallback={<Hint text={language.t("p1.empty.requirements")} />}>
                    <For each={state.rows}>
                      {(row) => (
                        <button
                          type="button"
                          data-action="p1-requirement"
                          class="w-full text-left px-4 py-3 flex items-center gap-3 border-b border-border-weaker-base hover:bg-surface-base-hover disabled:opacity-60"
                          disabled={state.opening === row.id}
                          onClick={() => void open(row)}
                        >
                          <div class="flex-1 min-w-0">
                            <div class="truncate text-14-medium text-text-strong">{row.title}</div>
                            <div class="mt-0.5 truncate text-12-regular text-text-weak">
                              #{row.id}
                              <Show when={row.owner}>
                                <span class="px-1.5">·</span>
                                {row.owner}
                              </Show>
                            </div>
                          </div>
                          <Show when={state.opening === row.id} fallback={<Status text={row.status} />}>
                            <span class="shrink-0 flex items-center gap-1.5 text-12-regular text-text-weak">
                              <Spinner class="size-4" />
                              {language.t("p1.opening")}
                            </span>
                          </Show>
                        </button>
                      )}
                    </For>
                  </Show>
                </Show>
              </Show>
            </div>
          </section>
        </div>
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
      <span class="shrink-0 max-w-28 truncate px-2 py-0.5 rounded-full bg-surface-base text-12-regular text-text-base">
        {props.text}
      </span>
    </Show>
  )
}
