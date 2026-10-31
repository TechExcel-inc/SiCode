import { For, Show, createEffect, createMemo, on, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useLanguage } from "@/context/language"
import {
  children,
  denied,
  login,
  owners,
  memory,
  remember,
  origin,
  pin,
  pins,
  projects,
  requirements,
  root,
  space,
  states,
  type Folder,
  type Group,
  type Pins,
  type Project,
  type Row,
  type Space,
} from "@/p1/api"
import { useP1 } from "@/p1/settings"
import { P1Item } from "./p1-item"
import { P1Folder } from "./p1-folder"
import { P1Columns } from "./p1-columns"
import { P1Stories } from "./p1-stories"
import { P1Inline, prime } from "./p1-inline"
import { P1Filter } from "./p1-filter"
import { P1Group } from "./p1-group"
import { P1Prefs, tint } from "./p1-prefs"
import { keep as prefer, plain, prefs, type Prefs } from "@/p1/prefs"
import { FolderType, Panel, SpecIcon, typed } from "./p1-icons"
import { P1Workload } from "./p1-workload"
import { P1Attach } from "./p1-attach"
import { useOpener } from "./p1-files"
import { specIcon } from "@/p1/files"
import { Tip } from "./p1-tip"
import { period, scores, standing, summary, type Scope } from "@/p1/workload"
import { active, blank, bucket, month, type Filter, type Status } from "@/p1/filter"
import { members, type Choice } from "@/p1/points"
import { columns, fallback, keep, type Column } from "@/p1/columns"
import { access, roadmap, type Place, type Shape } from "@/p1/folder"
import { fixedField, warm } from "@/p1/form"

const field =
  "h-9 w-full px-3 rounded-lg bg-surface-base border border-border-weaker-base text-13-regular text-text-strong placeholder:text-text-weak outline-none focus:border-border-interactive-base"

const tabs = ["requirements", "development", "test", "defects"] as const

/** P1's requirement right-click menu, in its order; the rest come one by one. */
const actions = [
  { key: "new", icon: "plus-small", ready: true },
  { key: "ai", icon: "brain", ready: false },
  { key: "shortcut", icon: "link", ready: false },
  { key: "livedoc", icon: "open-file", ready: false },
  { key: "present", icon: "window-cursor", ready: false },
  { key: "edit", icon: "edit", ready: true },
  { key: "copy", icon: "copy", ready: false },
  { key: "delete", icon: "trash", ready: false },
  { key: "move", icon: "arrow-right", ready: false },
  { key: "development", icon: "code", ready: false },
  { key: "management", icon: "task", ready: false },
  { key: "export", icon: "download", ready: false },
  { key: "share", icon: "share", ready: false },
  { key: "workflow", icon: "branch", ready: false },
  { key: "customize", icon: "sliders", ready: true },
] as const

export function P1Work() {
  const p1 = useP1()
  let hover: ReturnType<typeof setTimeout> | undefined
  let pane: HTMLElement | undefined
  // The docked editor's width: what you dragged it to, from 300px up to leaving the list 200px.
  const dock = () => {
    const px = state.span ?? p1.width("panel") ?? 420
    return Math.max(300, Math.min(px, (pane?.clientWidth ?? 1200) - 200))
  }
  const stretch = (event: PointerEvent) => {
    event.preventDefault()
    const start = event.clientX
    const from = dock()
    const move = (next: PointerEvent) => setState("span", Math.round(from + start - next.clientX))
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", up)
      if (state.span !== undefined) p1.size("panel", dock())
      setState("span", undefined)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
  }
  // Where the dragged header would land: a line on the left of the column at that slot, or the right of the last.
  const slot = (col: Column) => {
    const drag = state.move
    if (!drag) return
    const from = state.cols.findIndex((item) => item.id === drag.id)
    if (drag.to === from || drag.to === from + 1) return
    const at = state.cols.findIndex((item) => item.id === col.id)
    if (drag.to === at) return "left"
    if (drag.to === state.cols.length && at === state.cols.length - 1) return "right"
  }
  const move = (event: PointerEvent, col: Column) => {
    if (event.button !== 0) return
    const start = event.clientX
    const target = event.currentTarget as HTMLElement
    const row = target.parentElement
    const pane = target.closest<HTMLElement>("[data-scroll]")
    if (!row || !pane) return
    target.setPointerCapture(event.pointerId)
    // A lifted copy of the whole column that follows the pointer.
    const lift = () => {
      const head = target.getBoundingClientRect()
      const box = pane.getBoundingClientRect()
      const ghost = document.createElement("div")
      ghost.className =
        "fixed z-50 pointer-events-none overflow-hidden rounded-md bg-background-base shadow-lg-border-base opacity-95 cursor-grabbing"
      Object.assign(ghost.style, {
        left: `${head.left}px`,
        top: `${head.top}px`,
        width: `${head.width}px`,
        height: `${box.bottom - head.top}px`,
        transform: "rotate(1deg)",
        transition: "transform 120ms ease-out",
      })
      const cells = [target, ...Array.from(pane.querySelectorAll<HTMLElement>(`td[data-col="${col.id}"]`))]
      cells.forEach((cell, index) => {
        const rect = cell.getBoundingClientRect()
        if (index && (rect.bottom < head.bottom || rect.top > box.bottom)) return
        const copy = document.createElement("div")
        copy.className = `${cell.className} absolute left-0 flex flex-col justify-center ${index ? "" : "z-10 bg-surface-raised-base text-text-strong"}`
        copy.innerHTML = cell.innerHTML
        Object.assign(copy.style, { position: "absolute", top: `${rect.top - head.top}px`, width: `${head.width}px`, height: `${rect.height}px`, opacity: "1" })
        copy.querySelector("[data-action='p1-resize']")?.remove()
        ghost.append(copy)
      })
      document.body.append(ghost)
      document.body.style.cursor = "grabbing"
      return { ghost, left: head.left }
    }
    const held = { lifted: undefined as { ghost: HTMLElement; left: number } | undefined }
    const over = (next: PointerEvent) => {
      if (!held.lifted && Math.abs(next.clientX - start) < 5) return
      held.lifted ??= lift()
      held.lifted.ghost.style.left = `${held.lifted.left + next.clientX - start}px`
      // Scroll sideways when the pointer nears the list's edge, to reach columns out of view.
      const box = pane.getBoundingClientRect()
      if (next.clientX > box.right - 48) pane.scrollLeft += 16
      if (next.clientX < box.left + 48) pane.scrollLeft -= 16
      const cells = Array.from(row.querySelectorAll<HTMLElement>("th[data-col]"))
      const to = cells.filter((cell) => {
        const rect = cell.getBoundingClientRect()
        return rect.left + rect.width / 2 < next.clientX
      }).length
      setState("move", { id: col.id, to })
    }
    const up = () => {
      target.removeEventListener("pointermove", over)
      target.removeEventListener("pointerup", up)
      target.removeEventListener("pointercancel", up)
      held.lifted?.ghost.remove()
      document.body.style.cursor = ""
      const drag = state.move
      setState("move", undefined)
      if (!drag) return
      const from = state.cols.findIndex((item) => item.id === drag.id)
      if (drag.to === from || drag.to === from + 1) return
      const prev = state.cols
      const rest = prev.filter((item) => item.id !== drag.id)
      const at = drag.to > from ? drag.to - 1 : drag.to
      const list = [...rest.slice(0, at), prev[from], ...rest.slice(at)]
      setState("cols", list)
      keep(p1.server(), p1.token(), state.root, p1.user(), list, language.locale()).catch(() => setState("cols", prev))
    }
    target.addEventListener("pointermove", over)
    target.addEventListener("pointerup", up)
    target.addEventListener("pointercancel", up)
  }
  const opener = useOpener()
  const every = () => state.rows.length > 0 && state.rows.every((row) => state.checked[row.id])
  const some = () => state.rows.some((row) => state.checked[row.id])
  const size = (col: Column) => Math.max(least(col), state.sizes[col.id] ?? p1.width(col.id) ?? wide(col.id))
  const fit = (col: Column) => {
    const px = `${size(col)}px`
    return { width: px, "min-width": px, "max-width": px }
  }
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
    // The closed folder tree shown over the list while you hover its icon.
    peek: false,
    // The folder tree's width while its edge is being dragged.
    wide: undefined as number | undefined,
    // The requirement dialog: an id to edit, 0 for a new one in the selected folder.
    item: undefined as number | undefined,
    // The spec open in the editor docked beside the list, and that editor's width while its edge is dragged.
    panel: undefined as number | undefined,
    span: undefined as number | undefined,
    // Each loaded folder's parent, for refreshing the right branch after a folder changes.
    parents: {} as Record<number, number>,
    // The folder dialog (a place means a new folder there) and the folder menu with your access level.
    dir: undefined as { id: number; place?: Place } | undefined,
    // The folder menu, with your access level and whether its New Folder As choices are showing.
    menu: undefined as { id: number; x: number; y: number; level: number; sub: boolean } | undefined,
    // The requirement menu, opened with a right click on a row or card.
    act: undefined as { id: number; x: number; y: number } | undefined,
    // P1's view settings for the project family (and the rest of P1's note, written back as read), and their popover.
    prefs: plain as Prefs,
    memo: {} as Record<string, unknown>,
    sets: undefined as DOMRect | undefined,
    columns: false,
    // The selected roadmap month's spec points (finished of target) and team score, and the report popup.
    work: undefined as { finished: number; points: number; load: number } | undefined,
    team: undefined as { score: number; high: number; low: number } | undefined,
    report: false,
    // The list's filter and grouping, the groups P1 sent, and the groups you folded shut.
    filter: blank as Filter,
    groups: [] as Group[],
    shut: {} as Record<string, boolean>,
    // The filter popover under its button, with the people and states to pick from.
    sift: undefined as DOMRect | undefined,
    choices: { owners: [] as Choice[], states: [] as Status[], members: undefined as Choice[] | undefined },
    // The list's columns as P1 keeps them for you, and every column there is to choose from.
    cols: fallback as Column[],
    pool: [] as Column[],
    // A column's width while its edge is being dragged; kept to P1 settings when you let go.
    sizes: {} as Record<number, number | undefined>,
    // A header being dragged to a new place, and the slot it would land in.
    move: undefined as { id: number; to: number } | undefined,
    // The list cell being edited in place.
    typing: undefined as { id: number; col: number } | undefined,
    points: undefined as { id: number; x: number; y: number } | undefined,
    // The requirements checked in the list, and the one whose icon menu is open, by the icon it opened from.
    checked: {} as Record<number, boolean>,
    attach: undefined as { id: number; at: DOMRect } | undefined,
    level: 0,
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

  // Where the workload numbers come from: a roadmap month folder in a project with a development project.
  const work = createMemo(() => {
    const months = folder()?.months
    const project = chosen()
    const dev = state.space?.dev
    if (!months || !project || !dev || !state.root) return
    const at = month(months)
    const label = new Intl.DateTimeFormat(language.locale(), { month: "short" }).format(
      new Date(Number(at.slice(0, 4)), Number(at.slice(4)) - 1, 1),
    )
    return {
      month: at,
      label,
      place: { project: state.root, folder: state.folder, base: project.base, space: project.id, dev } as Scope,
    }
  })
  // The docked editor belongs to the folder it was opened in.
  createEffect(on([() => state.root, () => state.folder], () => setState("panel", undefined), { defer: true }))
  // The numbers follow the list: the month's points over the specs shown, and the team's average score.
  createEffect(
    on([work, () => state.rows, () => state.loading] as const, ([at, rows, loading]) => {
      setState({ work: undefined, team: undefined })
      if (!at || loading) return
      const host = p1.server()
      const token = p1.token()
      const locale = language.locale()
      const items = rows.map((row) => row.id)
      void summary(host, token, at.place, items, period(at.month), locale)
        .then(async (got) => {
          if (work() !== at) return
          setState("work", { finished: got.finished, points: got.points, load: got.load })
          const marks = await scores(host, token, at.place, at.month, locale)
          if (work() === at) setState("team", standing(marks, got.members.map((item) => item.id)))
        })
        .catch(() => undefined)
    }),
  )
  const lanes = createMemo(() => {
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
    if (found) {
      const got = await columns(host, token, found.project, language.locale()).catch(() => undefined)
      if (mark !== stamp) return
      setState({ cols: got?.chosen ?? fallback, pool: got?.pool ?? [] })
    }
    if (!found) {
      setState({ loading: false, folders: {}, kids: {}, open: {}, top: [], rows: [], total: 0, folder: 0, root: 0, space: undefined })
      return
    }
    const got = await prefs(host, token, p1.user(), project.base, language.locale()).catch(() => undefined)
    if (mark !== stamp) return
    setState({ prefs: got?.prefs ?? plain, memo: got?.memo ?? {} })
    const tree = await root(host, token, found, language.locale(), state.prefs.closed).catch((err: unknown) => {
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
      filter: p1.filter(found.project) ?? blank,
      groups: [],
      shut: {},
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

  const changed = async (id: number, shape: Shape) => {
    const dir = state.dir
    if (!dir) return
    if (dir.place === undefined) {
      setState("folders", id, {
        name: shape.name,
        type: shape.type,
        closed: !shape.open,
        months: roadmap(shape.type) && shape.from && shape.to ? { start: shape.from, end: shape.to } : undefined,
      })
      // A folder that became or stopped being a roadmap month changes how its list can be grouped.
      if (id === state.folder && state.root) await fill(state.root, id, state.query.trim())
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
    setState("menu", { id, x: event.clientX, y: event.clientY, level: -1, sub: false })
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
    const list = await children(host, p1.token(), state.root, id, language.locale(), state.prefs.closed).catch((err: unknown) => {
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
    void access(host, token, root, folder, language.locale())
      .then((level) => setState("level", level))
      .catch(() => setState("level", 0))
    const list = await requirements(
      host,
      token,
      root,
      folder,
      query,
      language.locale(),
      state.cols.map((col) => col.id),
      // Weekly committed work only groups a folder that spans roadmap months, as in P1.
      state.filter.group === 1132 && !state.folders[folder]?.months ? { ...state.filter, group: 0 } : state.filter,
      { all: !state.prefs.current, closed: state.prefs.closed },
    ).catch((err: unknown) => {
      if (mark === stamp && mine === wave) fail(err)
    })
    if (mark !== stamp || mine !== wave || !list) return
    setState({ rows: list.rows, total: list.total, groups: list.groups, loading: false, err: "", checked: {} })
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
    if (event.key === "Escape") setState({ picker: false })
    // ⌘K searches requirements here, as it searches each view's own things.
    if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && finder) {
      event.preventDefault()
      finder.focus()
      finder.select()
    }
  }
  // The top bar's slots, which P1 Work fills while it shows.
  const bar = (slot: "center" | "right") => document.getElementById(`opencode-titlebar-${slot}`) ?? undefined
  let finder: HTMLInputElement | undefined
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
            class="group/row w-full flex items-center gap-1 pr-1 rounded-lg text-13-regular"
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
              <Show when={typed(item().type)} fallback={<Icon name="folder" size="small" class="shrink-0 text-text-weak" />}>
                <FolderType type={item().type} closed={item().closed} />
              </Show>
              <span class="truncate">{item().name}</span>
            </button>
            {/* The same menu as a right click, from a button that shows on the row you point at. */}
            <button
              type="button"
              data-action="p1-folder-more"
              class="shrink-0 size-6 rounded flex items-center justify-center text-text-weak opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 hover:text-text-strong hover:bg-surface-base-hover"
              classList={{ "opacity-100": state.menu?.id === id }}
              aria-label={language.t("p1.folder.actions")}
              title={language.t("p1.folder.actions")}
              onClick={(event) => {
                event.stopPropagation()
                menu(event, id)
              }}
            >
              <Icon name="menu" size="small" />
            </button>
          </div>
          <Show when={state.open[id]}>
            <For each={(state.kids[id] ?? []).filter(shows)}>{(kid) => node(kid, depth + 1)}</For>
          </Show>
        </>
      )}
    </Show>
  )

  // Applies a new filter or grouping: kept for the project, and the list read again from the top.
  const refine = (next: Filter) => {
    setState({ filter: next, shut: {} })
    p1.refine(state.root, next)
    void fill(state.root, state.folder, state.query.trim())
  }

  // The ways the list can be grouped here: by week only in a folder that spans roadmap months, and by module
  // owner only where a development project owns the modules.
  const groupings = () => [
    { id: 0, name: language.t("p1.filter.none") },
    ...(folder()?.months ? [{ id: 1132, name: language.t("p1.filter.weekly") }] : []),
    { id: 1113, name: state.pool.find((col) => col.id === 1113)?.name || language.t("p1.filter.owner") },
    ...(state.space?.dev ? [{ id: 1604, name: language.t("p1.filter.module") }] : []),
    { id: 1110, name: state.pool.find((col) => col.id === 1110)?.name || language.t("p1.filter.created") },
  ]

  // A closed folder shows only while the settings say to show closed folders.
  const shows = (id: number) => state.prefs.closed || !state.folders[id]?.closed

  // Applies a change to P1's view settings at once and keeps it in P1; showing closed folders reads the tree again.
  const tune = async (next: Prefs) => {
    const prev = state.prefs
    const project = chosen()
    setState("prefs", next)
    // The list reads its events from P1's user settings, so those are saved before it is read again.
    if (project)
      await prefer(
        p1.server(),
        p1.token(),
        {
          user: p1.user(),
          family: project.base,
          project: state.root,
          memo: state.memo,
          next,
          events: next.events !== prev.events || next.owners !== prev.owners,
        },
        language.locale(),
      ).catch(fail)
    if (next.closed !== prev.closed && state.project) return void pick(state.project)
    void fill(state.root, state.folder, state.query.trim())
  }

  // Opens the filter once the people and states it offers are in, from P1 for this project and folder.
  const sift = async (at: DOMRect) => {
    const host = p1.server()
    const token = p1.token()
    const project = chosen()
    const locale = language.locale()
    const [who, how, team] = await Promise.all([
      owners(host, token, state.root, state.folder, locale).catch(() => [] as Choice[]),
      states(host, token, state.root, locale).catch(() => [] as Status[]),
      state.space?.dev && project
        ? members(host, token, { base: project.base, space: project.id, dev: state.space.dev }, locale).catch(() => [] as Choice[])
        : Promise.resolve(undefined),
    ])
    setState({ choices: { owners: who, states: how, members: team }, sift: at })
  }

  // The list's rows under their groups when it is grouped, each group's rows hidden while it is folded shut.
  const sections = createMemo(() => {
    if (!state.groups.length) return [{ group: undefined as Group | undefined, rows: state.rows }]
    return state.groups.map((group) => ({
      group: group as Group | undefined,
      rows: state.shut[group.key] ? [] : state.rows.filter((row) => group.ids.includes(row.id)),
    }))
  })

  // Hovering the closed tree's icon shows it over the list; it hides a moment after you leave both.
  let hide: ReturnType<typeof setTimeout> | undefined
  const peek = (on: boolean) => {
    clearTimeout(hide)
    if (on) return setState("peek", true)
    hide = setTimeout(() => setState("peek", false), 200)
  }
  onCleanup(() => clearTimeout(hide))

  // New Folder As shows its choices while you point at it, and keeps them a moment after you leave,
  // so the pointer can cross the items below on its way to them.
  let fold: ReturnType<typeof setTimeout> | undefined
  const sub = (on: boolean) => {
    clearTimeout(fold)
    if (on) return state.menu && setState("menu", "sub", true)
    fold = setTimeout(() => state.menu && setState("menu", "sub", false), 400)
  }
  onCleanup(() => clearTimeout(fold))

  const gauge =
    "w-28 h-8 px-2.5 flex flex-col justify-center gap-1 rounded-lg border border-border-weaker-base bg-surface-base text-left cursor-pointer hover:border-border-strong-base hover:bg-surface-base-hover"
  const line =
    "w-full px-2.5 py-2 flex items-center gap-2.5 rounded-lg text-left text-13-regular text-text-strong hover:bg-surface-base-hover disabled:text-text-weaker disabled:hover:bg-transparent"

  // The folder tree's width, dragged between half and double its usual 256px and kept in P1 settings.
  // Shown over the list while closed, it is a little wider than usual.
  const breadth = () => Math.min(512, Math.max(128, state.wide ?? p1.width("tree") ?? 256))
  const drag = (event: PointerEvent) => {
    event.preventDefault()
    const from = event.clientX
    const start = breadth()
    const move = (next: PointerEvent) => setState("wide", Math.min(512, Math.max(128, start + next.clientX - from)))
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      p1.size("tree", breadth())
      setState("wide", undefined)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  const tree = (over = false) => (
    <aside
      class="relative shrink-0 border-r border-border-weaker-base flex flex-col min-h-0"
      style={{ width: `${over ? 308 : breadth()}px` }}
    >
      <Show when={!over}>
        <div
          data-action="p1-folders-resize"
          class="group absolute top-0 -right-1.5 z-10 h-full w-3 cursor-col-resize flex justify-center"
          title={language.t("p1.folders.resize")}
          onPointerDown={drag}
          onDblClick={() => p1.size("tree", undefined)}
        >
          <div class="w-px h-full bg-transparent group-hover:w-0.5 group-hover:bg-border-strong-base group-active:w-0.5 group-active:bg-border-interactive-base" />
        </div>
      </Show>
      <div class="shrink-0 h-14 pl-3 pr-4 mb-2 flex items-center gap-2 border-b border-border-weaker-base">
        <button
          type="button"
          data-action={p1.folded() ? "p1-folders-pin" : "p1-folders-hide"}
          class="shrink-0 size-8 rounded-md flex items-center justify-center text-text-weak hover:text-text-strong hover:bg-surface-base-hover"
          aria-label={language.t(p1.folded() ? "p1.folders.show" : "p1.folders.hide")}
          title={language.t(p1.folded() ? "p1.folders.show" : "p1.folders.hide")}
          onClick={() => (setState("peek", false), p1.fold(!p1.folded()))}
        >
          <Panel open={!p1.folded()} />
        </button>
        <span class="truncate text-14-medium text-text-strong">{language.t("p1.folders")}</span>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto px-2 pb-3 flex flex-col gap-0.5">
        <Show
          when={state.top.length}
          fallback={<Hint text={language.t(state.loading ? "p1.loading" : "p1.empty.folders")} />}
        >
          <For each={state.top.filter(shows)}>{(id) => node(id, 0)}</For>
        </Show>
      </div>
    </aside>
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
        {/* The top bar's middle: the P1 project and the requirement search, as every view puts what it works in. */}
        <Portal mount={bar("center")}>
        <div data-component="p1-bar" data-no-drag class="flex items-center gap-1.5 min-w-0">
          <div class="relative shrink-0">
            <button
              type="button"
              data-action="p1-pick-project"
              class="h-7 flex items-center gap-2 pl-1 pr-2 rounded-md hover:bg-surface-raised-base-hover max-w-56 xl:max-w-80"
              aria-expanded={state.picker}
              aria-label={language.t("p1.project.pick")}
              onClick={() => {
                if (state.picker) return setState("picker", false)
                setState("picker", true)
                browse(chosen()?.base ?? families()[0]?.id ?? 0)
              }}
            >
              <span class="size-5 shrink-0 rounded bg-surface-interactive-base text-text-on-interactive-base flex items-center justify-center text-[10px] font-semibold">
                P1
              </span>
              <span
                class="min-w-0 max-w-40 xl:max-w-60 truncate text-12-medium text-text-strong"
                title={`${language.t("p1.project.label")}: ${chosen()?.name ?? ""}`}
              >
                {chosen()?.name ?? language.t("p1.project.pick")}
              </span>
              <Icon name="chevron-down" size="small" class="shrink-0 text-icon-weak" />
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
          {/* P1's areas, switched from the bar as the views are switched from the rail. */}
          <nav class="shrink-0 flex items-center gap-0.5">
            <For each={tabs}>
              {(tab) => (
                <button
                  type="button"
                  data-action={`p1-tab-${tab}`}
                  class="h-7 px-2 rounded-md text-12-medium"
                  classList={{
                    "bg-surface-raised-base-active text-text-strong": tab === "requirements",
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
          <label class="hidden md:flex w-[150px] xl:w-[220px] min-w-0 h-7 px-2 items-center gap-2 rounded-md border border-border-weak-base bg-surface-panel focus-within:border-border-interactive-base">
            <Icon name="magnifying-glass" size="small" class="shrink-0 text-icon-weak" />
            <input
              ref={(el) => (finder = el)}
              data-action="p1-search"
              class="min-w-0 flex-1 bg-transparent text-12-regular text-text-strong placeholder:text-text-weak outline-none"
              value={state.query}
              placeholder={language.t("p1.search.requirement")}
              onInput={(event) => search(event.currentTarget.value)}
            />
            <span class="shrink-0 text-12-regular text-text-weaker">⌘K</span>
          </label>
        </div>
        </Portal>
        <Show when={state.err}>
          <p class="shrink-0 px-4 py-2 text-12-regular text-text-diff-delete-base border-b border-border-weaker-base">
            {state.err}
          </p>
        </Show>
        <div class="relative flex-1 min-h-0 flex">
          <Show when={!p1.folded()}>{tree()}</Show>
          <Show when={p1.folded() && state.peek}>
            <div
              class="absolute inset-y-0 left-0 z-30 flex bg-background-base shadow-lg"
              onMouseEnter={() => peek(true)}
              onMouseLeave={() => peek(false)}
            >
              {tree(true)}
            </div>
          </Show>
          <section ref={(el) => (pane = el)} class="relative flex-1 min-w-0 flex flex-col min-h-0">
            <div class="shrink-0 h-14 pl-3 pr-4 flex items-center gap-3 border-b border-border-weaker-base">
              <Show when={p1.folded()}>
                <button
                  type="button"
                  data-action="p1-folders-show"
                  class="shrink-0 size-8 rounded-md flex items-center justify-center text-text-weak hover:text-text-strong hover:bg-surface-base-hover"
                  aria-label={language.t("p1.folders.show")}
                  title={language.t("p1.folders.show")}
                  onMouseEnter={() => peek(true)}
                  onMouseLeave={() => peek(false)}
                  onClick={() => (setState("peek", false), p1.fold(false))}
                >
                  <Panel open={false} />
                </button>
              </Show>
              {/* The selected folder, shown only; its actions are in the tree. */}
              <div
                class="shrink-0 w-[174px] h-8 px-3 flex items-center rounded-lg border border-border-weaker-base bg-surface-base"
                title={folder()?.name}
              >
                <div class="min-w-0 flex-1 truncate text-14-medium text-text-strong">
                  {folder()?.name ?? language.t("p1.requirements")}
                </div>
              </div>
              <div class="shrink-0 flex items-center p-0.5 rounded-lg border border-border-weaker-base bg-surface-base">
                <For each={["list", "board"] as const}>
                  {(view) => (
                    <button
                      type="button"
                      data-action={`p1-view-${view}`}
                      class="h-7 px-3 rounded-md text-13-medium"
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
              <button
                type="button"
                data-action="p1-filter"
                class="shrink-0 relative size-8 rounded-lg flex items-center justify-center border border-border-weaker-base bg-surface-base hover:text-text-strong"
                classList={{
                  "text-text-interactive-base border-border-interactive-base": active(state.filter),
                  "text-text-weak": !active(state.filter),
                }}
                disabled={!state.root}
                aria-label={language.t("p1.filter.title")}
                title={language.t("p1.filter.title")}
                aria-pressed={active(state.filter)}
                onClick={(event) => void sift(event.currentTarget.getBoundingClientRect())}
              >
                <Icon name="sliders" size="small" />
              </button>
              <P1Group
                value={groupings().some((item) => item.id === state.filter.group) ? state.filter.group : 0}
                items={groupings()}
                disabled={!state.root}
                onPick={(group) => refine({ ...state.filter, group })}
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
              <div class="flex-1" />
              {/* The month's workload and the team's score, for the selected roadmap month folder: a label over a bar,
              with the numbers on hover. Either opens the report. */}
              <Show when={work()}>
                <div class="shrink-0 flex items-center gap-2">
                  <div class="relative group/tip">
                    <button
                      type="button"
                      data-action="p1-work-points"
                      class={gauge}
                      aria-label={language.t("p1.work.load")}
                      onClick={() => setState("report", true)}
                    >
                      <span class="text-11-medium text-text-weak">{language.t("p1.work.load")}</span>
                      <span class="w-full h-1.5 rounded-full bg-border-weak-base overflow-hidden">
                        <span
                          class="block h-full min-w-1 rounded-full bg-gradient-to-r from-[#5b8def] to-[#3a6ff0]"
                          style={{ width: `${Math.min(100, state.work?.load ?? 0)}%` }}
                        />
                      </span>
                    </button>
                    <Tip
                      rows={[
                        [language.t("p1.work.load"), `${Number((state.work?.load ?? 0).toFixed(2))}%`],
                        [language.t("p1.work.committed"), String(state.work?.finished ?? 0)],
                        [language.t("p1.work.capacity"), String(state.work?.points ?? 0)],
                      ]}
                    />
                  </div>
                  <div class="relative group/tip">
                    <button
                      type="button"
                      data-action="p1-work-score"
                      class={gauge}
                      aria-label={language.t("p1.work.team")}
                      onClick={() => setState("report", true)}
                    >
                      <span class="text-11-medium text-text-weak">{language.t("p1.work.team")}</span>
                      <span class="w-full h-1.5 rounded-full bg-border-weak-base overflow-hidden">
                        <span
                          class="block h-full min-w-1 rounded-full bg-gradient-to-r from-[#f0c46c] to-[#e2a83e]"
                          style={{ width: `${Math.min(100, (state.team?.score ?? 0) * 10)}%` }}
                        />
                      </span>
                    </button>
                    <Tip
                      rows={[
                        [language.t("p1.work.team"), String(state.team?.score ?? 0)],
                        [language.t("p1.work.high"), String(state.team?.high ?? 0)],
                        [language.t("p1.work.low"), String(state.team?.low ?? 0)],
                      ]}
                    />
                  </div>
                </div>
              </Show>
              {/* One way to edit from the list, switched here: a pencil edits in place, a side panel opens the spec. */}
              <div class="relative group/tip shrink-0">
                <button
                  type="button"
                  data-action="p1-edit-mode"
                  class="size-8 rounded-lg flex items-center justify-center border border-border-weaker-base bg-surface-base hover:bg-surface-base-hover"
                  aria-label={language.t(p1.edit() === "inline" ? "p1.prefs.inline.name" : "p1.prefs.panel.name")}
                  onClick={() => {
                    p1.mode(p1.edit() === "inline" ? "panel" : "inline")
                    setState({ panel: undefined, typing: undefined })
                  }}
                >
                  {/* The icon itself carries the mode's color: the icon component sets its own grey otherwise. */}
                  <Show
                    when={p1.edit() === "inline"}
                    fallback={
                      <Icon name="layout-left-full" size="small" class="-scale-x-100" style={{ color: tint.panel }} />
                    }
                  >
                    <Icon name="pencil-line" size="small" style={{ color: tint.inline }} />
                  </Show>
                </button>
                <Tip text={language.t(p1.edit() === "inline" ? "p1.prefs.inline.name" : "p1.prefs.panel.name")} />
              </div>
              <button
                type="button"
                data-action="p1-prefs"
                class="shrink-0 size-8 rounded-lg flex items-center justify-center border border-border-weaker-base bg-surface-base text-text-weak hover:text-text-strong"
                classList={{ "text-text-strong border-border-strong-base": !!state.sets }}
                disabled={!state.root}
                aria-label={language.t("p1.prefs.title")}
                onClick={(event) => setState("sets", event.currentTarget.getBoundingClientRect())}
              >
                <Icon name="settings-gear" size="small" />
              </button>
            </div>
            <div
              data-scroll
              class="flex-1 min-h-0 overflow-auto"
              onClick={(event) => {
                // A click on the list's empty space, outside any row or header, puts the docked editor away.
                if (!(event.target as HTMLElement).closest("tr, button, input, label")) setState("panel", undefined)
              }}
            >
              <Show when={!state.loading} fallback={<Hint text={language.t("p1.loading")} />}>
                <Show when={state.folder} fallback={<Hint text={language.t("p1.empty.folders")} />}>
                  <Show when={state.rows.length} fallback={<Hint text={language.t("p1.empty.requirements")} />}>
                    <Show
                      when={p1.view() === "board"}
                      fallback={
                        <table class="table-fixed text-left border-collapse" style={{ width: `${state.cols.reduce((sum, col) => sum + size(col), lead)}px`, "min-width": "100%" }} data-component="p1-list">
                          <thead class="sticky top-0 z-10 bg-background-base">
                            <tr class="group/head text-12-medium text-text-weak border-b border-border-weaker-base">
                              {/* P1's two leading columns: a check to pick requirements, and each one's icon. */}
                              <th class="pl-4 pr-1 py-2.5" style={{ width: `${check}px` }}>
                                <input
                                  type="checkbox"
                                  data-action="p1-check-all"
                                  class="size-4 align-middle cursor-pointer accent-[var(--surface-interactive-base)]"
                                  aria-label={language.t("p1.list.checkAll")}
                                  checked={every()}
                                  ref={(el) => createEffect(() => (el.indeterminate = some() && !every()))}
                                  onChange={(event) =>
                                    setState(
                                      "checked",
                                      // Each row is set, as a store merges an object in and `{}` would clear nothing.
                                      Object.fromEntries(state.rows.map((row) => [row.id, event.currentTarget.checked])),
                                    )
                                  }
                                />
                              </th>
                              <th style={{ width: `${mark}px` }} />
                              <For each={state.cols}>
                                {(col) => (
                                  <th
                                    data-col={col.id}
                                    class="relative px-4 py-2.5 font-medium whitespace-nowrap overflow-hidden text-ellipsis cursor-grab select-none"
                                    classList={{
                                      "text-right": numeric(col.id),
                                      "opacity-30": state.move?.id === col.id,
                                      "shadow-[inset_3px_0_0_var(--border-interactive-base)]": slot(col) === "left",
                                      "shadow-[inset_-3px_0_0_var(--border-interactive-base)]": slot(col) === "right",
                                    }}
                                    style={fit(col)}
                                    onPointerDown={(event) => move(event, col)}
                                  >
                                    {col.name}
                                    <div
                                      data-action="p1-resize"
                                      class="group/edge absolute top-0 -right-1.5 z-10 h-full w-3 cursor-col-resize flex justify-center"
                                      onClick={(event) => event.stopPropagation()}
                                      onDblClick={() => {
                                        setState("sizes", col.id, undefined)
                                        p1.size(col.id, undefined)
                                      }}
                                      onPointerDown={(event) => {
                                        event.preventDefault()
                                        event.stopPropagation()
                                        const start = event.clientX
                                        const from = size(col)
                                        const target = event.currentTarget
                                        target.setPointerCapture(event.pointerId)
                                        const move = (next: PointerEvent) =>
                                          setState("sizes", col.id, Math.max(least(col), Math.round(from + next.clientX - start)))
                                        const up = () => {
                                          target.removeEventListener("pointermove", move)
                                          target.removeEventListener("pointerup", up)
                                          target.removeEventListener("pointercancel", up)
                                          const px = state.sizes[col.id]
                                          if (px !== undefined) p1.size(col.id, px)
                                          setState("sizes", col.id, undefined)
                                        }
                                        target.addEventListener("pointermove", move)
                                        target.addEventListener("pointerup", up)
                                        target.addEventListener("pointercancel", up)
                                      }}
                                    >
                                      <div class="my-1.5 w-px bg-border-weaker-base group-hover/head:bg-border-strong-base group-hover/edge:w-0.5 group-hover/edge:bg-text-strong group-active/edge:w-0.5 group-active/edge:bg-text-strong" />
                                    </div>
                                  </th>
                                )}
                              </For>
                            </tr>
                          </thead>
                          <tbody>
                            <For each={sections()}>
                              {(part) => (
                                <>
                                  <Show when={part.group}>
                                    {(group) => (
                                      <Heading
                                        group={group()}
                                        span={state.cols.length + 2}
                                        shut={!!state.shut[group().key]}
                                        month={folder()?.months ? month(folder()!.months!) : undefined}
                                        onToggle={() => setState("shut", group().key, (value) => !value)}
                                      />
                                    )}
                                  </Show>
                                  <For each={part.rows}>
                                    {(row) => (
                                      <tr
                                        data-action="p1-requirement"
                                        class="border-b border-border-weaker-base hover:bg-surface-base-hover"
                                        classList={{ "opacity-60": state.opening === row.id }}
                                        onContextMenu={(event) => {
                                          event.preventDefault()
                                          setState("act", { id: row.id, x: event.clientX, y: event.clientY })
                                        }}
                                      >
                                        <td
                                          class="pl-4 pr-1 py-3 align-middle"
                                          classList={{ "bg-surface-base-hover": state.panel === row.id }}
                                          onClick={(event) => event.stopPropagation()}
                                        >
                                          <input
                                            type="checkbox"
                                            data-action="p1-check"
                                            class="size-4 align-middle cursor-pointer accent-[var(--surface-interactive-base)]"
                                            aria-label={language.t("p1.list.check")}
                                            checked={!!state.checked[row.id]}
                                            onChange={(event) => setState("checked", row.id, event.currentTarget.checked)}
                                          />
                                        </td>
                                        <td
                                          class="px-1 py-3 align-middle"
                                          classList={{ "bg-surface-base-hover": state.panel === row.id }}
                                          onClick={(event) => event.stopPropagation()}
                                        >
                                          {/* As in P1, the icon opens the requirement's attachments menu. */}
                                          <button
                                            type="button"
                                            data-action="p1-attach"
                                            class="size-8 rounded-md flex items-center justify-center hover:bg-surface-base-hover"
                                            classList={{ "bg-surface-base-hover": state.attach?.id === row.id }}
                                            aria-label={language.t("p1.files.title")}
                                            onClick={(event) =>
                                              setState("attach", {
                                                id: row.id,
                                                at: event.currentTarget.getBoundingClientRect(),
                                              })
                                            }
                                          >
                                            <SpecIcon name={specIcon(row)} />
                                          </button>
                                        </td>
                                        <For each={state.cols}>
                                          {(col) => (
                                            <td
                                              data-col={col.id}
                                              class="px-4 py-3 text-13-regular text-text-base align-middle overflow-hidden break-words"
                                              classList={{
                                                "text-right": numeric(col.id),
                                                "cursor-pointer hover:shadow-[inset_0_0_0_1px_var(--border-weak-base)]":
                                                  p1.edit() === "inline" && editable(col.id, true),
                                                "cursor-pointer": col.id !== 1131,
                                                "bg-surface-base-hover": state.panel === row.id,
                                                "opacity-30": state.move?.id === col.id,
                                                "shadow-[inset_3px_0_0_var(--border-interactive-base)]": slot(col) === "left",
                                                "shadow-[inset_-3px_0_0_var(--border-interactive-base)]": slot(col) === "right",
                                              }}
                                              style={fit(col)}
                                              onPointerEnter={() => {
                                                clearTimeout(hover)
                                                if (col.id === 1131) return
                                                // Resting on a cell starts loading its requirement, so a click opens at once.
                                                hover = setTimeout(
                                                  () =>
                                                    void prime(p1.server(), p1.token(), state.root, row.id, p1.user(), language.locale()).catch(
                                                      () => undefined,
                                                    ),
                                                  150,
                                                )
                                              }}
                                              onPointerLeave={() => clearTimeout(hover)}
                                              onClick={(event) => {
                                                event.stopPropagation()
                                                // As in P1: the ID opens the spec's editor, a field edited in place
                                                // puts the docked editor away, and any other field opens it docked.
                                                if (col.id === 1112) return setState({ panel: undefined, item: row.id })
                                                if (col.id === 1131) return
                                                // The list's settings pick one way to edit: every field in the panel,
                                                // or in place where P1 allows it and the row's menu elsewhere.
                                                // In the panel, a click on a cell's text opens the spec and a click
                                                // on its empty space puts the panel away.
                                                if (p1.edit() === "panel")
                                                  return setState({
                                                    typing: undefined,
                                                    panel: (event.target as HTMLElement).closest("[data-text]") ? row.id : undefined,
                                                  })
                                                if (editable(col.id, true))
                                                  return setState({ panel: undefined, typing: { id: row.id, col: col.id } })
                                                setState({ panel: undefined, act: { id: row.id, x: event.clientX, y: event.clientY } })
                                              }}
                                            >
                                              <Show
                                                when={state.typing?.id === row.id && state.typing.col === col.id}
                                                fallback={
                                                  <Cell
                                                    col={col.id}
                                                    row={row}
                                                    onPoints={(event) => {
                                                      event.stopPropagation()
                                                      setState("points", { id: row.id, x: event.clientX, y: event.clientY })
                                                    }}
                                                  />
                                                }
                                              >
                                                <P1Inline
                                                  project={state.root}
                                                  id={row.id}
                                                  col={col.id}
                                                  text={row.cells[col.id] ?? ""}
                                                  folder={state.folder}
                                                  status={row.cells[1114] ?? row.status}
                                                  onDone={(text) => {
                                                    if (text !== undefined) setState("rows", (item) => item.id === row.id, "cells", col.id, text)
                                                    if (text !== undefined && col.id === 1101) setState("rows", (item) => item.id === row.id, "title", text)
                                                    if (state.typing?.id === row.id && state.typing.col === col.id) setState("typing", undefined)
                                                  }}
                                                />
                                              </Show>
                                            </td>
                                          )}
                                        </For>
                                      </tr>
                                    )}
                                  </For>
                                </>
                              )}
                            </For>
                          </tbody>
                        </table>
                      }
                    >
                      <div class="h-full p-4 flex gap-3 items-start">
                        <For each={lanes()}>
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
                                      onContextMenu={(event) => {
                                        event.preventDefault()
                                        setState("act", { id: row.id, x: event.clientX, y: event.clientY })
                                      }}
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
            <Show when={state.panel !== undefined && state.root ? state.panel : undefined} keyed>
              {(id) => (
                <aside
                  class="absolute right-0 bottom-0 top-14 z-20 flex border-l border-border-strong-base bg-surface-raised-stronger-non-alpha"
                  style={{ width: `${dock()}px`, "box-shadow": "-12px 0 32px rgb(0 0 0 / 0.3)" }}
                >
                  <div
                    class="group absolute top-0 -left-1.5 z-10 h-full w-3 cursor-col-resize flex justify-center"
                    onPointerDown={stretch}
                    onDblClick={() => p1.size("panel", undefined)}
                  >
                    <div class="w-px h-full bg-transparent group-hover:w-0.5 group-hover:bg-border-strong-base group-active:w-0.5 group-active:bg-border-interactive-base" />
                  </div>
                  <P1Item
                    dock
                    project={state.root}
                    folder={state.folder}
                    id={id}
                    onClose={() => setState("panel", undefined)}
                    onSaved={(saved) => {
                      void prime(p1.server(), p1.token(), state.root, saved, p1.user(), language.locale(), true).catch(
                        () => undefined,
                      )
                      void fill(state.root, state.folder, state.query.trim())
                    }}
                    onFail={(err) => setState("err", err)}
                    onExpand={() => setState({ panel: undefined, item: id })}
                  />
                </aside>
              )}
            </Show>
          </section>
        </div>
      </Show>
      <Show when={state.columns && state.root}>
        <P1Columns
          project={state.root}
          chosen={state.cols}
          pool={state.pool.length ? state.pool : state.cols}
          onClose={() => setState("columns", false)}
          onSaved={(list) => {
            setState("cols", list)
            void fill(state.root, state.folder, state.query.trim())
          }}
        />
      </Show>
      <Show when={state.report && work()}>
        {(at) => (
          <P1Workload
            place={at().place}
            month={at().month}
            items={state.rows.map((row) => row.id)}
            onClose={() => setState("report", false)}
          />
        )}
      </Show>
      <Show when={state.sets}>
        {(at) => (
          <P1Prefs
            at={at()}
            value={state.prefs}
            onChange={(next) => void tune(next)}
            onColumns={() => setState({ sets: undefined, columns: true })}
            onClose={() => setState("sets", undefined)}
          />
        )}
      </Show>
      <Show when={state.sift}>
        {(at) => (
          <P1Filter
            at={at()}
            value={state.filter}
            owners={state.choices.owners}
            states={state.choices.states}
            members={state.choices.members}
            onApply={(next) => {
              setState("sift", undefined)
              refine(next)
            }}
            onClose={() => setState("sift", undefined)}
          />
        )}
      </Show>
      <Show when={state.points}>
        {(open) => {
          const project = chosen()
          const row = state.rows.find((item) => item.id === open().id)
          return (
            <P1Stories
              project={state.root}
              spec={open().id}
              title={row?.title ?? ""}
              hours={parseFloat(row?.cells[1131] ?? "") || 0}
              home={{ base: project?.base ?? 0, space: project?.id ?? 0, dev: state.space?.dev }}
              readonly={state.level < 2}
              x={open().x}
              y={open().y}
              onClose={(changed) => {
                if (changed)
                  void prime(p1.server(), p1.token(), state.root, open().id, p1.user(), language.locale(), true).catch(() => undefined)
                setState("points", undefined)
                if (changed) void fill(state.root, state.folder, state.query.trim())
              }}
            />
          )
        }}
      </Show>
      <Show when={state.attach}>
        {(open) => (
          <P1Attach
            project={state.root}
            id={open().id}
            at={open().at}
            opener={opener}
            onClose={() => setState("attach", undefined)}
          />
        )}
      </Show>
      <opener.Views />
      <Show when={state.act}>
        {(open) => (
          <>
            <div
              class="fixed inset-0 z-40"
              onClick={() => setState("act", undefined)}
              onContextMenu={(event) => {
                event.preventDefault()
                setState("act", undefined)
              }}
            />
            <div
              data-component="p1-item-menu"
              class="fixed z-50 w-64 p-1 rounded-xl max-h-[80vh] overflow-y-auto"
              style={{
                left: `${Math.min(open().x, window.innerWidth - 272)}px`,
                top: `${Math.max(8, Math.min(open().y, window.innerHeight - 640))}px`,
                border: "1px solid var(--border-strong-base)",
                background: "var(--surface-raised-stronger-non-alpha)",
                "box-shadow": "0 12px 32px rgb(0 0 0 / 0.4)",
              }}
            >
              <For each={actions}>
                {(entry) => {
                  const run = () => {
                    const id = open().id
                    setState("act", undefined)
                    if (entry.key === "new") setState("item", 0)
                    if (entry.key === "edit") setState("item", id)
                    if (entry.key === "customize") setState("columns", true)
                  }
                  return (
                    <button
                      type="button"
                      data-action={`p1-act-${entry.key}`}
                      class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-13-regular disabled:cursor-default"
                      classList={{
                        "text-text-strong hover:bg-surface-base-hover": entry.ready,
                        "text-text-weaker": !entry.ready,
                      }}
                      disabled={!entry.ready}
                      title={entry.ready ? undefined : language.t("p1.tab.soon")}
                      onClick={run}
                    >
                      <Icon name={entry.icon} size="small" class="shrink-0" />
                      {language.t(`p1.act.${entry.key}`)}
                    </button>
                  )
                }}
              </For>
            </div>
          </>
        )}
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
              class="fixed z-50 w-64 p-1 rounded-xl"
              style={{
                left: `${Math.min(open().x, window.innerWidth - 272)}px`,
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
                <div
                  class="relative"
                  onMouseEnter={() => sub(true)}
                  onMouseLeave={() => sub(false)}
                >
                  <button
                    type="button"
                    data-action="p1-folder-menu-new"
                    class={line}
                    disabled={open().level < 3}
                    aria-expanded={open().sub}
                    onClick={() => setState("menu", "sub", !open().sub)}
                  >
                    <Icon name="folder-add-left" size="small" class="shrink-0 text-icon-weak" />
                    <span class="flex-1">{language.t("p1.folder.newas")}</span>
                    <Icon name="chevron-right" size="small" class="shrink-0 text-icon-weak" />
                  </button>
                  <Show when={open().sub && open().level >= 3}>
                    <div
                      class="absolute left-full top-0 pl-1 w-52"
                      classList={{ "left-auto right-full pl-0 pr-1": open().x > window.innerWidth - 460 }}
                    >
                      <div
                        class="p-1 rounded-xl"
                        style={{
                          border: "1px solid var(--border-strong-base)",
                          background: "var(--surface-raised-stronger-non-alpha)",
                          "box-shadow": "0 12px 32px rgb(0 0 0 / 0.4)",
                        }}
                      >
                        <For
                          each={
                            [
                              { place: 0, label: "p1.folder.aschild", icon: "copy" },
                              { place: -1, label: "p1.folder.asabove", icon: "arrow-up" },
                              { place: 1, label: "p1.folder.asbelow", icon: "arrow-down-to-line" },
                            ] as const
                          }
                        >
                          {(entry) => (
                            <Show when={entry.place === 0 || state.parents[open().id]}>
                              <button
                                type="button"
                                data-action="p1-folder-menu-item"
                                class={line}
                                onClick={() => setState({ menu: undefined, dir: { id: open().id, place: entry.place } })}
                              >
                                <Icon name={entry.icon} size="small" class="shrink-0 text-icon-weak" />
                                <span class="flex-1">{language.t(entry.label)}</span>
                              </button>
                            </Show>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                </div>
                {/* P1's other folder actions; Move, Reset Order and Delete are not in SiCode yet. */}
                <For
                  each={
                    [
                      { key: "move", icon: "arrow-right", ready: false },
                      { key: "editmenu", icon: "pencil-line", ready: true },
                      { key: "sort", icon: "bullet-list", ready: false },
                      { key: "delete", icon: "trash", ready: false },
                    ] as const
                  }
                >
                  {(entry) => (
                    <button
                      type="button"
                      data-action={`p1-folder-menu-${entry.key}`}
                      class={line}
                      disabled={!entry.ready || open().level < 2}
                      onMouseEnter={() => sub(false)}
                      onClick={() => setState({ menu: undefined, dir: { id: open().id, place: undefined } })}
                    >
                      <Icon name={entry.icon} size="small" class="shrink-0 text-icon-weak" />
                      <span class="flex-1">{language.t(`p1.folder.${entry.key}`)}</span>
                      <Show when={!entry.ready}>
                        <span class="text-11-regular text-text-weaker">{language.t("p1.tab.soon")}</span>
                      </Show>
                    </button>
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
            onSaved={(id, shape) => void changed(id, shape)}
          />
        )}
      </Show>
      <Show when={state.item !== undefined && state.root}>
        <P1Item
          project={state.root}
          folder={state.folder}
          id={state.item || undefined}
          onClose={() => setState("item", undefined)}
          onSaved={(id) => {
            void prime(p1.server(), p1.token(), state.root, id, p1.user(), language.locale(), true).catch(() => undefined)
            void fill(state.root, state.folder, state.query.trim())
          }}
        />
      </Show>
    </div>
  )
}

/** Numbers sit to the right, like P1's list. */
// The check and icon columns' widths, ahead of the chosen columns.
const check = 40
const mark = 48
const lead = check + mark

function numeric(id: number) {
  return [1131, 1132, 1130, 1143, 1144].includes(id)
}

/** How much room a column starts with; the title gets most. */
function wide(id: number) {
  if (id === 1101) return 360
  if (id === 1112) return 90
  if (numeric(id) || id === 1137 || id === 1139) return 96
  return 150
}

/**
 * Cells you click to edit in place, the ones P1 edits in the list: state, owner, planned dates, roadmap month,
 * time and priority, and the title too when the list edits in place. Points has its own popover.
 */
function editable(id: number, title = false) {
  return ([1113, 1114, 1132, 1133, 1134, 1143, 1144, 1601].includes(id) || (title && id === 1101)) && !fixedField(id)
}

/** The narrowest a column can be dragged and still read its header and values. */
function least(col: Column) {
  if (col.id === 1101) return 200
  return Math.max(numeric(col.id) || col.id === 1112 ? 64 : 88, col.name.length * 7 + 40)
}

/** One list cell, drawn the way P1 draws that field. */
function Cell(props: { col: number; row: Row; onPoints: (event: MouseEvent) => void }) {
  const value = () => props.row.cells[props.col] ?? ""
  // A cell's text carries `data-text`, so a click can tell it from the cell's empty space.
  if (props.col === 1112)
    return (
      <span data-text class="font-mono text-text-weak">
        #{props.row.id}
      </span>
    )
  if (props.col === 1101)
    return (
      <div class="line-clamp-2 text-14-medium text-text-strong">
        <span data-text>{props.row.title}</span>
      </div>
    )
  if (props.col === 1114) return <Status text={value()} />
  if (props.col === 1131)
    return (
      <button
        type="button"
        data-action="p1-points"
        class="px-2 py-0.5 rounded-md text-text-interactive-base hover:bg-surface-base-hover underline-offset-2 hover:underline"
        onClick={(event) => props.onPoints(event)}
      >
        {Math.round((parseFloat(value()) || 0) * 10) / 10}h
      </button>
    )
  if (props.col === 1137) return <span data-text>{props.row.attachments || ""}</span>
  if (props.col === 1139) return <span data-text>{value().replace(",", "/")}</span>
  if (props.col === 1601) return <span data-text>{/^\d{6}$/.test(value()) ? `${value().slice(0, 4)}-${value().slice(4)}` : value()}</span>
  if (props.col === 1503 || props.col === 1510) {
    const pct = () => Math.max(0, Math.min(100, parseFloat(value()) || 0))
    return (
      <div data-text class="inline-flex items-center gap-2">
        <div class="h-1.5 w-16 rounded-full bg-surface-base overflow-hidden">
          <div class="h-full bg-surface-interactive-base" style={{ width: `${pct()}%` }} />
        </div>
        <span class="text-12-regular text-text-weak">{value() || "0%"}</span>
      </div>
    )
  }
  return (
    <div class="truncate">
      <span data-text>{value() === "0" && props.col === 1608 ? "" : value()}</span>
    </div>
  )
}

/** A group's heading across the list: its name, how many requirements it holds, and their points and time. */
function Heading(props: { group: Group; span: number; shut: boolean; month?: string; onToggle: () => void }) {
  const language = useLanguage()
  // Weekly committed work groups say which week (or none) their priority order stands for.
  const name = () => {
    const name = props.group.name || language.t("p1.group.unassigned")
    const found = props.group.by === 1132 && props.month ? bucket(name, props.month) : undefined
    if (!found) return name
    if (found.kind === "commit") return `${name} (${language.t("p1.group.commit")})`
    if (found.kind === "later") return `${name} (${language.t("p1.group.later")})`
    return `${name} (${language.t(`p1.group.week${found.index + 1}`)}, ${found.from} - ${found.to})`
  }
  return (
    <tr data-component="p1-group" class="border-b border-border-weaker-base bg-surface-base">
      <td colSpan={props.span} class="p-0">
        <button
          type="button"
          data-action="p1-group-toggle"
          class="sticky left-0 max-w-full px-3 h-10 flex items-center gap-3 text-left text-13-regular text-text-weak"
          aria-expanded={!props.shut}
          onClick={() => props.onToggle()}
        >
          <Icon name={props.shut ? "chevron-right" : "chevron-down"} size="small" class="shrink-0" />
          <span class="truncate text-13-medium text-text-strong">{name()}</span>
          <span class="shrink-0">{language.t("p1.group.count", { count: props.group.count })}</span>
          <Show
            when={props.group.totals}
            fallback={<span class="shrink-0 tabular-nums">{language.t("p1.group.sum", { total: props.group.points })}</span>}
          >
            {(totals) => (
              <>
                <span class="shrink-0 tabular-nums">
                  {language.t("p1.group.points", { total: props.group.points, done: totals().done })}
                </span>
                <span class="shrink-0 tabular-nums">
                  {language.t("p1.group.time", { spent: totals().spent.toFixed(1), remain: totals().remain.toFixed(1) })}
                </span>
                <span class="shrink-0 flex items-center gap-1.5 tabular-nums">
                  <span class="w-16 h-1.5 rounded-full bg-surface-raised-base overflow-hidden">
                    <span class="block h-full bg-surface-interactive-base" style={{ width: `${Math.min(100, totals().finish)}%` }} />
                  </span>
                  {totals().finish}%
                </span>
              </>
            )}
          </Show>
        </button>
      </td>
    </tr>
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
      <span
        data-text
        class="inline-block max-w-36 truncate px-2 py-0.5 rounded-full bg-surface-base text-12-regular text-text-base"
      >
        {props.text}
      </span>
    </Show>
  )
}

/** The account menu's one entry: About, which shows the product, version and build in place. */
