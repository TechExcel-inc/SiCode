import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Checkbox } from "@opencode-ai/ui/checkbox"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useLanguage } from "@/context/language"
import {
  deleteSharedServer,
  loadCatalog,
  loadServerView,
  loadServerProducts,
  loadSharedServers,
  repoEnd,
  repoSourceType,
  saveServerRepos,
  saveServerView,
  saveSharedServer,
  sharedServerAccess,
  type Group,
  type ServerProduct,
  type ServerRepo,
  type SharedServer,
  type SharedServerInput,
} from "@/ead/api"

type Form = SharedServerInput & { serverId?: number; confirm: string }
type Pick = { productId: number; definitionId: number; folder: string }

// The folder a new server starts with, written the way its operating system writes paths.
const folders = { windows: "C:\\EAD", mac: "~/EAD" }

const blank = (): Form => ({
  name: "",
  shortName: "",
  os: "windows",
  sshHost: "",
  sshPort: 22,
  sshLogin: "",
  password: "",
  confirm: "",
  rootFolder: folders.windows,
})

const smallest = { width: 960, height: 490 }

// The same colors EAD Pilot gives these tags.
const tones = {
  front: "text-[#10b981] bg-[#10b981]/15",
  server: "text-[#0ea5e9] bg-[#0ea5e9]/15",
  both: "text-[#8b5cf6] bg-[#8b5cf6]/15",
}

/**
 * The account's Shared Coding Servers, as EAD Pilot lists them, each with its products and each product's repos and
 * their source code roots on the server. Everyone sees them; the account's admins also add, edit and delete servers,
 * add products one at a time and set up each product's repos. Editing opens a popup over the list. Which servers are
 * expanded and the dialog's size are this person's settings in EAD Pilot.
 */
export function DialogSharedServers(props: { token: string; tenantId?: number; userId?: number; onChanged?: () => void }) {
  const language = useLanguage()
  const [state, setState] = createStore({
    rows: undefined as SharedServer[] | undefined,
    products: [] as ServerProduct[],
    manage: false,
    busy: false,
    error: "",
    help: false,
    /** The server asked to delete; a second click deletes it. */
    doomed: 0,
    /** The server and product asked to remove; a second click removes it. */
    dropping: "",
    /** Whether this person's settings were read from EAD Pilot; they're only saved once they were. */
    view: "" as "" | "ready" | "failed",
  })
  // Which servers are expanded and the size the user dragged the dialog to.
  const [view, setView] = createStore({ open: {} as Record<string, boolean>, ...smallest })
  const [form, setForm] = createSignal<Form>()
  // The popups: Select Product (step "product"), then Setup Repos (step "repos") for one product of a server.
  const [select, setSelect] = createStore({
    server: undefined as SharedServer | undefined,
    step: "product" as "product" | "repos",
    family: "",
    query: "",
    /** The product ticked in Select Product; one at a time for now. */
    choice: undefined as { productId: number; name: string } | undefined,
    product: 0,
    name: "",
    /** Came from Select Product, so Back returns there. */
    back: false,
    /** This product's ticked repos, by repo definition. */
    picked: {} as Record<string, Pick>,
    groups: undefined as Group[] | undefined,
  })

  const fail = (err: unknown) => (err instanceof Error ? err.message : String(err))
  const load = async () => {
    const token = props.token
    if (!token) return
    const [rows, manage, products] = await Promise.all([
      loadSharedServers(token, props.tenantId).catch(() => [] as SharedServer[]),
      // Only an explicit no hides the admin controls; EAD Pilot refuses what a member may not do.
      sharedServerAccess(token, props.tenantId).catch(() => true),
      loadServerProducts(token, props.tenantId).catch(() => [] as ServerProduct[]),
    ])
    setState({ rows, manage, products })
  }
  onMount(() => void load())

  createEffect(
    on(
      () => props.userId ?? 0,
      (user) => {
        if (!(user > 0) || !props.tenantId) return
        loadServerView(props.token, user, props.tenantId)
          .then((saved) => {
            if (saved) setView(saved)
            setState("view", "ready")
          })
          .catch(() => setState({ view: "failed", error: language.t("shared.viewFailed") }))
      },
    ),
  )
  const timer = { id: undefined as ReturnType<typeof setTimeout> | undefined }
  const flush = () => {
    if (!timer.id) return
    clearTimeout(timer.id)
    timer.id = undefined
    saveServerView(props.token, props.userId ?? 0, props.tenantId ?? 0, {
      open: { ...view.open },
      width: view.width,
      height: view.height,
    }).catch(() => setState("error", language.t("shared.viewFailed")))
  }
  // Waits for a pause, since dragging the dialog's size changes it many times a second.
  const keep = () => {
    if (state.view !== "ready") return
    if (timer.id) clearTimeout(timer.id)
    timer.id = setTimeout(flush, 300)
  }
  onCleanup(flush)

  const run = async (work: () => Promise<unknown>) => {
    if (state.busy) return false
    setState({ busy: true, error: "" })
    try {
      await work()
      await load()
      props.onChanged?.()
      return true
    } catch (err) {
      const message = fail(err)
      setState("error", /HTTP 40[45]/.test(message) ? language.t("shared.needsUpdate") : message)
      return false
    } finally {
      setState("busy", false)
    }
  }

  const save = async () => {
    const draft = form()
    if (!draft) return
    if (!draft.name.trim() || !draft.sshHost.trim() || !draft.sshLogin.trim())
      return setState("error", language.t("shared.form.required"))
    if (!(draft.sshPort >= 1 && draft.sshPort <= 65535)) return setState("error", language.t("shared.form.badPort"))
    if (!draft.serverId && !draft.password) return setState("error", language.t("shared.form.passwordRequired"))
    if (draft.password !== draft.confirm) return setState("error", language.t("shared.form.passwordMismatch"))
    const input: SharedServerInput = {
      name: draft.name.trim(),
      shortName: draft.shortName.trim(),
      os: draft.os,
      sshHost: draft.sshHost.trim(),
      sshPort: draft.sshPort,
      sshLogin: draft.sshLogin.trim(),
      password: draft.password,
      rootFolder: draft.rootFolder.trim(),
    }
    if (await run(() => saveSharedServer(props.token, input, draft.serverId, props.tenantId))) setForm(undefined)
  }

  const remove = (row: SharedServer) => {
    if (state.doomed !== row.serverId) return setState("doomed", row.serverId)
    setState("doomed", 0)
    void run(() => deleteSharedServer(props.token, row.serverId, props.tenantId))
  }

  // A server's products and repos, grouped by product, each repo once.
  const groups = (serverId: number) =>
    state.products.flatMap((product) => {
      const repos = product.repos
        .filter((repo) => repo.serverId === serverId)
        .filter((repo, index, all) => all.findIndex((item) => item.definitionId === repo.definitionId) === index)
      return repos.length ? [{ product, repos }] : []
    })
  const current = (serverId: number) =>
    groups(serverId).flatMap((group) =>
      group.repos.map((repo) => ({
        productId: group.product.productId,
        definitionId: repo.definitionId,
        folder: repo.folder,
      })),
    )
  // Saves a server's whole set of pairs: EAD Pilot replaces what the server had.
  const put = (serverId: number, list: Pick[]) => {
    if (list.some((row) => !row.folder.trim())) {
      setState("error", language.t("shared.folderRequired"))
      return Promise.resolve(false)
    }
    return run(() =>
      saveServerRepos(
        props.token,
        serverId,
        list.map((row) => ({ ...row, folder: row.folder.trim() })),
        props.tenantId,
      ),
    )
  }
  // Takes a product off a server, on the second click.
  const drop = (serverId: number, productId: number) => {
    const key = `${serverId}:${productId}`
    if (state.dropping !== key) return setState("dropping", key)
    setState("dropping", "")
    void put(
      serverId,
      current(serverId).filter((row) => row.productId !== productId),
    )
  }

  const pathOf = (server: SharedServer, repository: string) => {
    const sep = server.os === "windows" ? "\\" : "/"
    const root = server.rootFolder.replace(/[\\/]+$/, "")
    const name = repository.split("/").pop() ?? ""
    return root ? `${root}${sep}${name}` : name
  }
  const openProducts = (server: SharedServer) => {
    setState({ error: "", dropping: "" })
    setSelect({ server, step: "product", family: "", query: "", choice: undefined })
    if (!select.groups)
      void loadCatalog(props.token)
        .then((catalog) => setSelect("groups", catalog.groups))
        .catch((err) => setState("error", fail(err)))
  }
  const setup = (server: SharedServer, product: { productId: number; name: string }, back: boolean) => {
    setState({ error: "", dropping: "" })
    const picked = Object.fromEntries(
      current(server.serverId)
        .filter((row) => row.productId === product.productId)
        .map((row) => [String(row.definitionId), row]),
    )
    setSelect({ server, step: "repos", product: product.productId, name: product.name, back, picked })
  }
  const added = (productId: number) => {
    const server = select.server
    return !!server && current(server.serverId).some((row) => row.productId === productId)
  }
  const shown = createMemo(() => {
    const text = select.query.trim().toLowerCase()
    const server = select.server
    const teams = select.groups ?? []
    const known = new Set(teams.flatMap((group) => group.products.map((item) => item.productId)))
    // A product already on this server stays reachable even when the catalog doesn't list it.
    const extra = server
      ? groups(server.serverId)
          .map((group) => group.product)
          .filter((item) => !known.has(item.productId))
      : []
    const all: { name: string; products: { productId: number; name: string }[] }[] = extra.length
      ? [...teams, { name: server?.shortName || server?.name || "", products: extra }]
      : teams
    return all.flatMap((group) => {
      const products = text
        ? group.products.filter((item) => `${group.name} ${item.name}`.toLowerCase().includes(text))
        : group.products
      return products.length ? [{ ...group, products }] : []
    })
  })
  const family = () => shown().find((group) => group.name === select.family) ?? shown()[0]
  // From the list already loaded, so Setup Repos opens at its full size. Legacy repos have their own product.
  const known = () => state.products.find((item) => item.productId === select.product)
  const listing = createMemo(() =>
    (known()?.repos ?? [])
      .filter((repo) => repo.section === "CURRENT")
      .filter((repo, index, all) => all.findIndex((item) => item.definitionId === repo.definitionId) === index),
  )
  const pick = (repo: ServerRepo, on: boolean) => {
    const key = String(repo.definitionId)
    // Setting undefined deletes the key; a store setter returning a smaller object would merge and keep it.
    if (!on) return setSelect("picked", key, undefined!)
    const server = select.server!
    setSelect("picked", key, {
      productId: select.product,
      definitionId: repo.definitionId,
      folder: repo.serverId === server.serverId && repo.folder ? repo.folder : pathOf(server, repo.repository),
    })
  }
  // A new product needs a repo; on a product already there, saving none takes it off the server.
  const ready = () => added(select.product) || Object.keys(select.picked).length > 0
  const saveSetup = async () => {
    const server = select.server
    if (!server) return
    const list = [
      ...current(server.serverId).filter((row) => row.productId !== select.product),
      ...Object.values(select.picked),
    ]
    if (await put(server.serverId, list)) setSelect("server", undefined)
  }

  const os = (value: string) => language.t(value === "mac" ? "shared.os.mac" : "shared.os.windows")
  const TypeTag = (view: { repo: ServerRepo }) => (
    <span
      class={`inline-block px-1.5 rounded text-[10px] leading-4 font-semibold whitespace-nowrap ${tones[repoEnd(view.repo.role)]}`}
    >
      {language.t(`shared.type.${repoEnd(view.repo.role)}`)}
    </span>
  )
  const section = (repo: ServerRepo) => language.t(repo.section === "LEGACY" ? "shared.legacy" : "shared.current")
  const head = "px-3 py-2 text-left text-12-medium text-text-weak whitespace-nowrap"
  const cell = "px-3 py-2.5 text-13-regular text-text-strong align-middle"
  const input =
    "h-8 w-full min-w-0 px-2.5 rounded-md bg-surface-base border border-border-weak-base text-13-regular text-text-strong outline-none focus:border-border-interactive-base"
  const icon =
    "size-7 flex items-center justify-center rounded-md border border-border-weak-base text-icon-base hover:bg-surface-raised-base-hover disabled:opacity-50"
  const tag = "ml-2 px-1.5 rounded-full border border-border-weak-base text-11-regular text-text-weak"

  // A popup over the list (the app shows one dialog at a time, so these open inside it).
  const Popup = (view: {
    title: string
    wide?: boolean
    onClose: () => void
    children: JSX.Element
    footer: JSX.Element
  }) => (
    <div
      data-component="shared-popup"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && !state.busy && view.onClose()}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return
        e.stopPropagation()
        if (!state.busy) view.onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={view.title}
        class="flex flex-col gap-4 max-h-[calc(100vh-2rem)] w-full rounded-lg border border-border-strong-base bg-background-base shadow-[0_16px_48px_rgba(0,0,0,0.6)] p-5"
        classList={{ "max-w-[860px]": !!view.wide, "max-w-[620px]": !view.wide }}
      >
        <span class="text-16-medium text-text-strong">{view.title}</span>
        <div class="flex flex-col gap-3 min-h-0 overflow-y-auto">{view.children}</div>
        <Show when={state.error}>
          <p class="text-13-regular text-text-diff-delete-base break-words">{state.error}</p>
        </Show>
        <div class="flex items-center justify-end gap-2">{view.footer}</div>
      </div>
    </div>
  )

  const Field = (field: { label: string; children: JSX.Element }) => (
    <>
      <span class="text-13-regular text-text-weak">{field.label}</span>
      <div class="flex items-center gap-2.5 min-w-0">{field.children}</div>
    </>
  )

  const Repo = (view: { repo: ServerRepo }) => (
    <span class="flex flex-col min-w-0">
      <span class="text-text-strong">
        {view.repo.name || view.repo.repository}
        <span class={tag}>{section(view.repo)}</span>
      </span>
      <span class="text-12-regular text-text-weak font-mono truncate">
        {view.repo.repository}
        {view.repo.branch ? `@${view.repo.branch}` : ""}
      </span>
    </span>
  )

  // A server's applicable products and repos, under its row.
  const Pairs = (view: { server: SharedServer }) => (
    <div data-slot="shared-pairs" class="flex flex-col gap-2 mr-3 mb-3 p-3 rounded-md border border-border-weak-base">
      <div class="flex items-center justify-between gap-3">
        <span class="text-13-medium text-text-strong">{language.t("shared.pairs")}</span>
        <Show when={state.manage}>
          <Button
            type="button"
            variant="primary"
            size="large"
            data-action="shared-select-product"
            disabled={state.busy}
            onClick={() => openProducts(view.server)}
          >
            {language.t("shared.selectProduct")}
          </Button>
        </Show>
      </div>
      <Show
        when={groups(view.server.serverId).length}
        fallback={<p class="text-12-regular text-text-weak">{language.t("shared.pairsNone")}</p>}
      >
        <table class="w-full border-collapse">
          <thead>
            <tr>
              <th class={head}>{language.t("shared.col.repo")}</th>
              <th class={head}>{language.t("shared.col.type")}</th>
              <th class={head}>{language.t("shared.col.sourceType")}</th>
              <th class={head}>{language.t("shared.col.source")}</th>
            </tr>
          </thead>
          <tbody>
            <For each={groups(view.server.serverId)}>
              {(group) => {
                const key = () => `${view.server.serverId}:${group.product.productId}`
                return (
                  <>
                    <tr class="border-t border-border-weak-base" data-product={group.product.productId}>
                      <td colSpan={4} class="px-3 pt-3 pb-1.5">
                        <div class="flex items-center gap-2">
                          <span class="flex-1 min-w-0 truncate text-14-medium text-text-strong">
                            {group.product.name}
                          </span>
                          <Show when={state.manage}>
                            <Button
                              type="button"
                              variant="secondary"
                              size="normal"
                              class="!px-3 !border !border-solid !border-border-strong-base"
                              data-action="shared-setup-repos"
                              disabled={state.busy}
                              onClick={() => setup(view.server, group.product, false)}
                            >
                              {language.t("shared.setupRepos")}
                            </Button>
                            <button
                              type="button"
                              class={icon}
                              classList={{
                                "!border-text-diff-delete-base text-text-diff-delete-base": state.dropping === key(),
                              }}
                              data-action="shared-product-remove"
                              aria-label={language.t(state.dropping === key() ? "shared.removeAgain" : "shared.remove")}
                              disabled={state.busy}
                              onClick={() => drop(view.server.serverId, group.product.productId)}
                            >
                              <Icon name="trash" size="small" />
                            </button>
                          </Show>
                        </div>
                      </td>
                    </tr>
                    <For each={group.repos}>
                      {(repo) => (
                        <tr class="border-t border-border-weaker-base" data-repo={repo.definitionId}>
                          <td class={cell}>
                            <Repo repo={repo} />
                          </td>
                          <td class={`${cell} whitespace-nowrap`}>
                            <TypeTag repo={repo} />
                          </td>
                          <td class={cell}>{repoSourceType(repo) || "—"}</td>
                          <td class={`${cell} font-mono text-12-regular break-all`}>{repo.folder}</td>
                        </tr>
                      )}
                    </For>
                  </>
                )
              }}
            </For>
          </tbody>
        </table>
      </Show>
    </div>
  )

  // Setup Repos: the product's current repos, one line each.
  const Repos = () => (
    <Show
      when={listing().length}
      fallback={
        <p class="text-13-regular text-text-weak">{language.t(known() ? "shared.noRepos" : "shared.noSchema")}</p>
      }
    >
      <div class="grid grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)] items-center gap-x-3 px-1 pb-1.5 border-b border-border-weaker-base text-12-medium text-text-weak">
        <span>{language.t("shared.col.repo")}</span>
        <span>{language.t("shared.col.type")}</span>
        <span>{language.t("shared.col.source")}</span>
      </div>
      <For each={listing()}>
        {(repo) => {
          const choice = () => select.picked[String(repo.definitionId)]
          const other = () =>
            repo.serverId && repo.serverId !== select.server?.serverId
              ? state.rows?.find((row) => row.serverId === repo.serverId)
              : undefined
          return (
            <div
              data-slot="shared-repo"
              class="grid grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)] items-center gap-x-3 min-h-10 px-1 border-b border-border-weaker-base"
            >
              <span class="flex items-center gap-2.5 min-w-0">
                <Checkbox
                  data-action="shared-pick"
                  checked={!!choice()}
                  disabled={!!other() || state.busy}
                  onChange={(on) => pick(repo, on)}
                >
                  <span class="text-13-regular text-text-strong whitespace-nowrap">{repo.name}</span>
                </Checkbox>
                <span
                  class="min-w-0 truncate text-12-regular text-text-weak font-mono"
                  title={`${repo.repository}${repo.branch ? `@${repo.branch}` : ""}`}
                >
                  {repo.repository}
                  {repo.branch ? `@${repo.branch}` : ""}
                </span>
              </span>
              <span>
                <TypeTag repo={repo} />
              </span>
              <Show
                when={choice()}
                fallback={
                  <span class="text-12-regular text-text-weak">
                    {other() ? language.t("shared.onOther", { name: other()!.shortName }) : ""}
                  </span>
                }
              >
                <input
                  class={`${input} font-mono`}
                  aria-label={language.t("shared.col.source")}
                  value={choice()!.folder}
                  disabled={state.busy}
                  onInput={(e) => setSelect("picked", String(repo.definitionId), "folder", e.currentTarget.value)}
                />
              </Show>
            </div>
          )
        }}
      </For>
    </Show>
  )

  return (
    <Dialog
      title={language.t("shared.title")}
      size="x-large"
      resize={{
        width: view.width,
        height: view.height,
        min: smallest,
        onResize: (next) => {
          setView(next)
          keep()
        },
      }}
      tools={
        <>
          <button
            type="button"
            data-action="shared-help"
            aria-label={language.t("shared.help")}
            class="size-6 shrink-0 rounded-full border border-border-strong-base text-12-medium text-text-weak hover:text-text-strong hover:border-border-interactive-base"
            onClick={() => setState("help", !state.help)}
          >
            ?
          </button>
          <Show when={state.manage}>
            <Button
              type="button"
              variant="secondary"
              size="small"
              icon="plus-small"
              data-action="shared-new"
              onClick={() => {
                setState({ error: "", help: false })
                setForm(blank())
              }}
            >
              {language.t("shared.new")}
            </Button>
          </Show>
        </>
      }
    >
      <div data-component="dialog-shared-servers" class="flex-1 min-h-0 flex flex-col gap-3 px-6 pb-6">
        <p class="text-13-regular text-text-weak">{language.t("shared.intro")}</p>
        <Show when={state.help}>
          <div class="p-3 flex flex-col gap-1.5 rounded-md border border-border-weak-base bg-background-base shadow-md text-13-regular text-text-strong">
            <For each={["shared.help.what", "shared.help.product", "shared.help.admin"]}>
              {(key) => <p>{language.t(key)}</p>}
            </For>
          </div>
        </Show>
        <Show when={state.error && !form() && !select.server}>
          <p class="text-13-regular text-text-diff-delete-base break-words" data-slot="shared-error">
            {state.error}
          </p>
        </Show>

        <div class="min-h-0 rounded-md border border-border-weak-base overflow-auto">
          <table class="w-full border-collapse">
            <thead class="bg-surface-base">
              <tr>
                <th class="w-8" />
                <th class={head}>{language.t("shared.col.name")}</th>
                <th class={head}>{language.t("shared.col.short")}</th>
                <th class={head}>{language.t("shared.col.os")}</th>
                <th class={head}>{language.t("shared.col.host")}</th>
                <th class={head}>{language.t("shared.col.login")}</th>
                <th class={head}>{language.t("shared.col.root")}</th>
                <Show when={state.manage}>
                  <th class={head} />
                </Show>
              </tr>
            </thead>
            <tbody>
              <Show
                // Rows wait for the saved view, so servers never show collapsed first or get toggled before it loads.
                when={state.rows && (!props.userId || !props.tenantId || state.view)}
                fallback={
                  <tr>
                    <td colSpan={8} class="px-3 py-6 text-center">
                      <Spinner class="size-4 inline-block" />
                    </td>
                  </tr>
                }
              >
                <Show
                  when={state.rows!.length}
                  fallback={
                    <tr>
                      <td colSpan={8} class="px-3 py-6 text-center text-13-regular text-text-weak">
                        {language.t("shared.empty")}
                      </td>
                    </tr>
                  }
                >
                  <For each={state.rows}>
                    {(row) => (
                      <>
                        <tr class="border-t border-border-weaker-base" data-row={row.serverId}>
                          <td class="pl-2 align-middle">
                            <button
                              type="button"
                              data-action="shared-expand"
                              aria-expanded={!!view.open[row.serverId]}
                              aria-label={language.t("shared.pairs")}
                              class="size-6 flex items-center justify-center rounded-md text-icon-weak hover:bg-surface-raised-base-hover"
                              onClick={() => {
                                setView("open", String(row.serverId), !view.open[row.serverId])
                                keep()
                              }}
                            >
                              <Icon
                                name="chevron-right"
                                size="small"
                                class="transition-transform"
                                classList={{ "rotate-90": !!view.open[row.serverId] }}
                              />
                            </button>
                          </td>
                          <td class={`${cell} whitespace-nowrap`}>{row.name}</td>
                          <td class={`${cell} whitespace-nowrap`}>{row.shortName}</td>
                          <td class={cell}>{os(row.os)}</td>
                          <td class={cell}>
                            {row.sshHost}:{row.sshPort}
                          </td>
                          <td class={cell}>{row.sshLogin}</td>
                          <td class={`${cell} font-mono text-12-regular`}>{row.rootFolder}</td>
                          <Show when={state.manage}>
                            <td class={`${cell} whitespace-nowrap`}>
                              <span class="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  class={icon}
                                  data-action="shared-edit"
                                  aria-label={language.t("shared.edit")}
                                  disabled={state.busy}
                                  onClick={() => {
                                    setState({ error: "", help: false })
                                    setForm({ ...blank(), ...row, password: "", confirm: "" })
                                  }}
                                >
                                  <Icon name="edit-small-2" size="small" />
                                </button>
                                <button
                                  type="button"
                                  class={icon}
                                  classList={{
                                    "!border-text-diff-delete-base text-text-diff-delete-base":
                                      state.doomed === row.serverId,
                                  }}
                                  data-action="shared-delete"
                                  aria-label={language.t(
                                    state.doomed === row.serverId ? "shared.deleteAgain" : "shared.delete",
                                  )}
                                  disabled={state.busy}
                                  onClick={() => remove(row)}
                                >
                                  <Icon name="trash" size="small" />
                                </button>
                              </span>
                            </td>
                          </Show>
                        </tr>
                        <Show when={view.open[row.serverId]}>
                          <tr>
                            <td />
                            <td colSpan={7}>
                              <Pairs server={row} />
                            </td>
                          </tr>
                        </Show>
                      </>
                    )}
                  </For>
                </Show>
              </Show>
            </tbody>
          </table>
        </div>
      </div>

      <Show when={form()}>
        {(draft) => (
          <Popup
            title={language.t(draft().serverId ? "shared.editTitle" : "shared.newTitle")}
            onClose={() => setForm(undefined)}
            footer={
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="large"
                  disabled={state.busy}
                  onClick={() => setForm(undefined)}
                >
                  {language.t("common.cancel")}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="large"
                  data-action="shared-save"
                  disabled={state.busy}
                  onClick={() => void save()}
                >
                  <Show when={state.busy}>
                    <Spinner class="size-4" />
                  </Show>
                  {language.t("common.save")}
                </Button>
              </>
            }
          >
            <div class="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-x-4 gap-y-2.5">
              <Field label={language.t("shared.col.name")}>
                <input
                  class={input}
                  value={draft().name}
                  onInput={(e) => setForm({ ...draft(), name: e.currentTarget.value })}
                />
              </Field>
              <Field label={language.t("shared.col.short")}>
                <input
                  class={`${input} !w-36 shrink-0`}
                  maxLength={12}
                  placeholder={language.t("shared.form.shortHint")}
                  value={draft().shortName}
                  onInput={(e) => setForm({ ...draft(), shortName: e.currentTarget.value })}
                />
                <span class="ml-2 shrink-0 text-13-regular text-text-weak">{language.t("shared.col.os")}</span>
                <For each={["windows", "mac"] as const}>
                  {(value) => (
                    <label class="inline-flex items-center gap-1.5 text-13-regular text-text-strong whitespace-nowrap">
                      <input
                        type="radio"
                        name="shared-os"
                        checked={draft().os === value}
                        onChange={() =>
                          setForm({
                            ...draft(),
                            os: value,
                            // A folder the user typed stays; the untouched default follows the operating system.
                            rootFolder: Object.values(folders).includes(draft().rootFolder.trim() || folders.mac)
                              ? folders[value]
                              : draft().rootFolder,
                          })
                        }
                      />
                      {os(value)}
                    </label>
                  )}
                </For>
              </Field>
              <Field label={language.t("shared.col.host")}>
                <input
                  class={input}
                  value={draft().sshHost}
                  onInput={(e) => setForm({ ...draft(), sshHost: e.currentTarget.value })}
                />
                <span class="shrink-0 text-13-regular text-text-weak">{language.t("shared.form.port")}</span>
                <input
                  class={`${input} !w-24 shrink-0`}
                  inputMode="numeric"
                  value={String(draft().sshPort)}
                  onInput={(e) => setForm({ ...draft(), sshPort: Number(e.currentTarget.value) || 0 })}
                />
              </Field>
              <Field label={language.t("shared.col.login")}>
                <input
                  class={input}
                  value={draft().sshLogin}
                  onInput={(e) => setForm({ ...draft(), sshLogin: e.currentTarget.value })}
                />
              </Field>
              <Field label={language.t("shared.form.password")}>
                <input
                  class={input}
                  type="password"
                  placeholder={draft().serverId ? language.t("shared.form.passwordKeep") : ""}
                  value={draft().password}
                  onInput={(e) => setForm({ ...draft(), password: e.currentTarget.value })}
                />
                <input
                  class={input}
                  type="password"
                  placeholder={language.t("shared.form.confirm")}
                  value={draft().confirm}
                  onInput={(e) => setForm({ ...draft(), confirm: e.currentTarget.value })}
                />
              </Field>
              <Field label={language.t("shared.col.root")}>
                <input
                  class={`${input} font-mono`}
                  placeholder={folders[draft().os]}
                  value={draft().rootFolder}
                  onInput={(e) => setForm({ ...draft(), rootFolder: e.currentTarget.value })}
                />
              </Field>
            </div>
          </Popup>
        )}
      </Show>

      <Show when={select.server && select.step === "product" ? select.server : undefined}>
        {(server) => (
          <Popup
            title={language.t("shared.selectProductTitle", { name: server().shortName || server().name })}
            onClose={() => setSelect("server", undefined)}
            footer={
              <>
                <Button type="button" variant="ghost" size="large" onClick={() => setSelect("server", undefined)}>
                  {language.t("common.cancel")}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="large"
                  data-action="shared-product-ok"
                  disabled={!select.choice}
                  onClick={() => setup(server(), select.choice!, true)}
                >
                  {language.t("shared.ok")}
                </Button>
              </>
            }
          >
            <input
              class={input}
              placeholder={language.t("shared.search")}
              value={select.query}
              onInput={(e) => setSelect("query", e.currentTarget.value)}
            />
            <Show when={select.groups} fallback={<Spinner class="size-4 m-2" />}>
              <div class="grid grid-cols-2 gap-3 h-[50vh] min-h-[280px]">
                <div class="min-h-0 overflow-y-auto flex flex-col gap-0.5 rounded-md border border-border-weak-base p-2">
                  <For each={shown()}>
                    {(group) => (
                      <button
                        type="button"
                        data-action="shared-family"
                        class="px-2 py-1.5 flex items-center gap-2 rounded-md text-left text-13-regular border border-transparent"
                        classList={{
                          "bg-surface-interactive-base !border-border-interactive-base text-text-strong":
                            family()?.name === group.name,
                          "text-text-base hover:bg-surface-raised-base-hover": family()?.name !== group.name,
                        }}
                        onClick={() => setSelect("family", group.name)}
                      >
                        <Icon name="folder" size="small" class="shrink-0 text-icon-weak" />
                        <span class="flex-1 min-w-0 truncate">{group.name}</span>
                      </button>
                    )}
                  </For>
                </div>
                <div class="min-h-0 overflow-y-auto flex flex-col gap-0.5 rounded-md border border-border-weak-base p-2">
                  <For each={family()?.products ?? []}>
                    {(item) => (
                      <div data-slot="shared-product" data-product={item.productId} class="px-2 py-1.5">
                        <Checkbox
                          data-action="shared-product"
                          checked={added(item.productId) || select.choice?.productId === item.productId}
                          disabled={added(item.productId)}
                          onChange={(on) =>
                            setSelect("choice", on ? { productId: item.productId, name: item.name } : undefined)
                          }
                        >
                          <span class="text-13-regular text-text-strong">{item.name}</span>
                        </Checkbox>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </Popup>
        )}
      </Show>

      <Show when={select.server && select.step === "repos" ? select.server : undefined}>
        {(server) => (
          <Popup
            wide
            title={language.t("shared.setupTitle", { product: select.name, name: server().shortName || server().name })}
            onClose={() => setSelect("server", undefined)}
            footer={
              <>
                <Show when={select.back}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="large"
                    class="mr-auto"
                    disabled={state.busy}
                    onClick={() => setSelect("step", "product")}
                  >
                    {language.t("shared.back")}
                  </Button>
                </Show>
                <Button
                  type="button"
                  variant="ghost"
                  size="large"
                  disabled={state.busy}
                  onClick={() => setSelect("server", undefined)}
                >
                  {language.t("common.cancel")}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="large"
                  data-action="shared-setup-save"
                  disabled={state.busy || !ready()}
                  onClick={() => void saveSetup()}
                >
                  <Show when={state.busy}>
                    <Spinner class="size-4" />
                  </Show>
                  {language.t("common.save")}
                </Button>
              </>
            }
          >
            <div data-slot="shared-repos" class="flex flex-col">
              <Repos />
            </div>
          </Popup>
        )}
      </Show>
    </Dialog>
  )
}
