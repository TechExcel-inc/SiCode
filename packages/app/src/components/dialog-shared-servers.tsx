import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Checkbox } from "@opencode-ai/ui/checkbox"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useLanguage } from "@/context/language"
import { type RemoteDevStep, parseRemoteDevReply, remoteDevPrompt } from "@/ead/remote-dev-ai"
import {
  type ProductAiInput,
  type ProductAiTargets,
  parseProductReply,
  productPickPrompt,
  productPrompt,
} from "@/ead/product-ai"
import { getRelativeTime } from "@/utils/time"
import {
  deleteSharedServer,
  findRepoFolders,
  loadPublishTargets,
  loadCatalog,
  loadServerView,
  loadServerAccess,
  loadServerPassword,
  loadServerProducts,
  loadSharedServers,
  remoteCoding,
  remoteDevServerAiHelp,
  reorderSharedServers,
  repoEnd,
  repoSourceType,
  saveProductPublish,
  saveRemoteCoding,
  saveServerRepos,
  saveServerView,
  saveSharedServer,
  sharedServerAccess,
  type Group,
  type PublishPlace,
  type PublishSide,
  type ServerAccess,
  type ServerProduct,
  type ServerRepo,
  type SharedServer,
  type SharedServerInput,
} from "@/ead/api"

type Form = SharedServerInput & { serverId?: number; confirm: string; hasKey?: boolean; keyName?: string }
type Pick = { productId: number; definitionId: number; folder: string }

// The folder a new server starts with, written the way its operating system writes paths.
const folders = { windows: "C:\\EAD", mac: "~/EAD", linux: "~/EAD" }
const remotePorts = { windows: 3389, mac: 5900, linux: 5900 }

const blank = (): Form => ({
  name: "",
  shortName: "",
  os: "windows",
  sshHost: "",
  sshPort: 22,
  sshLogin: "",
  authMethod: "password",
  privateKey: "",
  password: "",
  confirm: "",
  rootFolder: folders.windows,
  note: "",
  useCoding: true,
  publishRole: "none",
  sshEnabled: true,
  remoteControl: false,
  remotePort: remotePorts.windows,
})

const smallest = { width: 960, height: 490 }

const places = ["testing", "production"] as const
const roles = ["none", ...places] as const
const sides = ["frontend", "backend"] as const
const sideNames = { frontend: "shared.type.front", backend: "shared.type.server" } as const
const blankPlace = () => ({ serverId: 0, folder: "", url: "" })
const blankPlaces = () => ({ frontend: blankPlace(), backend: blankPlace() })

// How AI Help names each kind of repo.
const endWords = { front: "front end", server: "back end", both: "front and back end" } as const

// The same colors EAD Pilot gives these tags.
const tones = {
  front: "text-[#10b981] bg-[#10b981]/15",
  server: "text-[#0ea5e9] bg-[#0ea5e9]/15",
  both: "text-[#8b5cf6] bg-[#8b5cf6]/15",
}

/**
 * The account's Shared Coding Servers, as EAD Pilot lists them, each with its products and each product's repos and
 * their source code roots on the server: cards on the left, the chosen server on the right. Everyone sees them and who
 * reached each one; the account's admins also add, edit and delete servers, add products one at a time and set up each
 * product's repos. Editing opens a popup over the list. The chosen server and the dialog's size are this person's settings in EAD Pilot.
 */
export function DialogSharedServers(props: {
  token: string
  tenantId?: number
  userId?: number
  onChanged?: () => void
  /** Runs AI Help's request in a read-only agent session of the open project and returns its answer. */
  ask?: (
    prompt: string,
    signal?: AbortSignal,
    onStep?: (step: RemoteDevStep) => void,
    options?: { quick?: boolean },
  ) => Promise<string>
}) {
  const language = useLanguage()
  const [state, setState] = createStore({
    rows: undefined as SharedServer[] | undefined,
    products: [] as ServerProduct[],
    manage: false,
    busy: false,
    error: "",
    help: false,
    find: "",
    /** The server asked to delete, waiting for the confirmation popup. */
    doomed: undefined as SharedServer | undefined,
    /** The server whose access activity is open, its rows once loaded, and the one person they're narrowed to. */
    watched: undefined as SharedServer | undefined,
    access: undefined as ServerAccess[] | undefined,
    person: 0,
    /** The form's eye: whether passwords show as typed, and the saved one once a Superadmin has asked for it. */
    shown: false,
    saved: "",
    /** The server and product asked to remove; a second click removes it. */
    dropping: "",
    /** AI Help in the New / Edit form: open, what the admin wrote, asking now, and what the model said. */
    ai: { open: false, prompt: "", asking: false, reply: "", step: undefined as RemoteDevStep | undefined, started: 0 },
    /** Whether this person's settings were read from EAD Pilot; they're only saved once they were. */
    view: "" as "" | "ready" | "failed",
  })
  // The chosen server and the size the user dragged the dialog to.
  const [view, setView] = createStore({ server: 0, ...smallest })
  const [form, setForm] = createSignal<Form>()
  // The popups: Select Product (step "product"), then Setup Repos (step "repos") for one product of a server.
  const [select, setSelect] = createStore({
    server: undefined as SharedServer | undefined,
    step: "product" as "product" | "repos" | "publish",
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
    /** Whether this product is coded on the server, and where it publishes. */
    coding: true,
    publish: { testing: blankPlaces(), production: blankPlaces() },
    groups: undefined as Group[] | undefined,
    /** Find on server: searching now, the folder found per repo definition, and what the search found. */
    finding: false,
    found: {} as Record<string, string>,
    /** Repos checked out more than once on the server, with every folder, for AI Help to choose from. */
    candidates: {} as Record<string, string[]>,
    findNote: "",
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
      server: view.server,
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
    // The server as saved: a blank password or key keeps the saved one only while the sign-in stays the same.
    const saved = draft.serverId ? state.rows?.find((row) => row.serverId === draft.serverId) : undefined
    if (draft.authMethod === "key") {
      if (!draft.privateKey && !(saved?.authMethod === "key" && saved.hasKey))
        return setState("error", language.t("shared.form.keyRequired"))
    } else {
      if (!draft.password && (!saved || saved.authMethod === "key"))
        return setState("error", language.t("shared.form.passwordRequired"))
      if (draft.password !== draft.confirm) return setState("error", language.t("shared.form.passwordMismatch"))
    }
    const input: SharedServerInput = {
      name: draft.name.trim(),
      shortName: draft.shortName.trim(),
      os: draft.os,
      sshHost: draft.sshHost.trim(),
      sshPort: draft.sshPort,
      sshLogin: draft.sshLogin.trim(),
      authMethod: draft.authMethod,
      privateKey: draft.authMethod === "key" ? draft.privateKey : "",
      password: draft.password,
      rootFolder: draft.rootFolder.trim(),
      note: draft.note.trim(),
      useCoding: draft.useCoding,
      publishRole: draft.publishRole,
      sshEnabled: draft.sshEnabled,
      remoteControl: draft.remoteControl,
      remotePort: draft.remotePort,
    }
    if (await run(() => saveSharedServer(props.token, input, draft.serverId, props.tenantId))) setForm(undefined)
  }

  // The card next to `row` in the list as shown (search narrows it), one up (-1) or down (1).
  const neighbor = (row: SharedServer, step: -1 | 1) => {
    const list = found()
    return list[list.findIndex((item) => item.serverId === row.serverId) + step]
  }
  // Swaps a card with the one shown next to it and saves the whole order; the list moves at once.
  const move = async (row: SharedServer, step: -1 | 1) => {
    const other = neighbor(row, step)
    const rows = state.rows
    if (!other || !rows) return
    const order = rows.map((item) =>
      item.serverId === row.serverId ? other : item.serverId === other.serverId ? row : item,
    )
    setState("rows", order)
    const saved = await run(() =>
      reorderSharedServers(
        props.token,
        order.map((item) => item.serverId),
        props.tenantId,
      ),
    )
    // After a failure the list is read again, so it shows the order EAD Pilot kept.
    if (!saved) await load()
  }

  // AI Help: EAD Pilot asks a model to fill the form from the admin's words; the admin reviews it before Save.
  // The search running now, so Stop and closing the form can end it.
  const running = { controller: undefined as AbortController | undefined }
  const stopAi = () => running.controller?.abort()
  onCleanup(stopAi)
  const askAi = async () => {
    const draft = form()
    const prompt = state.ai.prompt.trim()
    if (!draft || !prompt || state.ai.asking) return
    const controller = new AbortController()
    running.controller = controller
    setState("ai", { asking: true, reply: "", step: undefined, started: Date.now() })
    setState("error", "")
    try {
      const {
        password: _password,
        confirm: _confirm,
        privateKey: _key,
        keyName: _keyName,
        hasKey: _hasKey,
        shortName: _short,
        serverId: _id,
        ...current
      } = draft
      // The open project's agent can read its deploy scripts and uses the model picked in SiCode; Pilot is the fallback.
      const result = props.ask
        ? parseRemoteDevReply(await props.ask(remoteDevPrompt(prompt, current, !!draft.serverId), controller.signal, (step) =>
              setState("ai", "step", step),
            ))
        : await remoteDevServerAiHelp(props.token, prompt, current, props.tenantId)
      const next = { ...draft, ...result.fields }
      // A default clone folder still at the other system's default follows a changed operating system.
      if (result.fields.os && !result.fields.rootFolder && Object.values(folders).includes(draft.rootFolder.trim()))
        next.rootFolder = folders[result.fields.os]
      if (result.fields.os && !result.fields.remotePort && Object.values(remotePorts).includes(draft.remotePort))
        next.remotePort = remotePorts[result.fields.os]
      // A form closed while AI Help looked is not reopened with its answer.
      if (controller.signal.aborted || !form()) return
      setForm(next)
      const changed = Object.keys(result.fields).length
      setState("ai", "reply", result.reply || language.t(changed ? "shared.ai.filled" : "shared.ai.nothing"))
    } catch (err) {
      const message = fail(err)
      if (form()) setState("error", /HTTP 40[45]/.test(message) ? language.t("shared.needsUpdate") : message)
    } finally {
      if (running.controller === controller) running.controller = undefined
      setState("ai", "asking", false)
    }
  }

  const remove = async () => {
    const row = state.doomed
    if (!row) return
    if (await run(() => deleteSharedServer(props.token, row.serverId, props.tenantId))) setState("doomed", undefined)
  }

  const openNew = () => {
    setState({ error: "", help: false, shown: false, saved: "", ai: { open: false, prompt: "", asking: false, reply: "", step: undefined, started: 0 } })
    setForm(blank())
  }

  const edit = (row: SharedServer) => {
    setState({ error: "", help: false, shown: false, saved: "", ai: { open: false, prompt: "", asking: false, reply: "", step: undefined, started: 0 } })
    setForm({ ...blank(), ...row, privateKey: "", keyName: "", password: "", confirm: "" })
  }

  const peek = async (serverId: number) => {
    if (state.shown) return setState("shown", false)
    if (state.saved) return setState("shown", true)
    const saved = await loadServerPassword(props.token, serverId, props.tenantId).catch((err) => {
      setState("error", fail(err))
      return ""
    })
    if (saved) setState({ shown: true, saved })
  }

  const watch = (row: SharedServer) => {
    setState({ watched: row, access: undefined, person: 0, error: "" })
    void loadServerAccess(props.token, row.serverId, props.tenantId)
      .then((rows) => setState("access", rows))
      .catch((err) => setState({ access: [], error: fail(err) }))
  }
  const people = createMemo(() =>
    (state.access ?? []).filter((row, index, all) => all.findIndex((item) => item.userId === row.userId) === index),
  )
  const stamp = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

  // A server's products and repos, grouped by product, each repo once.
  const groups = (serverId: number) =>
    state.products.flatMap((product) => {
      const repos = product.repos
        .filter((repo) => repo.serverId === serverId)
        .filter((repo, index, all) => all.findIndex((item) => item.definitionId === repo.definitionId) === index)
      return repos.length ? [{ product, repos }] : []
    })
  // The saved server, or the first one when there's none or it has been deleted.
  const chosen = createMemo(() => state.rows?.find((row) => row.serverId === view.server) ?? state.rows?.[0])
  const found = createMemo(() => {
    const text = state.find.trim().toLowerCase()
    return (state.rows ?? []).filter(
      (row) =>
        !text ||
        [
          row.name,
          row.shortName,
          row.sshHost,
          roleText(row),
          ...groups(row.serverId).map((group) => group.product.name),
          ...published(row.serverId).map((item) => item.product.name),
        ]
          .join(" ")
          .toLowerCase()
          .includes(text),
    )
  })
  // All of a product's repos, each once, wherever they're developed.
  const everyRepo = (product: ServerProduct) =>
    product.repos.filter(
      (repo, index, all) => all.findIndex((item) => item.definitionId === repo.definitionId) === index,
    )
  const current = (serverId: number) =>
    groups(serverId).flatMap((group) =>
      group.repos.map((repo) => ({
        productId: group.product.productId,
        definitionId: repo.definitionId,
        folder: repo.folder,
      })),
    )
  // Saves a server's whole set of pairs: EAD Pilot replaces what the server had. `then` runs before the list reloads.
  const put = (serverId: number, list: Pick[], then?: () => Promise<unknown>) => {
    if (list.some((row) => !row.folder.trim())) {
      setState("error", language.t("shared.folderRequired"))
      return Promise.resolve(false)
    }
    return run(async () => {
      await saveServerRepos(
        props.token,
        serverId,
        list.map((row) => ({ ...row, folder: row.folder.trim() })),
        props.tenantId,
      )
      await then?.()
    })
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

  const savePublish = (productId: number) =>
    saveProductPublish(
      props.token,
      productId,
      places.flatMap((environment) =>
        sides.flatMap((side) => {
          const row = select.publish[environment][side]
          return row.serverId ? [{ environment, side, ...row }] : []
        }),
      ),
      props.tenantId,
    )
  // The products publishing to a server, for its right panel and card.
  const published = (serverId: number) =>
    state.products.flatMap((product) =>
      product.publish.filter((item) => item.serverId === serverId).map((item) => ({ product, item })),
    )
  const roleText = (row: SharedServer) =>
    [
      row.useCoding ? language.t("shared.use.coding") : "",
      row.publishRole !== "none" ? language.t(`shared.use.${row.publishRole}`) : "",
    ]
      .filter(Boolean)
      .join(" · ")

  const pathOf = (server: SharedServer, repository: string) => {
    const sep = server.os === "windows" ? "\\" : "/"
    const root = server.rootFolder.replace(/[\\/]+$/, "")
    const name = repository.split("/").pop() ?? ""
    return root ? `${root}${sep}${name}` : name
  }
  const openProducts = (server: SharedServer) => {
    setState({ error: "", dropping: "" })
    setSelect({ server, step: "product", family: "", query: "", choice: undefined })
    // An empty list after a failure is read again the next time this opens.
    if (!select.groups?.length)
      void loadCatalog(props.token)
        .then((catalog) => setSelect("groups", catalog.groups))
        .catch((err) => {
          setSelect("groups", [])
          setState("error", fail(err))
        })
  }
  const setup = (server: SharedServer, product: { productId: number; name: string }, back: boolean) => {
    setState({ error: "", dropping: "" })
    const picked = Object.fromEntries(
      current(server.serverId)
        .filter((row) => row.productId === product.productId)
        .map((row) => [String(row.definitionId), row]),
    )
    const known = state.products.find((item) => item.productId === product.productId)
    const place = (environment: PublishPlace, side: PublishSide) => {
      const row = known?.publish.find((item) => item.environment === environment && item.side === side)
      return row ? { serverId: row.serverId, folder: row.folder, url: row.url } : blankPlace()
    }
    const placed = (environment: PublishPlace) => ({
      frontend: place(environment, "frontend"),
      backend: place(environment, "backend"),
    })
    // A product new to this server starts with its back-end repos ticked (those not coded on another server).
    if (server.useCoding && !Object.keys(picked).length)
      for (const repo of known?.repos ?? []) {
        if (repo.section !== "CURRENT" || repoEnd(repo.role) === "front") continue
        if (repo.serverId && repo.serverId !== server.serverId) continue
        picked[String(repo.definitionId)] = {
          productId: product.productId,
          definitionId: repo.definitionId,
          folder: pathOf(server, repo.repository),
        }
      }
    setSelect({
      server,
      step: server.useCoding ? "repos" : "publish",
      product: product.productId,
      name: product.name,
      back,
      picked,
      coding: remoteCoding(known, server.serverId),
      publish: { testing: placed("testing"), production: placed("production") },
      finding: false,
      found: {},
      candidates: {},
      findNote: "",
    })
  }
  const added = (productId: number) => {
    const server = select.server
    if (!server) return false
    return server.useCoding
      ? current(server.serverId).some((row) => row.productId === productId)
      : published(server.serverId).some((row) => row.product.productId === productId)
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
      ? [...teams, { name: server?.name || "", products: extra }]
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
      folder:
        select.found[key] ??
        (repo.serverId === server.serverId && repo.folder ? repo.folder : pathOf(server, repo.repository)),
    })
  }
  // EAD Pilot signs in to the server and finds where this product's repos are checked out (looking further when
  // the Default clone folder holds none). Ticked repos take the folder it found; a repo ticked later starts with it.
  // Repos it didn't find keep the folder they have. AI Help runs this first, then hands the checkouts to its agent.
  const searchServer = async (server: SharedServer) => {
    const result = await findRepoFolders(props.token, server.serverId, select.product, props.tenantId)
    const repos = listing().filter((repo) => !repo.serverId || repo.serverId === server.serverId)
    setSelect("found", result.matches)
    setSelect("candidates", result.candidates)
    for (const repo of repos) {
      const key = String(repo.definitionId)
      if (result.matches[key] && select.picked[key]) setSelect("picked", key, "folder", result.matches[key])
    }
    const missing = repos.filter((repo) => !result.matches[String(repo.definitionId)]).map((repo) => repo.name)
    const where = result.searched.join(", ") || server.rootFolder
    const note = !result.checkouts.length
      ? language.t("shared.findNoCheckouts", { folder: where })
      : missing.length
        ? language.t("shared.findSome", { found: repos.length - missing.length, total: repos.length, missing: missing.join(", ") })
        : language.t("shared.findAll", { total: repos.length })
    return { ...result, note }
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
    const keep = Object.keys(select.picked).length > 0
    const saved = await put(server.serverId, list, async () => {
      if (keep) await saveRemoteCoding(props.token, server.serverId, select.product, select.coding, props.tenantId)
      await savePublish(select.product)
    })
    if (saved) setSelect("server", undefined)
  }

  const ago = (at: number) => getRelativeTime(new Date(at).toISOString(), (key, params) => language.t(key, params))
  const os = (value: string) =>
    language.t(value === "mac" ? "shared.os.mac" : value === "linux" ? "shared.os.linux" : "shared.os.windows")
  const TypeTag = (view: { repo: ServerRepo }) => (
    <span
      class={`inline-block px-1.5 rounded text-[10px] leading-4 font-semibold whitespace-nowrap ${tones[repoEnd(view.repo.role)]}`}
    >
      {language.t(`shared.type.${repoEnd(view.repo.role)}`)}
    </span>
  )
  const input =
    "h-8 w-full min-w-0 px-2.5 rounded-md bg-surface-base border border-border-weak-base text-13-regular text-text-strong outline-none focus:border-border-interactive-base"
  const icon =
    "size-7 flex items-center justify-center rounded-md border border-border-weak-base text-icon-base hover:bg-surface-raised-base-hover disabled:opacity-50"
  const tag = "ml-2 px-1.5 rounded-full border border-border-weak-base text-11-regular text-text-weak"

  // One icon button in a server card's hover row; its name shows as a tooltip and to screen readers.
  const CardTool = (view: {
    action: string
    label: string
    disabled?: boolean
    onClick: () => void
    children: JSX.Element
  }) => (
    <button
      type="button"
      class="size-7 flex items-center justify-center rounded-md border border-border-strong-hover bg-surface-raised-stronger text-text-strong shadow-md hover:border-border-interactive-base hover:bg-surface-interactive-base hover:text-text-strong disabled:opacity-35 disabled:shadow-none [&_svg]:stroke-[1.75]"
      data-action={view.action}
      aria-label={view.label}
      title={view.label}
      disabled={view.disabled}
      onClick={(e) => {
        e.stopPropagation()
        view.onClick()
      }}
    >
      {view.children}
    </button>
  )

  // A popup over the list (the app shows one dialog at a time, so these open inside it).
  const Popup = (view: {
    title: string
    wide?: boolean
    /** Buttons at the right of the title, such as AI Help. */
    tools?: JSX.Element
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
        <div class="flex items-center gap-3">
          <span class="flex-1 min-w-0 truncate text-16-medium text-text-strong">{view.title}</span>
          {view.tools}
        </div>
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

  const Repo = (view: { repo: ServerRepo; coding?: boolean }) => (
    <span class="flex flex-col min-w-0">
      <span class="flex items-center gap-2 min-w-0">
        <span class="min-w-0 truncate text-13-regular text-text-strong">{view.repo.name || view.repo.repository}</span>
        <Show when={view.repo.section === "LEGACY"}>
          <span class={`${tag} !ml-0 shrink-0`}>{language.t("shared.legacy")}</span>
        </Show>
        <Show when={view.coding}>
          <span
            data-slot="shared-remote-tag"
            class="shrink-0 inline-flex items-center gap-0.5 pl-0.5 pr-1.5 rounded-full text-11-regular text-[#8b5cf6] bg-[#8b5cf6]/15"
          >
            <Icon name="check-small" size="small" />
            {language.t("shared.remoteTag")}
          </span>
        </Show>
      </span>
      <span class="text-12-regular text-text-weak font-mono truncate">
        {view.repo.repository}
        {view.repo.branch ? `@${view.repo.branch}` : ""}
      </span>
    </span>
  )

  const Fact = (view: { label: string; mono?: boolean; children: JSX.Element }) => (
    <>
      <span class="text-12-regular text-text-weak whitespace-nowrap">{view.label}</span>
      <span class="min-w-0 truncate text-13-regular text-text-strong" classList={{ "font-mono": !!view.mono }}>
        {view.children}
      </span>
    </>
  )

  // The chosen server: its details, then its applicable products and repos.
  const Detail = (view: { server: SharedServer }) => (
    <div data-slot="shared-detail" class="min-h-0 min-w-0 overflow-y-auto flex flex-col gap-3 p-4">
      <div data-slot="shared-detail-head" class="shrink-0 flex items-center gap-2">
        <span class="flex-1 min-w-0 truncate text-16-medium text-text-strong">{view.server.name}</span>
        <Show when={state.manage}>
          <Button
            type="button"
            variant="secondary"
            size="normal"
            class="shrink-0 !px-3 !border !border-solid !border-border-strong-base"
            data-action="shared-edit-server"
            disabled={state.busy}
            onClick={() => edit(view.server)}
          >
            {language.t("shared.editServer")}
          </Button>
          <button
            type="button"
            class={`${icon} shrink-0`}
            data-action="shared-delete-server"
            aria-label={language.t("shared.delete")}
            disabled={state.busy}
            onClick={() => setState({ doomed: view.server, error: "" })}
          >
            <Icon name="trash" size="small" />
          </button>
        </Show>
      </div>
      <Show when={view.server.note}>
        <p class="text-13-regular text-text-base whitespace-pre-wrap break-words">{view.server.note}</p>
      </Show>
      <div class="shrink-0 grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1">
        <Fact label={language.t("shared.col.host")}>{view.server.sshHost}</Fact>
        <Fact label={language.t("shared.col.os")}>{os(view.server.os)}</Fact>
        <Fact label={language.t("shared.col.login")}>
          {view.server.sshLogin}
          <Show when={view.server.authMethod === "key"}>
            <span class="text-text-weak"> · {language.t("shared.form.authKey")}</span>
          </Show>
        </Fact>
        <Fact label={language.t("shared.col.roles")}>{roleText(view.server)}</Fact>
        <Fact label={language.t("shared.col.access")}>
          {[
            view.server.sshEnabled ? `SSH (${view.server.sshPort})` : "",
            view.server.remoteControl ? `${language.t("shared.remoteControl")} (${view.server.remotePort})` : "",
          ]
            .filter(Boolean)
            .join(", ")}
        </Fact>
        <Fact label={language.t("shared.col.root")} mono>
          {view.server.rootFolder}
        </Fact>
      </div>
      <div data-slot="shared-pairs" class="flex flex-col gap-3 pt-3 border-t border-border-weak-base">
        <div class="flex items-center gap-3">
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
        <For
          each={groups(view.server.serverId)}
          fallback={
            <Show when={!published(view.server.serverId).length}>
              <p class="text-12-regular text-text-weak">{language.t("shared.pairsNone")}</p>
            </Show>
          }
        >
          {(group) => {
            const key = () => `${view.server.serverId}:${group.product.productId}`
            return (
              <div class="flex flex-col" data-product={group.product.productId}>
                <div class="flex items-center gap-2 pb-1.5">
                  <span class="flex-1 min-w-0 truncate text-14-medium text-text-strong">{group.product.name}</span>
                  <Show when={state.manage}>
                    <Button
                      type="button"
                      variant="secondary"
                      size="normal"
                      class="!px-3 !border !border-solid !border-border-strong-base"
                      data-action="shared-product-edit"
                      disabled={state.busy}
                      onClick={() => setup(view.server, group.product, false)}
                    >
                      {language.t("shared.editProduct")}
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
                <div data-slot="shared-publish-lines" class="flex flex-col gap-0.5 pb-2 text-12-regular text-text-base">
                  <For each={places}>
                    {(name) => (
                      <span class="truncate">
                        {language.t(`shared.publishLine.${name}`)}{" "}
                        {sides
                          .map((side) => {
                            const row = group.product.publish.find(
                              (item) => item.environment === name && item.side === side,
                            )
                            const server = state.rows?.find((item) => item.serverId === row?.serverId)
                            return `${language.t(sideNames[side])} - ${server?.name ?? language.t("shared.role.none")}`
                          })
                          .join(", ")}
                      </span>
                    )}
                  </For>
                </div>
                <span data-slot="shared-repos-label" class="pb-2 text-12-medium text-text-weak">
                  {language.t("shared.reposLabel")}
                </span>
                <For each={everyRepo(group.product)}>
                  {(repo) => {
                    const here = () => repo.serverId === view.server.serverId
                    const other = () =>
                      repo.serverId && !here() ? state.rows?.find((row) => row.serverId === repo.serverId) : undefined
                    return (
                      <div
                        data-repo={repo.definitionId}
                        class="grid grid-cols-[minmax(0,1fr)_72px_minmax(0,0.6fr)_minmax(0,1fr)] items-center gap-x-3 py-2 border-t border-border-weaker-base"
                      >
                        <Repo repo={repo} coding={here() && remoteCoding(group.product, view.server.serverId)} />
                        <span>
                          <TypeTag repo={repo} />
                        </span>
                        <span class="min-w-0 truncate text-12-regular text-text-weak">{repoSourceType(repo)}</span>
                        <Show
                          when={here()}
                          fallback={
                            <span class="min-w-0 truncate text-12-regular text-text-weak">
                              {other() ? language.t("shared.onOther", { name: other()!.name }) : ""}
                            </span>
                          }
                        >
                          <span class="min-w-0 break-all font-mono text-12-regular text-text-strong">
                            {repo.folder}
                          </span>
                        </Show>
                      </div>
                    )
                  }}
                </For>
              </div>
            )
          }}
        </For>
        <Show when={published(view.server.serverId).length}>
          <div data-slot="shared-published" class="flex flex-col">
            <span class="pb-1.5 text-13-medium text-text-strong">{language.t("shared.published")}</span>
            <For each={published(view.server.serverId)}>
              {(row) => (
                <div
                  data-product={row.product.productId}
                  class="grid grid-cols-[minmax(0,1fr)_130px_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-x-3 py-2 border-t border-border-weaker-base"
                >
                  <span class="truncate text-13-regular text-text-strong">{row.product.name}</span>
                  <span class="text-12-regular text-text-weak">
                    {language.t(`shared.role.${row.item.environment}`)} · {language.t(sideNames[row.item.side])}
                  </span>
                  <span class="min-w-0 break-all font-mono text-12-regular text-text-strong">{row.item.folder}</span>
                  <span class="min-w-0 truncate text-12-regular text-text-weak">{row.item.url}</span>
                  <Show when={state.manage}>
                    <Button
                      type="button"
                      variant="secondary"
                      size="normal"
                      class="!px-3 !border !border-solid !border-border-strong-base"
                      data-action="shared-publish-edit"
                      disabled={state.busy}
                      onClick={() => {
                        setup(view.server, row.product, false)
                        setSelect("step", "publish")
                      }}
                    >
                      {language.t("shared.editProduct")}
                    </Button>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
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
                    {other() ? language.t("shared.onOther", { name: other()!.name }) : ""}
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

  // A product's publish destinations, for testing and production and each end; each lists only the servers of that role.
  const placeGrid = "grid grid-cols-[176px_minmax(0,0.9fr)_minmax(0,1.3fr)_minmax(0,1fr)] items-center gap-x-3 px-1"
  const Places = () => (
    <div data-slot="shared-publish" class="flex flex-col gap-1.5">
      <div class="flex flex-col gap-0.5 pb-1">
        <span class="text-13-medium text-text-strong">{language.t("shared.publishTo")}</span>
        <span class="text-12-regular text-text-weak">{language.t("shared.publishHint")}</span>
      </div>
      <div class={`${placeGrid} text-12-medium text-text-weak`}>
        <span />
        <span>{language.t("shared.col.server")}</span>
        <span>{language.t("shared.col.publishTo")}</span>
        <span>{language.t("shared.col.url")}</span>
      </div>
      <For each={places}>
        {(name, index) => (
          <div class="flex flex-col gap-1.5" classList={{ "pt-2 mt-1 border-t border-border-weaker-base": index() > 0 }}>
            <For each={sides}>
              {(side) => (
                <div data-slot="shared-place" data-place={`${name}-${side}`} class={placeGrid}>
                  <span class="text-13-regular text-text-strong text-right whitespace-nowrap">
                    {language.t(`shared.place.${name}.${side}`)}
                  </span>
                  <select
                    class={input}
                    data-action={`shared-place-${name}-${side}`}
                    aria-label={language.t(`shared.place.${name}.${side}`)}
                    disabled={state.busy}
                    onChange={(e) => {
                      const serverId = Number(e.currentTarget.value)
                      setSelect("publish", name, side, {
                        serverId,
                        // Publish to starts blank: the clone folder is where code is, not where builds go.
                        folder: serverId ? select.publish[name][side].folder : "",
                        url: select.publish[name][side].url,
                      })
                    }}
                  >
                    <option value="0" selected={!select.publish[name][side].serverId}>
                      {language.t("shared.role.none")}
                    </option>
                    <For each={(state.rows ?? []).filter((row) => row.publishRole === name)}>
                      {(row) => (
                        <option value={row.serverId} selected={select.publish[name][side].serverId === row.serverId}>
                          {row.name}
                        </option>
                      )}
                    </For>
                  </select>
                  <input
                    class={`${input} font-mono`}
                    aria-label={`${language.t(`shared.place.${name}.${side}`)}: ${language.t("shared.col.publishTo")}`}
                    placeholder={select.publish[name][side].serverId ? language.t(`shared.publishTo.${side}`) : ""}
                    disabled={state.busy || !select.publish[name][side].serverId}
                    value={select.publish[name][side].folder}
                    onInput={(e) => setSelect("publish", name, side, "folder", e.currentTarget.value)}
                  />
                  <input
                    class={input}
                    aria-label={`${language.t(`shared.place.${name}.${side}`)}: ${language.t("shared.col.url")}`}
                    placeholder="https://"
                    disabled={state.busy || !select.publish[name][side].serverId}
                    value={select.publish[name][side].url}
                    onInput={(e) => setSelect("publish", name, side, "url", e.currentTarget.value)}
                  />
                </div>
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  )

  // AI Help in Setup Repos and Publishing: the open project's agent reads its deploy scripts and docs and suggests
  // each repo's source folder and where each build is published. The admin reviews it before Save.
  const [pai, setPai] = createStore({ ...idleAi(), prompt: "", open: false })
  const productRun = { controller: undefined as AbortController | undefined }
  const stopProductAi = () => productRun.controller?.abort()
  onCleanup(stopProductAi)
  const productInput = (): ProductAiInput => {
    const server = select.server
    const coding = select.step === "repos" && server ? server : undefined
    const placeOf = (place: PublishPlace, side: PublishSide) => {
      const row = select.publish[place][side]
      const host = state.rows?.find((item) => item.serverId === row.serverId)
      return { server: host?.name ?? "", folder: row.folder, url: row.url }
    }
    return {
      product: select.name,
      coding: coding ? { name: coding.name, os: coding.os, rootFolder: coding.rootFolder } : undefined,
      repos: listing()
        .filter((repo) => !repo.serverId || repo.serverId === server?.serverId)
        .map((repo) => ({
          definitionId: repo.definitionId,
          name: repo.name,
          repository: repo.repository,
          branch: repo.branch,
          end: endWords[repoEnd(repo.role)],
          folder: select.picked[String(repo.definitionId)]?.folder ?? select.found[String(repo.definitionId)],
          candidates: select.candidates[String(repo.definitionId)],
        })),
      servers: (state.rows ?? []).flatMap((row) =>
        row.publishRole === "none"
          ? []
          : [{ name: row.name, role: row.publishRole, os: row.os, host: row.sshHost, rootFolder: row.rootFolder, note: row.note }],
      ),
      publish: {
        testing: { frontend: placeOf("testing", "frontend"), backend: placeOf("testing", "backend") },
        production: { frontend: placeOf("production", "frontend"), backend: placeOf("production", "backend") },
      },
    }
  }
  const askProductAi = async () => {
    const ask = props.ask
    const prompt = pai.prompt.trim()
    const server = select.server
    if (!prompt || pai.asking || !server) return
    const controller = new AbortController()
    productRun.controller = controller
    const product = select.product
    setPai({ asking: true, reply: "", step: undefined, started: Date.now() })
    setState("error", "")
    // What EAD Pilot read from each server, shown with the answer or with the error, so a failure says how far it got.
    let readout = ""
    try {
      // First EAD Pilot looks on the coding server over SSH for where the repos are checked out.
      const coding = select.step === "repos" && server.sshEnabled
      let search: Awaited<ReturnType<typeof searchServer>> | undefined
      let searchError = ""
      if (coding) {
        setPai("step", { key: "server", value: server.name })
        search = await searchServer(server).catch((err) => {
          searchError = fail(err)
          return undefined
        })
        if (controller.signal.aborted || !select.server || select.product !== product) return
      }
      // Then EAD Pilot reads the sites and services on each testing and production server, all at once.
      const hosts = (state.rows ?? []).filter((row) => row.publishRole !== "none" && row.sshEnabled)
      let lists: ProductAiTargets[] = []
      if (hosts.length) {
        setPai("step", { key: "targets", value: hosts.map((row) => row.name).join(", ") })
        lists = await Promise.all(
          hosts.map((row) =>
            loadPublishTargets(props.token, row.serverId, props.tenantId).then(
              (targets): ProductAiTargets => ({ server: row.name, role: row.publishRole as PublishPlace, os: row.os, targets }),
              (err): ProductAiTargets => ({ server: row.name, role: row.publishRole as PublishPlace, os: row.os, error: fail(err) }),
            ),
          ),
        )
        if (controller.signal.aborted || !select.server || select.product !== product) return
      }
      const read = lists.filter((list) => list.targets)
      readout = [
        searchError ? language.t("shared.ai.searchFailed", { message: searchError }) : search?.note,
        ...read.map((list) => language.t("shared.ai.targetsFound", { name: list.server, count: list.targets!.length })),
        ...lists
          .filter((list) => list.error)
          .map((list) => language.t("shared.ai.targetsFailed", { name: list.server, message: list.error! })),
      ]
        .filter(Boolean)
        .join(" ")
      // Without an open project there is no model to choose: what was found is the answer.
      if (!ask) {
        const found = read.map((list) => language.t("shared.ai.targetsFound", { name: list.server, count: list.targets!.length }))
        setPai("reply", [search?.note || searchError, ...found, language.t("shared.ai.needsProject")].filter(Boolean).join(" "))
        return
      }
      const input = { ...productInput(), checkouts: search?.checkouts, searched: search?.searched }
      // With the servers read, the model only chooses among what is there; otherwise it reads the deploy scripts.
      const answer = read.length
        ? (setPai("step", {
            key: "pick",
            value: read.map((list) => language.t("shared.ai.targetsCount", { name: list.server, count: list.targets!.length })).join(", "),
          }),
          await ask(productPickPrompt(prompt, input, lists), controller.signal, undefined, { quick: true }))
        : await ask(productPrompt(prompt, input), controller.signal, (step) => setPai("step", step))
      const result = parseProductReply(answer, input)
      // A popup closed, or switched to another product, while AI Help looked is left as it is.
      if (controller.signal.aborted || !select.server || select.product !== product) return
      for (const [key, folder] of Object.entries(result.repos)) {
        setSelect("found", key, folder)
        if (select.picked[key]) setSelect("picked", key, "folder", folder)
      }
      for (const place of places)
        for (const side of sides) {
          const row = result.publish[place]?.[side]
          if (!row) continue
          if (row.server === "") {
            setSelect("publish", place, side, blankPlace())
            continue
          }
          const serverId =
            row.server !== undefined
              ? ((state.rows ?? []).find((item) => item.publishRole === place && item.name === row.server)?.serverId ?? 0)
              : select.publish[place][side].serverId
          if (!serverId) continue
          setSelect("publish", place, side, {
            serverId,
            folder: row.folder ?? select.publish[place][side].folder,
            url: row.url ?? select.publish[place][side].url,
          })
        }
      const changed = Object.keys(result.repos).length + Object.keys(result.publish).length
      const said = result.reply || language.t(changed ? "shared.ai.productFilled" : "shared.ai.nothing")
      setPai("reply", [readout, said].filter(Boolean).join(" "))
    } catch (err) {
      if (select.server) setState("error", [readout, fail(err)].filter(Boolean).join(" "))
    } finally {
      if (productRun.controller === controller) productRun.controller = undefined
      setPai("asking", false)
    }
  }
  const productAiButton = () => (
    <Show when={true}>
      <Button
        type="button"
        variant="secondary"
        size="normal"
        class="shrink-0 !px-3 !border !border-solid"
        classList={{
          "!border-border-interactive-base !text-text-strong": pai.open,
          "!border-border-strong-base": !pai.open,
        }}
        data-action="shared-product-ai-help"
        aria-pressed={pai.open}
        disabled={state.busy}
        onClick={() => setPai("open", !pai.open)}
      >
        <Icon name="brain" size="small" />
        {language.t("shared.ai.button")}
      </Button>
    </Show>
  )
  const ProductAi = () => (
    <Show when={pai.open}>
      <AiPanel
        slot="shared-product-ai-help"
        title={language.t("shared.ai.productTitle")}
        placeholder={language.t("shared.ai.productPlaceholder")}
        ai={pai}
        onPrompt={(value) => setPai("prompt", value)}
        onAsk={() => void askProductAi()}
        onStop={stopProductAi}
      />
    </Show>
  )
  // Each product opened starts with AI Help closed and empty.
  createEffect(
    on(
      () => [select.server?.serverId, select.product] as const,
      () => {
        stopProductAi()
        // It starts ready to run: the usual request is already written.
        setPai({
          ...idleAi(),
          prompt: language.t(select.step === "publish" ? "shared.ai.publishDefault" : "shared.ai.productDefault"),
          open: false,
        })
      },
    ),
  )

  return (
    <Dialog
      title={language.t("shared.title")}
      size="x-large"
      sticky
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
          <Show when={state.manage}>
            <Button
              type="button"
              variant="secondary"
              size="normal"
              class="shrink-0 !px-3 !border !border-solid !border-border-strong-base"
              data-action="shared-new-server"
              disabled={state.busy}
              onClick={openNew}
            >
              <Icon name="plus-small" size="small" />
              {language.t("shared.newServer")}
            </Button>
          </Show>
          <button
            type="button"
            data-action="shared-help"
            aria-label={language.t("shared.help")}
            class="size-6 shrink-0 rounded-full border border-border-strong-base text-12-medium text-text-weak hover:text-text-strong hover:border-border-interactive-base"
            onClick={() => setState("help", !state.help)}
          >
            ?
          </button>
        </>
      }
    >
      <div data-component="dialog-shared-servers" class="relative flex-1 min-h-0 flex flex-col gap-3 px-6 pb-6">
        <Show when={state.help}>
          <div
            data-slot="shared-help-tip"
            role="note"
            class="absolute top-0 right-6 z-40 w-[min(520px,calc(100%-3rem))] p-3 flex flex-col gap-1.5 rounded-md border border-border-strong-base bg-surface-raised-stronger shadow-[0_12px_32px_rgba(0,0,0,0.5)] text-13-regular text-text-strong cursor-pointer"
            onClick={() => setState("help", false)}
          >
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

        <Show
          // Cards wait for the saved view, so the saved server is the first one shown.
          when={state.rows && (!props.userId || !props.tenantId || state.view)}
          fallback={<Spinner class="size-4 m-auto" />}
        >
          <Show
            when={state.rows!.length}
            fallback={<p class="m-auto text-13-regular text-text-weak">{language.t("shared.empty")}</p>}
          >
            <div class="flex-1 min-h-0 grid grid-cols-[260px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] rounded-md border border-border-weak-base overflow-hidden">
              <div class="min-h-0 flex flex-col gap-2 p-3 border-r border-border-weak-base bg-surface-base">
                <div class="shrink-0 flex items-center gap-1.5">
                  <input
                    class={input}
                    data-action="shared-find"
                    aria-label={language.t("shared.find")}
                    placeholder={language.t("shared.find")}
                    value={state.find}
                    onInput={(e) => setState("find", e.currentTarget.value)}
                  />
                  <Show when={state.manage}>
                    <button
                      type="button"
                      class={`${icon} !size-8 shrink-0`}
                      data-action="shared-new"
                      aria-label={language.t("shared.new")}
                      onClick={openNew}
                    >
                      <Icon name="plus-small" size="small" />
                    </button>
                  </Show>
                </div>
                <div class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5">
                  <For
                    each={found()}
                    fallback={<p class="p-2 text-13-regular text-text-weak">{language.t("shared.findNone")}</p>}
                  >
                    {(row) => (
                      <div
                        data-slot="shared-card"
                        data-row={row.serverId}
                        class="group relative shrink-0 rounded-md border"
                        classList={{
                          "bg-surface-interactive-weak border-border-interactive-base shadow-[0_0_0_1px_var(--border-interactive-base)]":
                            chosen()?.serverId === row.serverId,
                          "bg-background-base border-border-weak-base hover:bg-surface-raised-base-hover":
                            chosen()?.serverId !== row.serverId,
                        }}
                      >
                        <button
                          type="button"
                          data-action="shared-card"
                          aria-pressed={chosen()?.serverId === row.serverId}
                          class="w-full px-3 pt-2 flex flex-col gap-0.5 text-left"
                          onClick={() => {
                            setView("server", row.serverId)
                            keep()
                          }}
                        >
                          <span class="truncate text-13-medium text-text-strong">{row.name}</span>
                          <span class="truncate text-12-regular text-text-weak">{os(row.os)}</span>
                          <span class="truncate text-12-regular text-text-weak font-mono">
                            {row.sshHost}:{row.sshPort}
                          </span>
                          <span class="truncate text-12-regular text-text-weak">{roleText(row)}</span>
                          <Show when={row.note && ![row.name, row.shortName].includes(row.note.trim())}>
                            <span class="line-clamp-2 whitespace-pre-wrap break-words text-12-regular text-text-base">
                              {row.note}
                            </span>
                          </Show>
                          <span class="truncate text-12-regular text-text-weak">
                            {[
                              ...new Set([
                                ...groups(row.serverId).map((group) => group.product.name),
                                ...published(row.serverId).map((item) => item.product.name),
                              ]),
                            ].join(", ") || language.t("shared.pairsNone")}
                          </span>
                        </button>
                        <button
                          type="button"
                          data-action="shared-activity"
                          class="w-full px-3 pt-0.5 pb-2 truncate text-left text-12-regular text-text-weak hover:text-text-strong hover:underline"
                          onClick={() => watch(row)}
                        >
                          {row.lastAt
                            ? language.t("shared.lastActive", { name: row.lastUser, time: ago(row.lastAt) })
                            : language.t("shared.noActivity")}
                        </button>
                        <Show when={state.manage}>
                          {/* Shown while the pointer is on the card or a button in it has focus. */}
                          <div
                            data-slot="shared-card-tools"
                            class="absolute top-1.5 right-1.5 hidden group-hover:flex group-focus-within:flex items-center gap-1"
                          >
                            <CardTool
                              action="shared-edit"
                              label={language.t("shared.edit")}
                              disabled={state.busy}
                              onClick={() => edit(row)}
                            >
                              <Icon name="pencil-line" size="normal" />
                            </CardTool>
                            <CardTool
                              action="shared-delete"
                              label={language.t("shared.delete")}
                              disabled={state.busy}
                              onClick={() => setState({ doomed: row, error: "" })}
                            >
                              <Icon name="trash" size="small" />
                            </CardTool>
                            <CardTool
                              action="shared-move-up"
                              label={language.t("shared.moveUp")}
                              disabled={state.busy || !neighbor(row, -1)}
                              onClick={() => void move(row, -1)}
                            >
                              <Icon name="chevron-down" size="small" class="rotate-180" />
                            </CardTool>
                            <CardTool
                              action="shared-move-down"
                              label={language.t("shared.moveDown")}
                              disabled={state.busy || !neighbor(row, 1)}
                              onClick={() => void move(row, 1)}
                            >
                              <Icon name="chevron-down" size="small" />
                            </CardTool>
                          </div>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </div>
              <Show when={chosen()}>{(row) => <Detail server={row()} />}</Show>
            </div>
          </Show>
        </Show>
      </div>

      <Show when={form()}>
        {(draft) => (
          <Popup
            title={language.t(draft().serverId ? "shared.editTitle" : "shared.newTitle")}
            onClose={() => {
              stopAi()
              setForm(undefined)
            }}
            tools={
              <Button
                type="button"
                variant="secondary"
                size="normal"
                class="shrink-0 !px-3 !border !border-solid"
                classList={{
                  "!border-border-interactive-base !text-text-strong": state.ai.open,
                  "!border-border-strong-base": !state.ai.open,
                }}
                data-action="shared-ai-help"
                aria-pressed={state.ai.open}
                disabled={state.busy}
                onClick={() => setState("ai", "open", !state.ai.open)}
              >
                <Icon name="brain" size="small" />
                {language.t("shared.ai.button")}
              </Button>
            }
            footer={
              state.ai.asking ? (
                <AiFooter started={state.ai.started} step={state.ai.step} onStop={stopAi} />
              ) : (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="large"
                  disabled={state.busy}
                  onClick={() => {
                    stopAi()
                    setForm(undefined)
                  }}
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
              )
            }
          >
            <Show when={state.ai.open}>
              <AiPanel
                slot="shared-ai-help"
                title={language.t("shared.ai.title")}
                placeholder={language.t("shared.ai.placeholder")}
                ai={state.ai}
                onPrompt={(value) => setState("ai", "prompt", value)}
                onAsk={() => void askAi()}
                onStop={stopAi}
              />
            </Show>
            <div class="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-x-4 gap-y-2.5">
              <Field label={language.t("shared.form.name")}>
                <input
                  class={input}
                  maxLength={20}
                  value={draft().name}
                  onInput={(e) => setForm({ ...draft(), name: e.currentTarget.value })}
                />
              </Field>
              <Field label={language.t("shared.col.os")}>
                <For each={["windows", "mac", "linux"] as const}>
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
                            remotePort: Object.values(remotePorts).includes(draft().remotePort)
                              ? remotePorts[value]
                              : draft().remotePort,
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
              </Field>
              <Field label={language.t("shared.col.ssh")}>
                <Checkbox
                  data-action="shared-enable-ssh"
                  checked={draft().sshEnabled}
                  onChange={(on) => setForm({ ...draft(), sshEnabled: on })}
                >
                  <span class="text-13-regular text-text-strong whitespace-nowrap">
                    {language.t("shared.enableSsh")}
                  </span>
                </Checkbox>
                <span class="ml-auto shrink-0 text-13-regular text-text-weak">{language.t("shared.form.port")}</span>
                <input
                  class={`${input} !w-24 shrink-0`}
                  inputMode="numeric"
                  disabled={!draft().sshEnabled}
                  value={String(draft().sshPort)}
                  onInput={(e) => setForm({ ...draft(), sshPort: Number(e.currentTarget.value) || 0 })}
                />
              </Field>
              <Field label={language.t("shared.remoteControl")}>
                <Checkbox
                  data-action="shared-enable-remote"
                  checked={draft().remoteControl}
                  onChange={(on) => setForm({ ...draft(), remoteControl: on })}
                >
                  <span class="text-13-regular text-text-strong whitespace-nowrap">
                    {language.t("shared.enableRemote")}
                  </span>
                </Checkbox>
                <span class="ml-auto shrink-0 text-13-regular text-text-weak">
                  {language.t("shared.form.remotePort")}
                </span>
                <input
                  class={`${input} !w-24 shrink-0`}
                  inputMode="numeric"
                  data-action="shared-remote-port"
                  disabled={!draft().remoteControl}
                  value={String(draft().remotePort)}
                  onInput={(e) => setForm({ ...draft(), remotePort: Number(e.currentTarget.value) || 0 })}
                />
              </Field>
              <Field label={language.t("shared.col.login")}>
                <input
                  class={input}
                  value={draft().sshLogin}
                  onInput={(e) => setForm({ ...draft(), sshLogin: e.currentTarget.value })}
                />
              </Field>
              <Field label={language.t("shared.form.signIn")}>
                <For each={["password", "key"] as const}>
                  {(value) => (
                    <label class="inline-flex items-center gap-1.5 text-13-regular text-text-strong whitespace-nowrap">
                      <input
                        type="radio"
                        name="shared-auth"
                        data-action={`shared-auth-${value}`}
                        checked={draft().authMethod === value}
                        onChange={() => {
                          setState({ shown: false, saved: "" })
                          setForm({ ...draft(), authMethod: value, password: "", confirm: "" })
                        }}
                      />
                      {language.t(value === "key" ? "shared.form.authKey" : "shared.form.authPassword")}
                    </label>
                  )}
                </For>
              </Field>
              <Show
                when={draft().authMethod === "key"}
                fallback={
                  <Field label={language.t("shared.form.password")}>
                    <div class="relative flex-1 min-w-0">
                      <input
                        class={`${input} pr-8`}
                        type={state.shown ? "text" : "password"}
                        placeholder={draft().serverId ? (state.shown ? state.saved : "*******") : ""}
                        value={draft().password}
                        onInput={(e) => setForm({ ...draft(), password: e.currentTarget.value })}
                      />
                      <Show when={draft().serverId && (draft() as Form & Partial<SharedServer>).canViewPassword}>
                        <button
                          type="button"
                          data-action="shared-password-eye"
                          aria-label={language.t("shared.form.showPassword")}
                          aria-pressed={state.shown}
                          class="absolute right-1 top-1 size-6 flex items-center justify-center rounded-md text-icon-base hover:bg-surface-raised-base-hover"
                          onClick={() => void peek(draft().serverId!)}
                        >
                          <Icon name="eye" size="small" />
                        </button>
                      </Show>
                    </div>
                    <input
                      class={`${input} flex-1`}
                      type={state.shown ? "text" : "password"}
                      placeholder={language.t("shared.form.confirm")}
                      value={draft().confirm}
                      onInput={(e) => setForm({ ...draft(), confirm: e.currentTarget.value })}
                    />
                  </Field>
                }
              >
                <Field label={language.t("shared.form.keyFile")}>
                  <label
                    data-action="shared-key-file"
                    class="shrink-0 h-8 px-3 inline-flex items-center rounded-md border border-border-base bg-surface-raised-base text-13-medium text-text-strong cursor-pointer hover:bg-surface-raised-base-hover"
                  >
                    {language.t("shared.form.chooseKey")}
                    <input
                      type="file"
                      class="hidden"
                      onChange={async (e) => {
                        const file = e.currentTarget.files?.[0]
                        e.currentTarget.value = ""
                        if (!file) return
                        // Read here and sent only when saved; EAD Pilot keeps it encrypted and never sends it back.
                        const text = file.size <= 16_000 ? await file.text().catch(() => "") : ""
                        if (!/PRIVATE KEY-----|^PuTTY-User-Key-File/m.test(text))
                          return setState("error", language.t("shared.form.keyUnreadable"))
                        setState("error", "")
                        setForm({ ...draft(), privateKey: text, keyName: file.name })
                      }}
                    />
                  </label>
                  <span class="min-w-0 truncate text-13-regular text-text-weak" data-slot="shared-key-state">
                    {draft().keyName
                      ? language.t("shared.form.keyLoaded", { name: draft().keyName! })
                      : draft().hasKey && state.rows?.find((row) => row.serverId === draft().serverId)?.authMethod === "key"
                        ? language.t("shared.form.keySaved")
                        : language.t("shared.form.keyNone")}
                  </span>
                </Field>
                <Field label={language.t("shared.form.passphrase")}>
                  <input
                    class={input}
                    type="password"
                    autocomplete="off"
                    data-action="shared-key-passphrase"
                    placeholder={language.t("shared.form.passphraseHint")}
                    value={draft().password}
                    onInput={(e) => setForm({ ...draft(), password: e.currentTarget.value, confirm: e.currentTarget.value })}
                  />
                </Field>
              </Show>
              <Field label={language.t("shared.col.root")}>
                <input
                  class={`${input} font-mono`}
                  placeholder={folders[draft().os]}
                  value={draft().rootFolder}
                  onInput={(e) => setForm({ ...draft(), rootFolder: e.currentTarget.value })}
                />
              </Field>
              <span class="self-start pt-1.5 text-13-regular text-text-weak">{language.t("shared.note")}</span>
              <textarea
                class={`${input} !h-auto py-1.5 resize-none`}
                data-action="shared-note"
                rows={3}
                maxLength={1000}
                value={draft().note}
                onInput={(e) => setForm({ ...draft(), note: e.currentTarget.value })}
              />
              <Field label={language.t("shared.useCoding")}>
                <Checkbox
                  data-action="shared-use-coding"
                  checked={draft().useCoding}
                  onChange={(on) => setForm({ ...draft(), useCoding: on })}
                >
                  <span class="text-13-regular text-text-strong whitespace-nowrap">
                    {language.t("shared.remoteCoding")}
                  </span>
                </Checkbox>
              </Field>
              <Field label={language.t("shared.usePublish")}>
                <select
                  class={`${input} !w-40`}
                  data-action="shared-use-publish"
                  aria-label={language.t("shared.usePublish")}
                  onChange={(e) =>
                    setForm({ ...draft(), publishRole: e.currentTarget.value as SharedServer["publishRole"] })
                  }
                >
                  <For each={roles}>
                    {(role) => (
                      <option value={role} selected={draft().publishRole === role}>
                        {language.t(`shared.role.${role}`)}
                      </option>
                    )}
                  </For>
                </select>
              </Field>
            </div>
          </Popup>
        )}
      </Show>

      <Show when={state.doomed}>
        {(row) => (
          <Popup
            title={language.t("shared.deleteTitle", { name: row().name })}
            onClose={() => setState("doomed", undefined)}
            footer={
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="large"
                  disabled={state.busy}
                  onClick={() => setState("doomed", undefined)}
                >
                  {language.t("common.cancel")}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="large"
                  data-action="shared-delete-ok"
                  disabled={state.busy}
                  onClick={() => void remove()}
                >
                  {language.t("shared.delete")}
                </Button>
              </>
            }
          >
            <p class="text-13-regular text-text-base">{language.t("shared.deleteBody")}</p>
          </Popup>
        )}
      </Show>

      <Show when={state.watched}>
        {(row) => (
          <Popup
            wide
            title={language.t("shared.activityTitle", { name: row().name })}
            onClose={() => setState("watched", undefined)}
            footer={
              <Button type="button" variant="primary" size="large" onClick={() => setState("watched", undefined)}>
                {language.t("common.close")}
              </Button>
            }
          >
            <Show when={state.access} fallback={<Spinner class="size-4 m-2" />}>
              <Show
                when={state.access!.length}
                fallback={<p class="text-13-regular text-text-weak">{language.t("shared.noActivity")}</p>}
              >
                <select
                  class={`${input} shrink-0 !w-60`}
                  data-action="shared-person"
                  aria-label={language.t("shared.col.person")}
                  onChange={(e) => setState("person", Number(e.currentTarget.value))}
                >
                  <option value="0" selected={state.person === 0}>
                    {language.t("shared.everyone")}
                  </option>
                  <For each={people()}>
                    {(item) => (
                      <option value={item.userId} selected={state.person === item.userId}>
                        {item.userName}
                      </option>
                    )}
                  </For>
                </select>
                <div class="min-h-0 overflow-y-auto">
                  <div class="grid grid-cols-[minmax(0,1fr)_170px_170px_90px] gap-x-3 px-1 pb-1.5 border-b border-border-weaker-base text-12-medium text-text-weak">
                    <span>{language.t("shared.col.person")}</span>
                    <span>{language.t("shared.col.started")}</span>
                    <span>{language.t("shared.col.last")}</span>
                    <span class="text-right">{language.t("shared.col.connections")}</span>
                  </div>
                  <For each={state.access!.filter((item) => !state.person || item.userId === state.person)}>
                    {(item) => (
                      <div
                        data-slot="shared-access"
                        class="grid grid-cols-[minmax(0,1fr)_170px_170px_90px] items-center gap-x-3 min-h-9 px-1 border-b border-border-weaker-base text-13-regular text-text-strong"
                      >
                        <span class="truncate">{item.userName}</span>
                        <span>{stamp(item.startedAt)}</span>
                        <span>{stamp(item.endedAt)}</span>
                        <span class="text-right">{item.logins}</span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
            <p class="text-12-regular text-text-weak">{language.t("shared.activityHint")}</p>
          </Popup>
        )}
      </Show>

      <Show when={select.server && select.step === "product" ? select.server : undefined}>
        {(server) => (
          <Popup
            title={language.t("shared.selectProductTitle", { name: server().name })}
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

      <Show when={select.server && select.step === "publish"}>
        <Popup
          wide
          title={language.t("shared.publishTitle", { product: select.name })}
          tools={productAiButton()}
          onClose={() => setSelect("server", undefined)}
          footer={
            pai.asking ? (
              <AiFooter started={pai.started} step={pai.step} onStop={stopProductAi} />
            ) : (
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
                data-action="shared-publish-save"
                disabled={state.busy}
                onClick={() =>
                  void run(() => savePublish(select.product)).then((ok) => ok && setSelect("server", undefined))
                }
              >
                {language.t("common.save")}
              </Button>
            </>
            )
          }
        >
          <ProductAi />
          <Places />
        </Popup>
      </Show>

      <Show when={select.server && select.step === "repos" ? select.server : undefined}>
        {(server) => (
          <Popup
            wide
            title={language.t("shared.setupTitle", { product: select.name, name: server().name })}
            tools={productAiButton()}
            onClose={() => setSelect("server", undefined)}
            footer={
              pai.asking ? (
                <AiFooter started={pai.started} step={pai.step} onStop={stopProductAi} />
              ) : (
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
              )
            }
          >
            <ProductAi />
            <div data-slot="shared-access" class="pb-3 border-b border-border-weak-base">
              <Checkbox
                data-action="shared-remote-coding"
                checked={select.coding}
                disabled={state.busy}
                onChange={(on) => setSelect("coding", on)}
              >
                <span class="text-13-regular text-text-strong">{language.t("shared.remoteCoding")}</span>
              </Checkbox>
            </div>
            <div data-slot="shared-repos" class="flex flex-col pb-3 border-b border-border-weak-base">
              <span data-slot="shared-repo-hint" class="pb-2 text-12-regular text-text-weak">
                {language.t(server().sshEnabled ? "shared.repoHint" : "shared.repoHintNoSsh", { name: server().name })}
              </span>
              <Repos />
            </div>
            <Places />
          </Popup>
        )}
      </Show>
    </Dialog>
  )
}

/**
 * The line under AI Help's description while it works: a spinner, how long it has looked, and what it is doing now
 * (the file it reads, the text it searches for), so a minute of searching never looks stuck.
 */
function AiProgress(props: { started: number; step?: RemoteDevStep; label?: string }) {
  const language = useLanguage()
  const [now, setNow] = createSignal(Date.now())
  const tick = setInterval(() => setNow(Date.now()), 1_000)
  onCleanup(() => clearInterval(tick))
  const elapsed = () => {
    const seconds = Math.max(0, Math.floor((now() - props.started) / 1000))
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
  }
  const doing = () => {
    const step = props.step
    if (!step) return language.t("shared.ai.step.start")
    return language.t(`shared.ai.step.${step.key}`, { value: step.value })
  }
  return (
    <div class="flex items-start gap-2 text-12-regular" data-slot="shared-ai-progress" aria-live="polite">
      <Spinner class="size-4 shrink-0 mt-px" />
      <div class="min-w-0 flex-1 flex flex-col">
        <span class="text-text-strong">
          {props.label ?? language.t("shared.ai.analyzing")} <span class="tabular-nums text-text-weak">{elapsed()}</span>
        </span>
        <span class="truncate text-text-weak" data-slot="shared-ai-step">{doing()}</span>
      </div>
    </div>
  )
}

/** AI Help's state in a form: its description, whether it is working, and its answer. */
type AiState = { prompt: string; asking: boolean; reply: string; step?: RemoteDevStep; started: number }
const idleAi = (): AiState => ({ prompt: "", asking: false, reply: "", step: undefined, started: 0 })

/**
 * AI Help's panel at the top of a form: the one-line title with Fill in (Stop while it works), the description, then
 * the progress line while it works and its answer after.
 */
function AiPanel(props: {
  slot: string
  title: string
  placeholder: string
  ai: AiState
  onPrompt: (value: string) => void
  onAsk: () => void
  onStop: () => void
}) {
  const language = useLanguage()
  return (
    <div
      data-slot={props.slot}
      class="mb-3 p-3 flex flex-col gap-2 rounded-md border border-border-interactive-base bg-surface-interactive-weak"
    >
      <div class="flex items-center gap-3">
        <span class="flex-1 min-w-0 text-13-medium text-text-strong">{props.title}</span>
        <Button
          type="button"
          variant="primary"
          size="normal"
          class="shrink-0"
          data-action={props.ai.asking ? "shared-ai-stop" : "shared-ai-ask"}
          disabled={!props.ai.asking && !props.ai.prompt.trim()}
          onClick={() => (props.ai.asking ? props.onStop() : props.onAsk())}
        >
          <Show when={props.ai.asking}>
            <Spinner class="size-4" />
          </Show>
          {language.t(props.ai.asking ? "shared.ai.stop" : "shared.ai.fill")}
        </Button>
      </div>
      <textarea
        class="w-full min-w-0 min-h-16 px-2.5 py-2 rounded-md border border-border-weak-base bg-surface-base text-13-regular text-text-strong outline-none focus:border-border-interactive-base resize-y"
        data-action="shared-ai-prompt"
        placeholder={props.placeholder}
        value={props.ai.prompt}
        disabled={props.ai.asking}
        onInput={(e) => props.onPrompt(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) props.onAsk()
        }}
      />
      <Show when={props.ai.asking}>
        <AiProgress started={props.ai.started} step={props.ai.step} />
      </Show>
      <Show when={!props.ai.asking && props.ai.reply}>
        <span class="text-12-regular text-text-base" data-slot="shared-ai-reply">
          {props.ai.reply}
        </span>
      </Show>
    </div>
  )
}

/**
 * The form's bottom bar while AI Help works: Save and Cancel make way for what it is doing and one Cancel, which stops
 * AI Help and keeps the form open as it was.
 */
function AiFooter(props: { started: number; step?: RemoteDevStep; onStop: () => void }) {
  const language = useLanguage()
  return (
    <div class="w-full flex items-center gap-3" data-slot="shared-ai-footer">
      <div class="min-w-0 flex-1">
        <AiProgress started={props.started} step={props.step} label={language.t("shared.ai.working")} />
      </div>
      <Button type="button" variant="secondary" size="large" data-action="shared-ai-cancel" onClick={props.onStop}>
        {language.t("common.cancel")}
      </Button>
    </div>
  )
}
