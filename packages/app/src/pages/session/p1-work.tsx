import { For, Match, Show, Switch, createEffect, createMemo, on, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Tooltip } from "@opencode-ai/ui/tooltip"
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
  bare,
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
import { kloudP1Servers, type P1Server } from "@/p1/servers"
import { kloudToken } from "@/ead/kloud-sign-in"
import { eadHttp } from "@/ead/http"
import { P1Item } from "./p1-item"
import { P1Folder } from "./p1-folder"
import { P1Columns } from "./p1-columns"
import { P1Stories } from "./p1-stories"
import {
  aim as target,
  change,
  edit as retitle,
  least as floor,
  mark as lay,
  spend,
  total,
  field as fields,
  listed as roster,
  type Story,
  type Task,
} from "@/p1/stories"
import { Menu, P1Inline, prime } from "./p1-inline"
import { P1Filter } from "./p1-filter"
import { P1Features, type Pick } from "./p1-features"
import { P1Query } from "./p1-query"
import { P1Group } from "./p1-group"
import { P1Prefs, tint } from "./p1-prefs"
import { keep as prefer, plain, prefs, type Prefs } from "@/p1/prefs"
import {
  Collapse,
  FeatureMap,
  Trophy,
  FolderType,
  Refresh,
  SpecIcon,
  Stories,
  StoryIcon,
  TaskIcon,
  Unlinked,
  Untested,
  typed,
} from "./p1-icons"
import { Tip } from "./p1-tip"
import { P1Workload } from "./p1-workload"
import { P1Attach } from "./p1-attach"
import { useOpener } from "./p1-files"
import { specIcon } from "@/p1/files"
import { period, scores, standing, summary, type Scope } from "@/p1/workload"
import { active, blank, bucket, flip, month, resort, way, type Filter, type Sort, type Status } from "@/p1/filter"
import { members, type Choice } from "@/p1/points"
import { mine, range } from "@/p1/board"
import { update } from "@/p1/form"
import { showToast } from "@opencode-ai/ui/toast"
import { P1Board, prio, type Lane } from "./p1-board"
import { P1Weekly } from "./p1-weekly"
import { columns, fallback, keep, named, priority, type Column } from "@/p1/columns"
import { access, roadmap, type Place, type Shape } from "@/p1/folder"
import { fixedField, warm } from "@/p1/form"
import { KindTag } from "./p1-kind"

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

/** P1 work: requirements by folder, as a list or a board. `ask` puts a question to the AI. */
export function P1Work(props: { ask?: (prompt: string, system: string) => Promise<string> }) {
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
    const list = shown()
    const from = list.findIndex((item) => item.id === drag.id)
    if (drag.to === from || drag.to === from + 1) return
    const at = list.findIndex((item) => item.id === col.id)
    if (drag.to === at) return "left"
    if (drag.to === list.length && at === list.length - 1) return "right"
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
        Object.assign(copy.style, {
          position: "absolute",
          top: `${rect.top - head.top}px`,
          width: `${head.width}px`,
          height: `${rect.height}px`,
          opacity: "1",
        })
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
      // A click that never lifted the column sorts the list by it in the list's current direction, or reads
      // the list again when it is already sorted by it.
      if (!held.lifted && !flag(col.id)) return sort(resort(state.filter.sort, col.id))
      if (!drag) return
      const all = shown()
      const from = all.findIndex((item) => item.id === drag.id)
      if (drag.to === from || drag.to === from + 1) return
      const rest = all.filter((item) => item.id !== drag.id)
      const at = drag.to > from ? drag.to - 1 : drag.to
      const order = [...rest.slice(0, at), all[from], ...rest.slice(at)]
      // A warning column keeps its place here, as how many of P1's columns come before it; P1 keeps the rest.
      for (const [index, item] of order.entries()) {
        const kind = flag(item.id)
        if (kind) p1.settle(kind, order.slice(0, index).filter((other) => !flag(other.id)).length)
      }
      const prev = state.cols
      const list = order.filter((item) => !flag(item.id))
      if (list.every((item, index) => item.id === prev[index]?.id)) return
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
  const size = (col: Column) =>
    flag(col.id) ? warn : Math.max(least(col), state.sizes[col.id] ?? p1.width(col.id) ?? wide(col.id))
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
    // P1 servers the person's Kloud companies are integrated with (Kloud predefines them)
    servers: [] as P1Server[],
    loading: false,
    projects: [] as Project[],
    // The folder tree: each folder by id, its loaded subfolders, which are open, and the top of the tree.
    folders: {} as Record<number, Folder>,
    kids: {} as Record<number, number[]>,
    open: {} as Record<number, boolean>,
    top: [] as number[],
    rows: [] as Row[],
    total: 0,
    // The product feature the list is narrowed to, picked in the feature map.
    feature: undefined as Pick | undefined,
    // The folder panel's search.
    seek: "",
    // The story whose points are being edited in the list, the story or task picked ("s7", "t70") and the one
    // whose name is being edited.
    aiming: undefined as number | undefined,
    lit: "",
    naming: "",
    // The time being edited in the list: a story's or task's key and "spent" or "remain".
    timing: "",
    // The spec whose % finish is pointed at: it and all its stories and tasks show their time instead.
    kin: 0,
    // Whether the folder's path is too long for its place in the toolbar.
    long: false,
    // The page of the list shown.
    page: 1,
    space: undefined as Space | undefined,
    // Each requirement's stories, read for the board's cards when it is grouped by spec and story owner.
    tales: {} as Record<number, Story[]>,
    // The people a story's owner is picked from on the board.
    crew: [] as Choice[],
    // The requirements P1 finds with no linked requirements, and with no linked test cases, flagged when asked.
    warn: { links: [] as number[], tests: [] as number[] },
    // The list's story or task whose owner is being picked, under its owner's name.
    swap: undefined as { spec: number; story: Story; task?: Task; at: DOMRect } | undefined,
    // The closed folder tree shown over the list while you hover its icon.
    peek: false,
    // The folder tree's width while its edge is being dragged.
    wide: undefined as number | undefined,
    // The requirement dialog: an id to edit, 0 for a new one in the selected folder.
    item: undefined as number | undefined,
    // The page the spec editor opens on: All Links (107) from a link check's flag.
    tab: undefined as number | undefined,
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
    // Board cards whose new priority # P1 is still saving.
    saving: {} as Record<number, boolean>,
    // The spec whose stories dialog is open; with a story, only that story's Edit story form.
    points: undefined as { id: number; x: number; y: number; story?: number; tale?: Story } | undefined,
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
  // The view shown: the weekly board only in a roadmap month folder, the list otherwise.
  const shape = () => (p1.view() === "weekly" && !folder()?.months ? "list" : p1.view())

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
          if (work() === at)
            setState(
              "team",
              standing(
                marks,
                got.members.map((item) => item.id),
              ),
            )
        })
        .catch(() => undefined)
    }),
  )
  // The board's columns: the list's groups that hold cards when it is grouped, otherwise one column for each status. Grouped by
  // priority #, each column's cards run in priority # order.
  // P1 sends only the priority # groups that hold work; a week a card is moved into joins them then.
  const pads = createMemo((): Group[] => {
    if (state.filter.group !== 1132 || !state.groups.length) return []
    const have = state.groups.map((group) => range(group.name)?.lo)
    return [0, 10, 20, 30, 40, 50]
      .filter((lo) => !have.includes(lo))
      .map((lo) => ({
        key: `1132-pad-${lo}`,
        by: 1132,
        name: `Priority Order: ${lo} - ${lo + 9}`,
        count: 0,
        ids: [],
        points: 0,
      }))
  })
  const lanes = createMemo((): Lane[] => {
    const when = folder()?.months ? month(folder()!.months!) : undefined
    const sorted = (rows: Row[]) => (state.filter.group === 1132 ? rows.toSorted((a, b) => prio(a) - prio(b)) : rows)
    const start = (group: Group) => range(group.name)?.lo ?? Infinity
    if (state.groups.length)
      return (
        state.groups
          .toSorted((a, b) => (state.filter.group === 1132 ? start(a) - start(b) : 0))
          .map((group) => ({
            key: group.key,
            title: label(group, when, language),
            name: group.name,
            who: state.filter.group === 1604 ? Number(group.key.split("-")[1]) || undefined : undefined,
            rows: sorted(state.rows.filter((row) => group.ids.includes(row.id))),
          }))
          // A group without cards takes no column, leaving the room to the groups that have them.
          .filter((lane) => lane.rows.length)
      )
    const groups = new Map<string, Row[]>()
    for (const row of state.rows) groups.set(row.status, [...(groups.get(row.status) ?? []), row])
    return [...groups].map(([status, rows]) => ({ key: status, title: status || language.t("p1.status.none"), rows }))
  })

  // With stories on, the board's cards and the list's rows show their stories, read for each requirement once per list.
  createEffect(
    on(
      () => [!!state.filter.stories || shape() === "weekly", state.rows] as const,
      ([shown, rows]) => {
        const host = p1.server()
        if (!shown || !host) return
        const root = state.root
        const project = chosen()
        if (!state.crew.length && project && state.space?.dev)
          void members(
            host,
            p1.token(),
            { base: project.base, space: project.id, dev: state.space.dev },
            language.locale(),
          )
            .then((list) => setState("crew", list))
            .catch(() => undefined)
        for (const row of rows.filter((row) => !state.tales[row.id])) {
          setState("tales", row.id, [])
          void roster(host, p1.token(), root, row.id, language.locale())
            .then((list) => state.root === root && setState("tales", row.id, list))
            .catch(() => undefined)
        }
      },
    ),
  )

  // A story moved on the weekly board: its end date (and owner, onto another owner's band) shown at once and saved
  // to P1; the spec's stories are read again either way, so the board shows what P1 kept.
  const plan = async (spec: number, story: Story, change: { end: string; owner: number }) => {
    const owner = change.owner !== story.owner ? change.owner : undefined
    const person = owner === undefined ? story.person : (state.crew.find((item) => item.id === owner)?.name ?? "")
    setState("tales", spec, (list) =>
      list.map((item) =>
        item.id === story.id ? { ...item, end: change.end, ...(owner === undefined ? {} : { owner, person }) } : item,
      ),
    )
    await retitle(
      p1.server(),
      p1.token(),
      story,
      { PlanedEndDate: change.end, ...(owner === undefined ? {} : { CurrentOwnerId: owner }) },
      language.locale(),
    ).catch((err: unknown) => setState("err", err instanceof Error ? err.message : String(err)))
    void roster(p1.server(), p1.token(), state.root, spec, language.locale())
      .then((list) => setState("tales", spec, list))
      .catch(() => undefined)
  }

  // A story's new owner from its board chip: shown at once, and the spec's stories read again when P1 refuses.
  const assign = async (spec: number, story: Story, owner: number) => {
    const person = state.crew.find((item) => item.id === owner)?.name ?? ""
    setState("tales", spec, (list) => list.map((item) => (item.id === story.id ? { ...item, owner, person } : item)))
    await retitle(p1.server(), p1.token(), story, { CurrentOwnerId: owner }, language.locale()).catch(
      (err: unknown) => {
        showToast({
          variant: "error",
          title: `#${spec}`,
          description: err instanceof Error ? err.message : String(err),
        })
        void roster(p1.server(), p1.token(), state.root, spec, language.locale())
          .then((list) => setState("tales", spec, list))
          .catch(() => undefined)
      },
    )
  }

  // A story's new points from the list: its target time, saved to P1 at once and read back if P1 refuses it.
  const aim = async (spec: number, story: Story, hours: number) => {
    const next = Math.round(Math.max(0, hours || 0) * 10) / 10
    if (!Number.isFinite(hours) || next === story.target) return
    setState("tales", spec, (list) => list.map((item) => (item.id === story.id ? { ...item, target: next } : item)))
    await retitle(p1.server(), p1.token(), story, target(next), language.locale()).catch((err: unknown) => {
      showToast({ variant: "error", title: `#${spec}`, description: err instanceof Error ? err.message : String(err) })
      void roster(p1.server(), p1.token(), state.root, spec, language.locale())
        .then((list) => setState("tales", spec, list))
        .catch(() => undefined)
    })
  }

  // A story's or task's new name from the list, saved to P1 at once and read back if P1 refuses it.
  const rename = async (spec: number, story: Story, task: Task | undefined, name: string) => {
    const next = name.trim()
    if (!next || next === (task ?? story).name) return
    setState("tales", spec, (list) =>
      list.map((item) =>
        item.id !== story.id
          ? item
          : task
            ? { ...item, tasks: item.tasks.map((one) => (one.id === task.id ? { ...one, name: next } : one)) }
            : { ...item, name: next },
      ),
    )
    await (
      task
        ? change(p1.server(), p1.token(), story.project, task.id, fields.name, next, language.locale())
        : retitle(p1.server(), p1.token(), story, { StoryTitle: next }, language.locale())
    ).catch((err: unknown) => {
      showToast({ variant: "error", title: `#${spec}`, description: err instanceof Error ? err.message : String(err) })
      void roster(p1.server(), p1.token(), state.root, spec, language.locale())
        .then((list) => setState("tales", spec, list))
        .catch(() => undefined)
    })
  }

  // The list's % finish column, which turns into time spent and left for a spec's family.
  const fin = () => state.cols.find((col) => col.id === 1503 || col.id === 1510)?.id
  // The family's % finish cells framed as one block while their time shows: tinted, edged left and right, with the
  // spec's cell opening it and the family's last row closing it.
  // Given to a cell's classList, so its own classes stay.
  const frame = (top: boolean, end: boolean) =>
    [
      "bg-[color-mix(in_srgb,var(--text-interactive-base)_9%,transparent)]",
      top && end
        ? "shadow-[inset_0_0_0_1.5px_var(--border-interactive-base)] rounded-lg"
        : top
          ? "shadow-[inset_1.5px_1.5px_0_var(--border-interactive-base),inset_-1.5px_0_0_var(--border-interactive-base)] rounded-t-lg"
          : end
            ? "shadow-[inset_1.5px_-1.5px_0_var(--border-interactive-base),inset_-1.5px_0_0_var(--border-interactive-base)] rounded-b-lg"
            : "shadow-[inset_1.5px_0_0_var(--border-interactive-base),inset_-1.5px_0_0_var(--border-interactive-base)]",
    ].join(" ")

  // Points the list at a spec's family for its time, or away from it. Leaving waits a moment, and the next family cell
  // cancels the wait, so moving down through a spec's % finish cells keeps showing their time.
  let away: ReturnType<typeof setTimeout> | undefined
  const kin = (spec: number) => {
    clearTimeout(away)
    if (spec) return setState("kin", spec)
    away = setTimeout(() => setState("kin", 0), 250)
  }
  onCleanup(() => clearTimeout(away))

  // A story's or task's new time spent or left from the list. A task's is saved to P1; a story's own, never below its
  // tasks' total, is kept in SiCode. After a task's, the stories are read again so every total follows.
  const retime = async (spec: number, story: Story, task: Task | undefined, key: "spent" | "remain", hours: number) => {
    const next = Math.round(Math.max(0, hours) * 10) / 10
    if (!Number.isFinite(hours) || next === Math.round((task ?? story)[key] * 10) / 10) return
    const fail = (err: unknown) =>
      showToast({ variant: "error", title: `#${spec}`, description: err instanceof Error ? err.message : String(err) })
    if (!task && next < floor(story, key))
      return fail(new Error(language.t("p1.stories.floor", { hours: floor(story, key).toFixed(1) })))
    // A story's own time is kept in SiCode for now, as P1 keeps none on stories.
    if (!task) return p1.clock(story.id, { spent: story.spent, remain: story.remain, [key]: next })
    const host = p1.server()
    const token = p1.token()
    const locale = language.locale()
    const ok = await (
      task
        ? key === "spent"
          ? spend(
              host,
              token,
              { project: story.project, task: task.id, user: p1.user(), from: task.spent, to: next },
              locale,
            )
          : change(host, token, story.project, task.id, fields.remain, Math.round(next * 60), locale)
        : Promise.resolve()
    )
      .then(() => true)
      .catch((err: unknown) => {
        fail(err)
        return false
      })
    const list = await roster(host, token, state.root, spec, locale).catch(() => undefined)
    if (!list) return
    setState("tales", spec, list)
    // P1 can accept a change and keep something else (a story without tasks, say): say so rather than look saved.
    const found = list.find((one) => one.id === story.id)
    const now = task ? found?.tasks.find((one) => one.id === task.id)?.[key] : found?.[key]
    if (ok && now !== undefined && Math.abs(now - next) >= 0.05)
      fail(new Error(language.t("p1.stories.kept", { hours: now.toFixed(1) })))
  }

  // A task's new owner from the board, the same way.
  const delegate = async (spec: number, story: Story, task: Task, owner: number) => {
    const person = state.crew.find((item) => item.id === owner)?.name ?? ""
    setState("tales", spec, (list) =>
      list.map((item) =>
        item.id === story.id
          ? { ...item, tasks: item.tasks.map((one) => (one.id === task.id ? { ...one, owner, person } : one)) }
          : item,
      ),
    )
    await change(p1.server(), p1.token(), story.project, task.id, fields.owner, owner, language.locale()).catch(
      (err: unknown) => {
        showToast({
          variant: "error",
          title: `#${spec}`,
          description: err instanceof Error ? err.message : String(err),
        })
        void roster(p1.server(), p1.token(), state.root, spec, language.locale())
          .then((list) => setState("tales", spec, list))
          .catch(() => undefined)
      },
    )
  }

  // The list's sort, newest requirement first until a column is picked, and where a column stands in it; only
  // the first shows, while the one before it still settles ties.
  const sorting = () => (state.filter.sort?.length ? state.filter.sort : [{ id: 1112, down: true }])
  const rank = (id: number) => sorting().findIndex((item) => item.id === id)

  // Sorts the list, remembering the direction of the column it now sorts by.
  const sort = (next: Sort[]) =>
    refine({ ...state.filter, sort: next, ways: { ...state.filter.ways, [next[0].id]: next[0].down } })

  // The list's columns as shown: P1's, with a warning column for each link check that is on, where you put it.
  const shown = createMemo(() => {
    const marks = [
      ...(state.filter.unlinked ? (["links"] as const) : []),
      ...(state.filter.untested ? (["tests"] as const) : []),
    ].map((kind) => ({
      col: { id: kind === "links" ? -1 : -2, name: language.t(`p1.warn.${kind}`), type: 0 } as Column,
      at: Math.min(p1.spot(kind), state.cols.length),
    }))
    const before = (at: number) => marks.filter((item) => item.at === at).map((item) => item.col)
    return [...state.cols.flatMap((col, index) => [...before(index), col]), ...before(state.cols.length)]
  })
  // A link check's flag; on a requirement it opens the spec on All Links, where the missing links are added.
  const Flag = (flag: { kind: "links" | "tests"; up?: boolean; id?: number }) => (
    <button
      type="button"
      class="relative group/tip inline-flex"
      classList={{ "cursor-pointer": !!flag.id, "cursor-default": !flag.id }}
      aria-label={language.t(`p1.warn.${flag.kind}`)}
      onClick={(event) => {
        if (!flag.id) return
        event.stopPropagation()
        setState({ item: flag.id, tab: 107 })
      }}
    >
      <Show when={flag.kind === "links"} fallback={<Untested />}>
        <Unlinked />
      </Show>
      <Tip text={language.t(`p1.warn.${flag.kind}`)} side="left" up={flag.up} />
    </button>
  )

  // A requirement's stories in the list: under a person's group, the ones they own when they own any.
  const kids = (id: number, group?: Group) => {
    const list = lay(state.tales[id] ?? [], p1.clocks())
    return group?.by === 1604 ? mine(list, Number(group.key.split("-")[1]) || undefined) : list
  }

  // A story's or task's row under its requirement in the list, lined up with the requirement's own columns: its name
  // under Title, its owner (who can be changed) under the owner, its points under Points with the time spent and left
  // on hover, and its % finish under %Finish. A column that isn't shown puts its value beside the name instead.
  // A click opens the spec's stories.
  const Kid = (kid: { spec: number; story: Story; task?: Task; end?: boolean }) => {
    const item = () => kid.task ?? kid.story
    const finish = () => Math.max(0, Math.min(100, item().finish))
    const has = (id: number) => state.cols.some((col) => col.id === id)
    const done = fin
    // A story's points are its target time; a task's, the hours it was planned to take.
    const points = () => Math.round((kid.task ? kid.task.points : kid.story.target) * 10) / 10
    const key = () => (kid.task ? `t${kid.task.id}` : `s${kid.story.id}`)
    const editing = () => state.timing.startsWith(`${key()}:`)
    // Its time shows while any of its spec's family is pointed at for % finish, or while it is being edited.
    const timed = () => editing() || state.kin === kid.spec
    // Its % finish.
    const Bar = () => (
      <span class="inline-flex items-center gap-2">
        <span class="h-1.5 w-16 rounded-full bg-surface-base overflow-hidden">
          <span
            class="block h-full rounded-full"
            classList={{ "bg-surface-info-strong": !kid.task, "bg-surface-success-strong": !!kid.task }}
            style={{ width: `${finish()}%` }}
          />
        </span>
        <span class="tabular-nums text-text-base">{finish()}%</span>
      </span>
    )
    const Owner = () => (
      <button
        type="button"
        data-action={kid.task ? "p1-task-owner" : "p1-story-owner"}
        class="max-w-full truncate rounded px-1 -mx-1 text-text-weak group-hover/kid:text-text-base hover:!text-text-strong hover:bg-surface-raised-base-hover disabled:hover:bg-transparent"
        classList={{
          "!text-text-strong": state.swap?.story.id === kid.story.id && state.swap?.task?.id === kid.task?.id,
        }}
        disabled={state.level < 2}
        onClick={(event) => {
          event.stopPropagation()
          setState("swap", {
            spec: kid.spec,
            story: kid.story,
            task: kid.task,
            at: event.currentTarget.getBoundingClientRect(),
          })
        }}
      >
        {item().person || language.t("p1.group.unassigned")}
      </button>
    )
    const Time = () => (
      <span class="tabular-nums text-text-base whitespace-nowrap">
        {item().spent.toFixed(1)}h<span class="text-text-weak"> / </span>
        {item().remain.toFixed(1)}h
      </span>
    )
    return (
      <tr
        data-action={kid.task ? "p1-task" : "p1-story"}
        class="group/kid border-b border-border-weaker-base text-12-regular"
        classList={{
          "bg-surface-info-base/25 shadow-[inset_2px_0_0_var(--text-interactive-base)]": state.lit === key(),
          "bg-surface-base/40 hover:bg-surface-base-hover": state.lit !== key(),
        }}
        // A click on the row only picks it; its name edits in place and its pencil opens the stories.
        onClick={() => setState("lit", key())}
      >
        <td />
        <td />
        <For each={shown()}>
          {(col) => (
            <td
              class="px-4 py-2 align-middle"
              classList={{
                "text-right": numeric(col.id),
                "overflow-hidden": ![1131, 1503, 1510].includes(col.id),
                [frame(false, !!kid.end)]: col.id === done() && state.kin === kid.spec,
              }}
              onMouseEnter={() => col.id === done() && kin(kid.spec)}
              onMouseLeave={() => col.id === done() && kin(0)}
              style={fit(col)}
            >
              <Switch>
                <Match when={col.id === 1101}>
                  <div class="flex items-start gap-2" classList={{ "pl-5": !kid.task, "pl-11": !!kid.task }}>
                    <span class="shrink-0 flex h-4 items-center [&>svg]:size-3.5">
                      <Show when={kid.task} fallback={<StoryIcon />}>
                        <TaskIcon />
                      </Show>
                    </span>
                    <Show
                      when={state.naming === key()}
                      fallback={
                        <span class="min-w-0 flex-1">
                          <span
                            data-action={kid.task ? "p1-task-name" : "p1-story-name"}
                            class="line-clamp-2 leading-4 text-text-base cursor-text rounded hover:text-text-strong"
                            onClick={(event) => {
                              if (state.level < 2) return
                              event.stopPropagation()
                              setState({ lit: key(), naming: key() })
                            }}
                          >
                            <Show when={!kid.task}>
                              <KindTag type={kid.story.type} />
                            </Show>
                            {item().name}
                          </span>
                        </span>
                      }
                    >
                      <input
                        ref={(el) => setTimeout(() => (el.focus(), el.select()))}
                        data-action="p1-kid-name-box"
                        class="min-w-0 flex-1 h-7 -my-1.5 px-2 rounded-md bg-surface-base text-12-regular text-text-strong outline-none shadow-[0_0_0_2px_var(--border-interactive-base)]"
                        value={item().name}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          // Esc puts the name back, so the box closing saves nothing.
                          if (event.key === "Escape") {
                            event.currentTarget.value = item().name
                            return event.currentTarget.blur()
                          }
                          if (event.key === "Enter") event.currentTarget.blur()
                        }}
                        onBlur={(event) => {
                          setState("naming", "")
                          void rename(kid.spec, kid.story, kid.task, event.currentTarget.value)
                        }}
                      />
                    </Show>
                    {/* Edits the story or task with the spec's other stories, in their dialog. */}
                    <button
                      type="button"
                      data-action={kid.task ? "p1-task-edit" : "p1-story-edit"}
                      class="shrink-0 size-6 -my-1 rounded-md flex items-center justify-center text-icon-weak opacity-0 group-hover/kid:opacity-100 focus-visible:opacity-100 hover:text-text-strong hover:bg-surface-raised-base-hover"
                      aria-label={language.t(kid.task ? "p1.stories.task.edit" : "p1.stories.story.edit")}
                      title={language.t(kid.task ? "p1.stories.task.edit" : "p1.stories.story.edit")}
                      onClick={(event) => {
                        event.stopPropagation()
                        setState({ lit: key(), points: { id: kid.spec, x: event.clientX, y: event.clientY } })
                      }}
                    >
                      <Icon name="pencil-line" size="small" />
                    </button>
                    <Show when={!has(1113)}>
                      <span class="shrink-0 max-w-28">
                        <Owner />
                      </span>
                    </Show>
                    <Show when={!has(1131)}>
                      <Time />
                    </Show>
                    <Show when={!done()}>
                      <span class="shrink-0 h-4 flex items-center">
                        <Bar />
                      </span>
                    </Show>
                  </div>
                </Match>
                <Match when={col.id === 1112}>
                  <Show
                    when={!kid.task && state.level >= 2}
                    fallback={
                      <span class="font-mono text-text-weak">
                        {kid.task ? `#${kid.task.id}` : kid.story.tag || `#${kid.story.id}`}
                      </span>
                    }
                  >
                    {/* A story's ID opens its Edit story form right here. */}
                    <button
                      type="button"
                      data-action="p1-story-id"
                      class="font-mono text-text-weak rounded px-1 -mx-1 hover:text-text-interactive-base hover:underline underline-offset-2"
                      onClick={(event) => {
                        event.stopPropagation()
                        setState({
                          lit: key(),
                          points: { id: kid.spec, x: event.clientX, y: event.clientY, story: kid.story.id },
                        })
                      }}
                    >
                      {kid.story.tag || `#${kid.story.id}`}
                    </button>
                  </Show>
                </Match>
                <Match when={col.id === 1113}>
                  <Owner />
                </Match>
                {/* A story's points, right-aligned as the requirement's sit, edited in place with the stories icon
                beside the box; a task has none. */}
                <Match when={col.id === 1131 && !kid.task}>
                  {/* As the spec's points: the stories icon before them on the row's hover, then the points, which a
                  story can change in place (underlined while you point at the row). */}
                  <span class="inline-flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      data-action="p1-story-points-open"
                      class="size-7 shrink-0 rounded-md flex items-center justify-center hover:bg-surface-raised-base-hover focus-visible:opacity-100"
                      classList={{
                        "opacity-0 group-hover/kid:opacity-100": state.aiming !== kid.story.id,
                      }}
                      aria-label={language.t("p1.points.open")}
                      title={language.t("p1.points.open")}
                      // Keeps the box focused while editing, so it doesn't save and close before the click.
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={(event) => {
                        setState("aiming", undefined)
                        setState("points", { id: kid.spec, x: event.clientX, y: event.clientY })
                      }}
                    >
                      <Stories />
                    </button>
                    <Show
                      when={state.aiming === kid.story.id}
                      fallback={
                        <button
                          type="button"
                          data-action="p1-story-points"
                          class="px-2 py-0.5 rounded-md tabular-nums text-text-strong underline-offset-4 decoration-text-weak group-hover/kid:underline hover:bg-surface-raised-base-hover disabled:no-underline disabled:hover:bg-transparent"
                          disabled={state.level < 2}
                          onClick={() => setState("aiming", kid.story.id)}
                        >
                          {points()}h
                        </button>
                      }
                    >
                      <input
                        ref={(el) => setTimeout(() => (el.focus(), el.select()))}
                        data-action="p1-story-points-box"
                        type="number"
                        min="0"
                        step="0.5"
                        class="w-12 h-7 px-1.5 rounded-md bg-surface-base text-right tabular-nums text-13-regular text-text-strong outline-none shadow-[0_0_0_2px_var(--border-interactive-base)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        value={points()}
                        onKeyDown={(event) => {
                          // Esc puts the points back, so the box closing saves nothing.
                          if (event.key === "Escape") {
                            event.currentTarget.value = String(points())
                            return event.currentTarget.blur()
                          }
                          if (event.key === "Enter") event.currentTarget.blur()
                        }}
                        onBlur={(event) => {
                          setState("aiming", undefined)
                          void aim(kid.spec, kid.story, Number(event.currentTarget.value))
                        }}
                      />
                    </Show>
                  </span>
                </Match>
                {/* % finish, which turns into the time spent and left while you point at it; a task's, or a story's
                with tasks, can be changed there in place. */}
                <Match when={col.id === done()}>
                  <span
                    data-component="p1-kid-finish"
                    class="inline-flex h-7 items-center"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <span classList={{ "inline-flex": !timed(), hidden: timed() }}>
                      <Bar />
                    </span>
                    <span
                      data-component="p1-kid-time"
                      class="items-center gap-1 tabular-nums"
                      classList={{ hidden: !timed(), "inline-flex": timed() }}
                    >
                      <For each={["spent", "remain"] as const}>
                        {(part, index) => (
                          <>
                            <Show when={index() > 0}>
                              <span class="text-text-weaker">/</span>
                            </Show>
                            <Show
                              when={state.timing === `${key()}:${part}`}
                              fallback={
                                <button
                                  type="button"
                                  data-action={`p1-kid-${part}`}
                                  class="px-1 rounded tabular-nums text-text-strong underline underline-offset-4 decoration-text-weak hover:bg-surface-raised-base-hover disabled:no-underline disabled:hover:bg-transparent"
                                  disabled={state.level < 2}
                                  title={language.t(`p1.stories.sum.${part}`)}
                                  onClick={() => setState({ lit: key(), timing: `${key()}:${part}` })}
                                >
                                  {item()[part].toFixed(1)}h
                                </button>
                              }
                            >
                              <input
                                ref={(el) => setTimeout(() => (el.focus(), el.select()))}
                                data-action="p1-kid-time-box"
                                type="number"
                                min="0"
                                step="0.5"
                                class="w-12 h-7 px-1.5 rounded-md bg-surface-base text-right tabular-nums text-12-regular text-text-strong outline-none shadow-[0_0_0_2px_var(--border-interactive-base)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                value={Math.round(item()[part] * 10) / 10}
                                onKeyDown={(event) => {
                                  // Esc puts the time back, so the box closing saves nothing.
                                  if (event.key === "Escape") {
                                    event.currentTarget.value = String(Math.round(item()[part] * 10) / 10)
                                    return event.currentTarget.blur()
                                  }
                                  if (event.key === "Enter") event.currentTarget.blur()
                                }}
                                onBlur={(event) => {
                                  setState("timing", "")
                                  void retime(kid.spec, kid.story, kid.task, part, Number(event.currentTarget.value))
                                }}
                              />
                            </Show>
                          </>
                        )}
                      </For>
                    </span>
                  </span>
                </Match>
              </Switch>
            </td>
          )}
        </For>
      </tr>
    )
  }

  // Moves a requirement into a priority # group, out of the one it was in, keeping the groups in priority # order.
  const regroup = (id: number, key: string) =>
    setState("groups", (list) =>
      [...list, ...pads().filter((group) => group.key === key && !list.some((item) => item.key === key))]
        .map((group) => {
          const has = group.ids.includes(id)
          if (group.key === key) return has ? group : { ...group, ids: [...group.ids, id], count: group.count + 1 }
          return has ? { ...group, ids: group.ids.filter((item) => item !== id), count: group.count - 1 } : group
        })
        // A week first filled by this move takes its place among the others.
        .toSorted((a, b) => (range(a.name)?.lo ?? Infinity) - (range(b.name)?.lo ?? Infinity)),
    )

  // A card dropped on the board: it takes its new place and priority # at once, and P1 saves the priority #.
  // When P1 refuses, the list reloads as P1 has it.
  const drop = async (id: number, key: string, at: number, value: number) => {
    const row = state.rows.find((item) => item.id === id)
    if (!row) return
    const moved = { ...row, cells: { ...row.cells, 1132: String(value) } }
    const order = lanes().flatMap((lane) => {
      const rest = lane.rows.filter((item) => item.id !== id)
      return lane.key === key ? [...rest.slice(0, at), moved, ...rest.slice(at)] : rest
    })
    setState("rows", [...order, ...state.rows.filter((item) => item.id !== id && !order.includes(item))])
    regroup(id, key)
    if (String(value) === (row.cells[1132] ?? "")) return
    setState("saving", id, true)
    const host = p1.server()
    const token = p1.token()
    const locale = language.locale()
    const ok = await prime(host, token, state.root, id, p1.user(), locale)
      .then((found) =>
        update(
          host,
          token,
          { project: state.root, id, folder: found.folder, update: found.update, values: [{ ID: 1132, Value: value }] },
          locale,
        ),
      )
      .then(() => true)
      .catch((err: unknown) => {
        showToast({ variant: "error", title: `#${id}`, description: err instanceof Error ? err.message : String(err) })
        return false
      })
    setState("saving", id, false)
    if (ok) return void prime(host, token, state.root, id, p1.user(), locale, true).catch(() => undefined)
    void fill(state.root, state.folder, state.query.trim())
  }

  // A field edited on a card: the card shows the new value, and a new priority # moves it to that group.
  const edited = (row: Row, col: number, text: string) => {
    setState("rows", (item) => item.id === row.id, "cells", col, text)
    if (col === 1101) setState("rows", (item) => item.id === row.id, "title", text)
    if (col === 1113) setState("rows", (item) => item.id === row.id, "owner", text)
    if (col === 1131) setState("rows", (item) => item.id === row.id, "points", text)
    if (col !== 1132 || state.filter.group !== 1132) return
    const value = parseFloat(text) || 0
    const group = [...state.groups, ...pads()].find((item) => {
      const span = range(item.name)
      return span && value >= span.lo && value <= span.hi
    })
    if (group) regroup(row.id, group.key)
  }

  // Offer the P1 servers Kloud knows for this person instead of a blank address.
  void kloudP1Servers(kloudToken(), eadHttp()).then((list) => {
    setState("servers", list)
    if (list.length > 0 && !state.server && !p1.server()) setState("server", list[0].url)
  })
  // Servers match by host (Kloud may record http:// for a server signed in to over https); the address the
  // person last signed in to wins.
  const serverChoices = createMemo(() => {
    const current = p1.server()
    const host = (url: string) => url.replace(/^https?:\/\//i, "").toLowerCase()
    const list = state.servers.map((item) => (current && host(item.url) === host(current) ? { ...item, url: current } : item))
    const known = list.some((item) => item.url === current)
    return current && !known ? [{ url: current, name: "P1", company: "" }, ...list] : list
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
      const name = language.t("p1.col.priority")
      setState({ cols: named(got?.chosen ?? fallback, name), pool: named(got?.pool ?? [], name) })
    }
    if (!found) {
      setState({
        loading: false,
        folders: {},
        kids: {},
        open: {},
        top: [],
        rows: [],
        total: 0,
        folder: 0,
        root: 0,
        space: undefined,
      })
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
      document.querySelectorAll<HTMLElement>(`[data-folder="${id}"]`).forEach((row) => {
        const list = row.closest<HTMLElement>("[data-folders]")
        if (list) list.scrollTop = row.offsetTop - list.offsetTop - (list.clientHeight - row.offsetHeight) / 2
      }),
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
    const list = await children(host, p1.token(), state.root, id, language.locale(), state.prefs.closed).catch(
      (err: unknown) => {
        if (mark === stamp) fail(err)
      },
    )
    if (mark !== stamp || !list) return
    setState("folders", (prev) => ({ ...prev, ...Object.fromEntries(list.map((item) => [item.id, item])) }))
    setState(
      "kids",
      id,
      list.map((item) => item.id),
    )
    setState("parents", (prev) => ({ ...prev, ...Object.fromEntries(list.map((item) => [item.id, id])) }))
    // P1's count includes closed folders, which aren't listed; use what came back, as the web tree does.
    setState("folders", id, "count", list.length)
  }

  const fill = async (root: number, folder: number, query: string, mark = stamp, page = 1) => {
    const host = p1.server()
    const token = p1.token()
    if (!host || !token) return
    const mine = ++wave
    // A feature narrows one folder's list; another folder starts from all of it.
    if (folder !== state.folder) setState("feature", undefined)
    setState({ loading: true, folder, query, root, page })
    // A feature with no specs lists none, as there is nothing to ask P1 for.
    if (state.feature && !state.feature.ids.length) {
      setState({ rows: [], total: 0, groups: [], loading: false, err: "", checked: {}, tales: {} })
      return
    }
    // A feature lists its specs by id, as P1 searches for them.
    const words = state.feature ? state.feature.ids.join(",") : query
    void access(host, token, root, folder, language.locale())
      .then((level) => setState("level", level))
      .catch(() => setState("level", 0))
    // The link checks flag requirements rather than narrowing the list: P1 says which ones lack links,
    // asked alongside the list.
    const scope = { all: !state.prefs.current, closed: state.prefs.closed }
    const flag = (on: boolean, kind: "links" | "tests") =>
      on
        ? bare(host, token, root, folder, query, language.locale(), state.filter, scope, kind).catch(
            () => [] as number[],
          )
        : Promise.resolve([] as number[])
    // No linked test cases is read from each requirement's Linked Test Case Count (1607), which counts every test
    // case linked to it; P1's own filter counts only one kind of link. A server without the count uses the filter.
    const untested = state.filter.untested
    const flagged = Promise.all([flag(state.filter.unlinked, "links"), Promise.resolve([] as number[])])
    const list = await requirements(
      host,
      token,
      root,
      folder,
      words,
      language.locale(),
      [...state.cols.map((col) => col.id), ...(untested ? [count] : [])],
      // Weekly committed work only groups a folder that spans roadmap months, as in P1.
      {
        ...state.filter,
        unlinked: false,
        untested: false,
        group: state.filter.group === 1132 && !state.folders[folder]?.months ? 0 : state.filter.group,
      },
      scope,
      { index: page, size: state.filter.size ?? 100 },
    ).catch((err: unknown) => {
      if (mark === stamp && mine === wave) fail(err)
    })
    const [links] = await flagged
    if (mark !== stamp || mine !== wave || !list) return
    const counted = list.rows.some((row) => row.cells[count] !== undefined && row.cells[count] !== "")
    const tests = !untested
      ? []
      : counted
        ? list.rows.filter((row) => Number(row.cells[count]) === 0).map((row) => row.id)
        : await flag(true, "tests")
    if (mark !== stamp || mine !== wave) return
    setState({
      rows: list.rows,
      total: list.total,
      groups: list.groups,
      loading: false,
      err: "",
      checked: {},
      tales: {},
      warn: { links, tests },
    })
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
  const pages = () => Math.max(1, Math.ceil(state.total / (state.filter.size ?? 100)))
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

  // A folder's row; `flat` shows it alone, as a search result, without its subfolders.
  const node = (id: number, depth: number, flat = false): JSX.Element => (
    <Show when={state.folders[id]}>
      {(item) => (
        <>
          <div
            class="group/row w-full flex items-center gap-1 pr-1 rounded-lg text-13-regular"
            style={{ "padding-left": `${4 + depth * 16}px` }}
            onContextMenu={(event) => menu(event, id)}
            data-folder={id}
            classList={{
              "bg-surface-info-base text-text-strong font-medium shadow-[inset_2px_0_0_var(--text-interactive-base)]":
                id === state.folder,
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
              <Show
                when={typed(item().type)}
                fallback={<Icon name="folder" size="small" class="shrink-0 text-text-weak" />}
              >
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
          <Show when={state.open[id] && !flat}>
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
    ...(folder()?.months ? [{ id: 1132, name: language.t("p1.groupby.weekly") }] : []),
    { id: 1113, name: language.t("p1.groupby.spec") },
    ...(state.space?.dev ? [{ id: 1604, name: language.t("p1.groupby.story") }] : []),
    { id: 1110, name: language.t("p1.groupby.submitted") },
  ]

  // The selected folder's path from the top of the tree, as far as the tree has been read.
  const trail = createMemo(() => {
    const walk = (id: number, seen: number[]): number[] =>
      !id || seen.includes(id) || !state.folders[id] ? seen : walk(state.parents[id] ?? 0, [id, ...seen])
    return walk(state.folder, [])
  })
  let place: HTMLDivElement | undefined
  // Whenever the folders show, open the selected folder's parents and bring it to the middle of the panel; when the
  // selection changes while they show, just keep it in sight.
  const bring = (block: ScrollLogicalPosition) => {
    trail()
      .slice(0, -1)
      .forEach((id) => {
        if (state.open[id]) return
        setState("open", id, true)
        void branch(id)
      })
    // Only the folder list scrolls, so the rest of the page stays put.
    requestAnimationFrame(() =>
      document.querySelectorAll<HTMLElement>(`[data-folder="${state.folder}"]`).forEach((row) => {
        const list = row.closest<HTMLElement>("[data-folders]")
        if (!list) return
        const top = row.offsetTop - list.offsetTop
        const seen = top >= list.scrollTop && top + row.offsetHeight <= list.scrollTop + list.clientHeight
        if (block === "nearest" && seen) return
        list.scrollTop = top - (list.clientHeight - row.offsetHeight) / 2
      }),
    )
  }
  createEffect(on([() => !p1.folded() || state.peek, () => state.top.length], ([shown]) => shown && bring("center")))
  createEffect(
    on(
      () => state.folder,
      () => bring("nearest"),
      { defer: true },
    ),
  )
  createEffect(
    on([trail, () => state.wide, () => p1.width("tree")], () =>
      requestAnimationFrame(() => setState("long", !!place && place.scrollWidth > place.clientWidth + 1)),
    ),
  )

  // A closed folder shows only while the settings say to show closed folders.
  const shows = (id: number) => state.prefs.closed || !state.folders[id]?.closed
  // The folders read so far whose names hold the search, in tree order.
  const found = createMemo(() => {
    const words = state.seek.trim().toLowerCase()
    if (!words) return []
    const walk = (ids: number[]): number[] =>
      ids
        .filter(shows)
        .flatMap((id) => [
          ...(state.folders[id]?.name.toLowerCase().includes(words) ? [id] : []),
          ...walk(state.kids[id] ?? []),
        ])
    return walk(state.top)
  })

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

  // Opens the filter at once; the people and states it offers fill in as P1 sends them for this project and folder.
  const sift = async (at: DOMRect) => {
    const host = p1.server()
    const token = p1.token()
    const project = chosen()
    const locale = language.locale()
    setState({
      sift: at,
      choices: { ...state.choices, members: state.space?.dev ? (state.choices.members ?? []) : undefined },
    })
    const [who, how, team] = await Promise.all([
      owners(host, token, state.root, state.folder, locale).catch(() => [] as Choice[]),
      states(host, token, state.root, locale).catch(() => [] as Status[]),
      state.space?.dev && project
        ? members(host, token, { base: project.base, space: project.id, dev: state.space.dev }, locale).catch(
            () => [] as Choice[],
          )
        : Promise.resolve(undefined),
    ])
    setState("choices", { owners: who, states: how, members: team })
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

  const line =
    "w-full px-2.5 py-2 flex items-center gap-2.5 rounded-lg text-left text-13-regular text-text-strong hover:bg-surface-base-hover disabled:text-text-weaker disabled:hover:bg-transparent"

  // The folder tree's width, dragged between half and double its usual 256px and kept in P1 settings.
  // Shown over the list while closed, it keeps the same width.
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
      style={{
        width: `${over ? Math.max(240, Math.min(560, Math.max(200, p1.width("features") ?? 300)) - 24) : breadth()}px`,
      }}
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
      {/* Finds a folder by name among those read so far, and reads the tree again. */}
      <div class="shrink-0 h-12 pl-3 pr-2 flex items-center gap-1.5 border-b border-border-weaker-base">
        <label class="min-w-0 flex-1 h-8 px-2.5 flex items-center gap-2 rounded-lg border border-border-weaker-base bg-surface-base focus-within:border-border-interactive-base">
          <Icon name="magnifying-glass" size="small" class="shrink-0 text-icon-weak" />
          <input
            data-action="p1-folders-search"
            class="min-w-0 flex-1 bg-transparent text-13-regular text-text-strong placeholder:text-text-weak outline-none"
            value={state.seek}
            placeholder={language.t("p1.folders.search")}
            onInput={(event) => setState("seek", event.currentTarget.value)}
            onKeyDown={(event) => event.key === "Escape" && setState("seek", "")}
          />
          <Show when={state.seek}>
            <button
              type="button"
              class="shrink-0 size-5 rounded flex items-center justify-center text-icon-weak hover:text-text-strong"
              aria-label={language.t("p1.folders.clear")}
              onClick={() => setState("seek", "")}
            >
              <Icon name="close-small" size="small" />
            </button>
          </Show>
        </label>
        <button
          type="button"
          data-action="p1-folders-refresh"
          class="shrink-0 size-8 rounded-lg flex items-center justify-center border border-border-weaker-base bg-surface-base text-text-base hover:text-text-strong hover:bg-surface-base-hover disabled:opacity-50"
          aria-label={language.t("p1.refresh")}
          title={language.t("p1.refresh")}
          disabled={!state.project}
          onClick={() => state.project && void pick(state.project)}
        >
          <Refresh spin={state.loading} />
        </button>
      </div>
      <div data-folders class="relative flex-1 min-h-0 overflow-y-auto px-2 pt-2 pb-3 flex flex-col gap-0.5">
        <Show
          when={state.top.length}
          fallback={<Hint text={language.t(state.loading ? "p1.loading" : "p1.empty.folders")} />}
        >
          <Show when={state.seek.trim()} fallback={<For each={state.top.filter(shows)}>{(id) => node(id, 0)}</For>}>
            <Show when={found().length} fallback={<Hint text={language.t("p1.folders.nomatch")} />}>
              <For each={found()}>{(id) => node(id, 0, true)}</For>
            </Show>
          </Show>
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
                  <Show when={!state.edit && state.servers.length > 0}>
                    <label class="flex flex-col gap-1.5">
                      <span class="text-12-regular text-text-weak">{language.t("p1.login.server")}</span>
                      <select
                        class={field}
                        name="server"
                        value={state.server || p1.server()}
                        onChange={(event) => {
                          const value = event.currentTarget.value
                          if (value === "__new") setState({ edit: true, server: "" })
                          else setState("server", value)
                        }}
                      >
                        <For each={serverChoices()}>
                          {(item) => (
                            <option value={item.url}>
                              {item.company ? `${item.company} · ${item.url.replace(/^https?:\/\//, "")}` : item.url}
                            </option>
                          )}
                        </For>
                        <option value="__new">{language.t("p1.login.newServer")}</option>
                      </select>
                    </label>
                  </Show>
                  <Show when={state.servers.length === 0 && (state.edit || !p1.server())}>
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
                  <Show when={state.edit && state.servers.length > 0}>
                    <label class="flex flex-col gap-1.5">
                      <span class="text-12-regular text-text-weak">{language.t("p1.login.newServer")}</span>
                      <input
                        class={field}
                        name="server"
                        value={state.server}
                        placeholder="https://"
                        onInput={(event) => setState("server", event.currentTarget.value)}
                      />
                    </label>
                  </Show>
                  <Show when={state.servers.length === 0 && !state.edit && p1.server()}>
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
                          <For each={families()}>
                            {(item) => <option value={item.id}>{item.name || item.id}</option>}
                          </For>
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
            {/* Reads the projects again when none loaded, else the folder's requirements. */}
            <Tooltip placement="bottom" value={language.t("p1.refresh")}>
              <button
                type="button"
                data-action="p1-refresh"
                class="size-7 shrink-0 rounded-md flex items-center justify-center text-icon-base hover:text-text-strong hover:bg-surface-raised-base-hover disabled:opacity-50"
                aria-label={language.t("p1.refresh")}
                disabled={state.loading}
                onClick={() =>
                  state.project && state.root ? void fill(state.root, state.folder, state.query.trim()) : void load()
                }
              >
                <Refresh spin={state.loading} />
              </button>
            </Tooltip>
          </div>
        </Portal>
        {/* Team performance for the selected roadmap month, in the rail second from the bottom: the team's score as a
        gold bar, its high and low on hover, opening the workload and performance report. */}
        <Show when={work() && document.getElementById("rail-view")}>
          {(slot) => (
            <Portal mount={slot()}>
              <Tooltip
                placement="right"
                value={
                  <div class="flex flex-col gap-0.5">
                    <span class="pb-1 text-text-invert-strong font-medium">{language.t("p1.work.performance")}</span>
                    <For
                      each={
                        [
                          [language.t("p1.work.team"), state.team?.score ?? 0],
                          [language.t("p1.work.high"), state.team?.high ?? 0],
                          [language.t("p1.work.low"), state.team?.low ?? 0],
                        ] as const
                      }
                    >
                      {(item) => (
                        <div class="flex items-center justify-between gap-4">
                          <span class="text-text-invert-base">{item[0]}</span>
                          <span class="text-text-invert-strong tabular-nums">{item[1]}</span>
                        </div>
                      )}
                    </For>
                  </div>
                }
              >
                <button
                  type="button"
                  data-action="p1-work-score"
                  aria-label={language.t("p1.work.performance")}
                  class="w-12 py-1.5 rounded-lg flex flex-col items-center gap-1 text-text-weak hover:bg-surface-base-hover hover:text-text-base"
                  classList={{ "bg-surface-info-base text-text-interactive-base": state.report }}
                  onClick={() => setState("report", !state.report)}
                >
                  <Trophy />
                  <span class="w-8 h-1 rounded-full bg-border-weak-base overflow-hidden">
                    <span
                      class="block h-full min-w-0.5 rounded-full bg-gradient-to-r from-[#f0c46c] to-[#e2a83e]"
                      style={{ width: `${Math.min(100, (state.team?.score ?? 0) * 10)}%` }}
                    />
                  </span>
                  <span class="text-[11px] font-medium leading-none tabular-nums">{state.team?.score ?? 0}</span>
                </button>
              </Tooltip>
            </Portal>
          )}
        </Show>
        <Show when={state.err}>
          <p class="shrink-0 px-4 py-2 text-12-regular text-text-diff-delete-base border-b border-border-weaker-base">
            {state.err}
          </p>
        </Show>
        <div class="shrink-0 h-14 pl-3 pr-4 flex items-center gap-3 border-b border-border-weaker-base">
          {/* The selected folder, as P1 heads its list with it; its actions are in the tree. */}
          {/* The folder and the arrow that opens or closes the folder panel, as wide as the panel so the arrow sits on
            its edge. While the panel is closed, pointing anywhere here shows the folders over the list. */}
          <div
            data-component="p1-place"
            class="shrink-0 min-w-0 h-10 -my-1 pl-1 -ml-1 flex items-center gap-2 rounded-lg"
            classList={{ "bg-surface-base": p1.folded() && state.peek }}
            style={{ width: `${breadth() - 28}px` }}
            onMouseEnter={() => p1.folded() && peek(true)}
            onMouseLeave={() => p1.folded() && peek(false)}
          >
            <Show when={folder()} fallback={<Icon name="folder" size="small" class="shrink-0 text-text-weak" />}>
              {(item) => (
                <Show
                  when={typed(item().type)}
                  fallback={<Icon name="folder" size="small" class="shrink-0 text-text-weak" />}
                >
                  <FolderType type={item().type} closed={item().closed} />
                </Show>
              )}
            </Show>
            {/* The folder's path, right-aligned in about 70% of the panel so its own name always shows in full; the
              path's start fades out when it doesn't fit. */}
            <div
              ref={(el) => (place = el)}
              data-component="p1-path"
              class="min-w-0 flex justify-end items-center gap-1 overflow-hidden whitespace-nowrap"
              style={{
                "max-width": `${Math.round(breadth() * 0.7)}px`,
                "mask-image": state.long ? "linear-gradient(to right, transparent, black 28px)" : undefined,
              }}
              title={trail()
                .map((id) => state.folders[id]?.name)
                .join(" / ")}
            >
              <For each={trail().slice(0, -1)}>
                {(id) => (
                  <>
                    <span class="shrink-0 text-13-regular text-text-weak">{state.folders[id]?.name}</span>
                    <Icon name="chevron-right" size="small" class="shrink-0 text-icon-weaker" />
                  </>
                )}
              </For>
              <span class="shrink-0 text-14-medium text-text-strong">
                {folder()?.name ?? language.t("p1.requirements")}
              </span>
            </div>
            <div class="flex-1" />
            {/* Opens or closes the folder panel: pointing left to open it, right to close it. */}
            <button
              type="button"
              data-action={p1.folded() ? "p1-folders-show" : "p1-folders-hide"}
              class="shrink-0 size-8 rounded-md flex items-center justify-center text-text-base hover:text-text-strong hover:bg-surface-base-hover"
              aria-label={language.t(p1.folded() ? "p1.folders.show" : "p1.folders.hide")}
              title={language.t(p1.folded() ? "p1.folders.show" : "p1.folders.hide")}
              onClick={() => (setState("peek", false), p1.fold(!p1.folded()))}
            >
              <Collapse open={!p1.folded()} />
            </button>
          </div>
          <button
            type="button"
            data-action="p1-filter"
            class="shrink-0 relative size-8 rounded-lg flex items-center justify-center border transition-colors"
            classList={{
              "bg-surface-interactive-base border-transparent text-text-on-interactive-base hover:opacity-90": active(
                state.filter,
              ),
              "border-border-weaker-base bg-surface-base text-text-strong hover:bg-surface-base-hover": !active(
                state.filter,
              ),
            }}
            disabled={!state.root}
            aria-label={language.t("p1.filter.title")}
            title={language.t("p1.filter.title")}
            aria-pressed={active(state.filter)}
            onClick={(event) => void sift(event.currentTarget.getBoundingClientRect())}
          >
            <Icon name="sliders" size="small" class="[&_path]:[stroke-width:1.75]" />
          </button>
          {/* The product feature map beside the list, on or off. */}
          <button
            type="button"
            data-action="p1-features"
            class="shrink-0 size-8 rounded-lg flex items-center justify-center border transition-colors"
            classList={{
              "bg-surface-interactive-base border-transparent text-text-on-interactive-base hover:opacity-90":
                p1.mapped(),
              "border-border-weaker-base bg-surface-base text-text-strong hover:bg-surface-base-hover": !p1.mapped(),
            }}
            disabled={!state.root}
            aria-label={language.t("p1.features.title")}
            title={language.t("p1.features.title")}
            aria-pressed={p1.mapped()}
            onClick={() => {
              p1.map(!p1.mapped())
              // Closing the map lists every requirement again.
              if (p1.mapped() || !state.feature) return
              setState("feature", undefined)
              void fill(state.root, state.folder, state.query.trim())
            }}
          >
            <FeatureMap />
          </button>
          {/* P1's saved search, advanced search and cancel search, then the search. */}
          <P1Query
            project={state.root}
            folder={state.folder}
            value={state.filter.query}
            disabled={!state.root}
            onChange={(query) => refine({ ...state.filter, query })}
          />
          <label class="w-[180px] xl:w-[220px] min-w-0 h-8 px-2.5 flex items-center gap-2 rounded-lg border border-border-weaker-base bg-surface-base focus-within:border-border-interactive-base">
            <Icon name="magnifying-glass" size="small" class="shrink-0 text-icon-weak" />
            <input
              ref={(el) => (finder = el)}
              data-action="p1-search"
              class="min-w-0 flex-1 bg-transparent text-13-regular text-text-strong placeholder:text-text-weak outline-none"
              value={state.query}
              placeholder={language.t("p1.search.requirement")}
              onInput={(event) => search(event.currentTarget.value)}
            />
            <span class="shrink-0 text-12-regular text-text-weaker">⌘K</span>
          </label>
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
          <Show when={p1.mapped() && state.root && state.folder}>
            <P1Features
              place={{ project: state.root, space: state.space?.folder ?? 0, folder: state.folder }}
              products={state.space?.products ?? []}
              picked={state.feature?.id}
              onPick={(pick) => {
                setState("feature", pick)
                void fill(state.root, state.folder, state.query.trim())
              }}
            />
          </Show>
          <section ref={(el) => (pane = el)} class="relative flex-1 min-w-0 flex flex-col min-h-0">
            {/* The list's own bar, as in P1: how it is grouped, its search, and its pages. */}
            <div class="shrink-0 h-12 pl-3 pr-4 flex items-center gap-3 border-b border-border-weaker-base">
              {/* List, board, or the weekly board, which needs a roadmap month folder. */}
              <div class="shrink-0 flex items-center p-0.5 rounded-lg border border-border-weaker-base bg-surface-base">
                <For each={["list", "board", "weekly"] as const}>
                  {(view) => (
                    <span class="relative group/tip">
                      <button
                        type="button"
                        data-action={`p1-view-${view}`}
                        disabled={view === "weekly" && !folder()?.months}
                        class="h-7 px-3 rounded-md text-13-medium disabled:text-text-weaker disabled:cursor-default"
                        classList={{
                          "bg-background-base text-text-strong shadow-xs": shape() === view,
                          "text-text-weak hover:text-text-base": shape() !== view,
                        }}
                        aria-pressed={shape() === view}
                        onClick={() => p1.show(view)}
                      >
                        {language.t(`p1.view.${view}`)}
                      </button>
                      <Show when={view === "weekly" && !folder()?.months}>
                        <Tip text={language.t("p1.weekly.month")} />
                      </Show>
                    </span>
                  )}
                </For>
              </div>
              <P1Group
                value={groupings().some((item) => item.id === state.filter.group) ? state.filter.group : 0}
                items={groupings()}
                disabled={!state.root}
                // The weekly board is always by story owner.
                fixed={shape() === "weekly" ? language.t("p1.groupby.owner") : undefined}
                // Grouping by spec and story owner is about stories, so it turns them on.
                onPick={(group) => refine({ ...state.filter, group, stories: group === 1604 || state.filter.stories })}
              />
              <Show when={state.feature}>
                {(pick) => (
                  <span
                    data-component="p1-feature-chip"
                    class="min-w-0 max-w-64 h-8 pl-2.5 pr-1 flex items-center gap-1.5 rounded-lg border border-border-interactive-base bg-surface-interactive-weak text-13-regular text-text-strong"
                  >
                    <FeatureMap />
                    <span class="min-w-0 truncate">{pick().title}</span>
                    <button
                      type="button"
                      data-action="p1-feature-clear"
                      class="size-6 shrink-0 rounded-md flex items-center justify-center text-icon-base hover:text-text-strong hover:bg-surface-base-hover"
                      aria-label={language.t("p1.features.every")}
                      title={language.t("p1.features.every")}
                      onClick={() => {
                        setState("feature", undefined)
                        void fill(state.root, state.folder, state.query.trim())
                      }}
                    >
                      <Icon name="close-small" size="small" />
                    </button>
                  </span>
                )}
              </Show>
              <div class="flex-1" />
              <Show when={state.root && state.folder}>
                <div data-component="p1-pager" class="shrink-0 flex items-center gap-2 text-13-regular text-text-weak">
                  <span class="tabular-nums">{language.t("p1.page.total", { count: state.total })}</span>
                  <button
                    type="button"
                    data-action="p1-page-prev"
                    class="size-8 rounded-lg flex items-center justify-center border border-border-weaker-base bg-surface-base text-text-strong hover:bg-surface-base-hover disabled:opacity-40 disabled:hover:bg-surface-base"
                    aria-label={language.t("p1.page.prev")}
                    disabled={state.loading || state.page <= 1}
                    onClick={() => void fill(state.root, state.folder, state.query.trim(), stamp, state.page - 1)}
                  >
                    <Icon name="chevron-left" size="small" />
                  </button>
                  <span class="min-w-8 h-8 px-2 rounded-lg flex items-center justify-center border border-border-interactive-base text-13-medium text-text-strong tabular-nums">
                    {state.page}
                  </span>
                  <button
                    type="button"
                    data-action="p1-page-next"
                    class="size-8 rounded-lg flex items-center justify-center border border-border-weaker-base bg-surface-base text-text-strong hover:bg-surface-base-hover disabled:opacity-40 disabled:hover:bg-surface-base"
                    aria-label={language.t("p1.page.next")}
                    disabled={state.loading || state.page >= pages()}
                    onClick={() => void fill(state.root, state.folder, state.query.trim(), stamp, state.page + 1)}
                  >
                    <Icon name="chevron-right" size="small" />
                  </button>
                  <select
                    data-action="p1-page-size"
                    class="h-8 pl-2 pr-1 rounded-lg border border-border-weaker-base bg-surface-base text-13-regular text-text-strong outline-none"
                    value={state.filter.size ?? 100}
                    onChange={(event) => refine({ ...state.filter, size: Number(event.currentTarget.value) })}
                  >
                    <For each={[50, 100, 200]}>
                      {(size) => <option value={size}>{language.t("p1.page.size", { size })}</option>}
                    </For>
                  </select>
                </div>
              </Show>
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
                      when={shape() !== "weekly" || !folder()?.months}
                      fallback={
                        <P1Weekly
                          month={month(folder()!.months!)}
                          rows={state.rows}
                          tales={state.tales}
                          readonly={state.level < 2}
                          onStory={(spec, story, x, y) => setState({ points: { id: spec, x, y, tale: story } })}
                          onMove={(spec, story, change) => void plan(spec, story, change)}
                        />
                      }
                    >
                      <Show
                        when={shape() === "board"}
                        fallback={
                          <table
                            class="table-fixed text-left border-collapse"
                            style={{
                              width: `${shown().reduce((sum, col) => sum + size(col), lead)}px`,
                              "min-width": "100%",
                            }}
                            data-component="p1-list"
                          >
                            <thead class="sticky top-0 z-10 bg-[color-mix(in_srgb,var(--text-interactive-base)_13%,var(--background-base))]">
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
                                        Object.fromEntries(
                                          state.rows.map((row) => [row.id, event.currentTarget.checked]),
                                        ),
                                      )
                                    }
                                  />
                                </th>
                                <th style={{ width: `${mark}px` }} />
                                <For each={shown()}>
                                  {(col) => (
                                    <th
                                      data-col={col.id}
                                      class="group/th relative py-2.5 font-medium whitespace-nowrap cursor-grab select-none"
                                      classList={{
                                        "px-4 overflow-hidden text-ellipsis": !flag(col.id),
                                        "px-1 text-center": !!flag(col.id),
                                        "text-right": numeric(col.id),
                                        "opacity-30": state.move?.id === col.id,
                                        "shadow-[inset_3px_0_0_var(--border-interactive-base)]": slot(col) === "left",
                                        "shadow-[inset_-3px_0_0_var(--border-interactive-base)]": slot(col) === "right",
                                      }}
                                      style={fit(col)}
                                      onPointerDown={(event) => move(event, col)}
                                    >
                                      {/* A warning column's heading is its icon, and it keeps its width. */}
                                      <Show
                                        when={flag(col.id)}
                                        fallback={
                                          <span
                                            class="flex w-full items-center gap-1.5"
                                            classList={{ "justify-end": numeric(col.id) }}
                                          >
                                            <span class="min-w-0 truncate" classList={{ "flex-1": !numeric(col.id) }}>
                                              {col.id === priority && size(col) < 112
                                                ? "P #"
                                                : col.id === fin() && state.kin
                                                  ? language.t("p1.stories.col.time")
                                                  : col.name}
                                            </span>
                                            {/* The column the list is sorted by shows its direction at its far right, as in P1;
                                              a click turns it around. */}
                                            <Show when={rank(col.id) === 0}>
                                              <button
                                                type="button"
                                                data-action="p1-sort-flip"
                                                class="shrink-0 size-5 -my-1 -mr-1.5 rounded flex items-center justify-center text-icon-interactive-base hover:bg-surface-base-hover"
                                                aria-label={language.t("p1.sort.flip")}
                                                onPointerDown={(event) => event.stopPropagation()}
                                                onClick={(event) => {
                                                  event.stopPropagation()
                                                  sort(flip(state.filter.sort))
                                                }}
                                              >
                                                <svg
                                                  class="size-2.5"
                                                  classList={{ "rotate-180": sorting()[0].down }}
                                                  viewBox="0 0 10 10"
                                                  aria-hidden="true"
                                                >
                                                  <path d="M5 2.25L9 7.75H1L5 2.25Z" fill="currentColor" />
                                                </svg>
                                              </button>
                                            </Show>
                                            {/* Any other column shows, while pointed at, its own direction: clicking the
                                              triangle sorts by the column that way. */}
                                            <Show when={rank(col.id) !== 0}>
                                              <button
                                                type="button"
                                                data-action="p1-sort-by"
                                                class="shrink-0 size-5 -my-1 -mr-1.5 rounded flex items-center justify-center text-text-weak opacity-0 group-hover/th:opacity-100 hover:text-text-strong hover:bg-surface-base-hover transition-opacity"
                                                aria-label={language.t("p1.sort.by")}
                                                onPointerDown={(event) => event.stopPropagation()}
                                                onClick={(event) => {
                                                  event.stopPropagation()
                                                  sort(resort(state.filter.sort, col.id, way(col, state.filter.ways)))
                                                }}
                                              >
                                                <svg
                                                  class="size-2.5"
                                                  classList={{ "rotate-180": way(col, state.filter.ways) }}
                                                  viewBox="0 0 10 10"
                                                >
                                                  <path d="M5 2.25L9 7.75H1L5 2.25Z" fill="currentColor" />
                                                </svg>
                                              </button>
                                            </Show>
                                          </span>
                                        }
                                      >
                                        {(kind) => <Flag kind={kind()} />}
                                      </Show>
                                      <div
                                        data-action="p1-resize"
                                        classList={{ "pointer-events-none": !!flag(col.id) }}
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
                                            setState(
                                              "sizes",
                                              col.id,
                                              Math.max(least(col), Math.round(from + next.clientX - start)),
                                            )
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
                                          span={shown().length + 2}
                                          shut={!!state.shut[group().key]}
                                          month={folder()?.months ? month(folder()!.months!) : undefined}
                                          onToggle={() => setState("shut", group().key, (value) => !value)}
                                        />
                                      )}
                                    </Show>
                                    <For each={part.rows}>
                                      {(row) => (
                                        <>
                                          <tr
                                            data-action="p1-requirement"
                                            class="group/req border-b border-border-weaker-base hover:bg-surface-base-hover"
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
                                                onChange={(event) =>
                                                  setState("checked", row.id, event.currentTarget.checked)
                                                }
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
                                            <For each={shown()}>
                                              {(col) => (
                                                <td
                                                  data-col={col.id}
                                                  class="py-3 text-13-regular text-text-base align-middle break-words"
                                                  onMouseEnter={() =>
                                                    (col.id === 1503 || col.id === 1510) && kin(row.id)
                                                  }
                                                  onMouseLeave={() => (col.id === 1503 || col.id === 1510) && kin(0)}
                                                  classList={{
                                                    // Opens the family's frame while its time shows.
                                                    [frame(
                                                      true,
                                                      !state.filter.stories || !kids(row.id, part.group).length,
                                                    )]:
                                                      col.id === fin() &&
                                                      state.kin === row.id &&
                                                      !!state.tales[row.id]?.length,
                                                    "px-4": !flag(col.id),
                                                    // % finish shows its time spent and left in a card below it, which mustn't be cut off.
                                                    "overflow-hidden":
                                                      !flag(col.id) && col.id !== 1503 && col.id !== 1510,
                                                    "px-1 text-center": !!flag(col.id),
                                                    "text-right": numeric(col.id),
                                                    "cursor-pointer hover:shadow-[inset_0_0_0_1px_var(--border-weak-base)]":
                                                      p1.edit() === "inline" && editable(col.id, true),
                                                    "cursor-pointer": col.id !== 1131 && !flag(col.id),
                                                    "bg-surface-base-hover": state.panel === row.id,
                                                    "opacity-30": state.move?.id === col.id,
                                                    "shadow-[inset_3px_0_0_var(--border-interactive-base)]":
                                                      slot(col) === "left",
                                                    "shadow-[inset_-3px_0_0_var(--border-interactive-base)]":
                                                      slot(col) === "right",
                                                  }}
                                                  style={fit(col)}
                                                  onPointerEnter={() => {
                                                    clearTimeout(hover)
                                                    if (col.id === 1131 || flag(col.id)) return
                                                    // Resting on a cell starts loading its requirement, so a click opens at once.
                                                    hover = setTimeout(
                                                      () =>
                                                        void prime(
                                                          p1.server(),
                                                          p1.token(),
                                                          state.root,
                                                          row.id,
                                                          p1.user(),
                                                          language.locale(),
                                                        ).catch(() => undefined),
                                                      150,
                                                    )
                                                  }}
                                                  onPointerLeave={() => clearTimeout(hover)}
                                                  onClick={(event) => {
                                                    event.stopPropagation()
                                                    if (flag(col.id)) return
                                                    // As in P1: the ID opens the spec's editor, a field edited in place
                                                    // puts the docked editor away, and any other field opens it docked.
                                                    if (col.id === 1112)
                                                      return setState({ panel: undefined, item: row.id })
                                                    // A spec's points are read only here; the stories icon beside them opens the stories.
                                                    if (col.id === 1131) return
                                                    // The list's settings pick one way to edit: every field in the panel,
                                                    // or in place where P1 allows it and the row's menu elsewhere.
                                                    // In the panel, a click on a cell's text opens the spec and a click
                                                    // on its empty space puts the panel away.
                                                    if (p1.edit() === "panel")
                                                      return setState({
                                                        typing: undefined,
                                                        panel: (event.target as HTMLElement).closest("[data-text]")
                                                          ? row.id
                                                          : undefined,
                                                      })
                                                    if (editable(col.id, true))
                                                      return setState({
                                                        panel: undefined,
                                                        typing: { id: row.id, col: col.id },
                                                      })
                                                    setState({
                                                      panel: undefined,
                                                      act: { id: row.id, x: event.clientX, y: event.clientY },
                                                    })
                                                  }}
                                                >
                                                  <Show
                                                    when={state.typing?.id === row.id && state.typing.col === col.id}
                                                    fallback={
                                                      <Show
                                                        when={flag(col.id)}
                                                        fallback={
                                                          <Cell
                                                            col={col.id}
                                                            row={row}
                                                            sum={
                                                              state.tales[row.id]?.length
                                                                ? total(lay(state.tales[row.id], p1.clocks()))
                                                                : undefined
                                                            }
                                                            timed={state.kin === row.id}
                                                            onStories={(event) => {
                                                              event.stopPropagation()
                                                              setState({
                                                                typing: undefined,
                                                                points: {
                                                                  id: row.id,
                                                                  x: event.clientX,
                                                                  y: event.clientY,
                                                                },
                                                              })
                                                            }}
                                                          />
                                                        }
                                                      >
                                                        {(kind) => (
                                                          <Show when={state.warn[kind()].includes(row.id)}>
                                                            <Flag kind={kind()} id={row.id} />
                                                          </Show>
                                                        )}
                                                      </Show>
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
                                                        if (text !== undefined)
                                                          setState(
                                                            "rows",
                                                            (item) => item.id === row.id,
                                                            "cells",
                                                            col.id,
                                                            text,
                                                          )
                                                        if (text !== undefined && col.id === 1101)
                                                          setState("rows", (item) => item.id === row.id, "title", text)
                                                        if (state.typing?.id === row.id && state.typing.col === col.id)
                                                          setState("typing", undefined)
                                                      }}
                                                    />
                                                  </Show>
                                                </td>
                                              )}
                                            </For>
                                          </tr>
                                          <Show when={state.filter.stories}>
                                            <For each={kids(row.id, part.group)}>
                                              {(story, at) => {
                                                // The family's last row closes its frame: the last story, or its last task.
                                                const last = () => at() === kids(row.id, part.group).length - 1
                                                const bare = () => !state.filter.tasks || !story.tasks.length
                                                return (
                                                  <>
                                                    <Kid spec={row.id} story={story} end={last() && bare()} />
                                                    <Show when={state.filter.tasks}>
                                                      <For each={story.tasks}>
                                                        {(task, index) => (
                                                          <Kid
                                                            spec={row.id}
                                                            story={story}
                                                            task={task}
                                                            end={last() && index() === story.tasks.length - 1}
                                                          />
                                                        )}
                                                      </For>
                                                    </Show>
                                                  </>
                                                )
                                              }}
                                            </For>
                                          </Show>
                                        </>
                                      )}
                                    </For>
                                  </>
                                )}
                              </For>
                            </tbody>
                          </table>
                        }
                      >
                        <P1Board
                          lanes={lanes()}
                          project={state.root}
                          folder={state.folder}
                          sortable={state.filter.group === 1132 && !!state.groups.length}
                          readonly={state.level < 2}
                          opening={state.opening}
                          saving={state.saving}
                          onOpen={(id) => setState("item", id)}
                          onLinks={(id) => setState({ item: id, tab: 107 })}
                          onMenu={(id, x, y) => setState("act", { id, x, y })}
                          onEdited={edited}
                          onPoints={(id, x, y) => setState("points", { id, x, y })}
                          tales={state.filter.stories ? state.tales : undefined}
                          tasks={!!state.filter.stories && !!state.filter.tasks}
                          warn={state.warn}
                          onTask={(spec, story, task, owner) => void delegate(spec, story, task, owner)}
                          crew={state.crew}
                          onOwner={(spec, story, owner) => void assign(spec, story, owner)}
                          onMove={(id, key, at, value) => void drop(id, key, at, value)}
                        />
                      </Show>
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
                    space={state.space}
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
      <Show when={state.swap}>
        {(swap) => (
          <Menu
            at={swap().at}
            items={state.crew}
            picked={[String((swap().task ?? swap().story).owner)]}
            many={false}
            people
            clear={false}
            onPick={(id) => {
              const done = swap()
              setState("swap", undefined)
              if (!Number(id) || Number(id) === (done.task ?? done.story).owner) return
              if (done.task) return void delegate(done.spec, done.story, done.task, Number(id))
              void assign(done.spec, done.story, Number(id))
            }}
            onClose={() => setState("swap", undefined)}
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
              ask={props.ask}
              x={open().x}
              y={open().y}
              story={open().story}
              tale={open().tale}
              onClose={(changed) => {
                if (changed)
                  void prime(p1.server(), p1.token(), state.root, open().id, p1.user(), language.locale(), true).catch(
                    () => undefined,
                  )
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
            <div
              class="fixed inset-0 z-40"
              onClick={() => setState("menu", undefined)}
              onContextMenu={(event) => {
                event.preventDefault()
                setState("menu", undefined)
              }}
            />
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
                <div class="relative" onMouseEnter={() => sub(true)} onMouseLeave={() => sub(false)}>
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
                                onClick={() =>
                                  setState({ menu: undefined, dir: { id: open().id, place: entry.place } })
                                }
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
          space={state.space}
          id={state.item || undefined}
          tab={state.tab}
          onClose={() => setState({ item: undefined, tab: undefined })}
          onSaved={(id) => {
            void prime(p1.server(), p1.token(), state.root, id, p1.user(), language.locale(), true).catch(
              () => undefined,
            )
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
// A link warning column's width.
const warn = 40
// P1's Linked Test Case Count field.
const count = 1607

/** Which link warning a list column stands for: the warning columns take ids P1's fields never use. */
function flag(id: number) {
  if (id === -1) return "links" as const
  if (id === -2) return "tests" as const
}

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
  // Priority # narrows to "P #" and two-digit values.
  if (col.id === priority) return 64
  return Math.max(numeric(col.id) || col.id === 1112 ? 64 : 88, col.name.length * 7 + 40)
}

/** One list cell, drawn the way P1 draws that field. */
function Cell(props: {
  col: number
  row: Row
  // The spec's points, time and % finish from its stories, once they are read.
  sum?: { points: number; spent: number; remain: number; finish?: number }
  // Whether its family's time shows.
  timed?: boolean
  onStories: (event: MouseEvent) => void
}) {
  const language = useLanguage()
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
  // A spec's points, shown only: they are its stories' to change. On the row's hover, the stories and tasks icon
  // before them opens their dialog.
  if (props.col === 1131)
    return (
      <span class="inline-flex items-center gap-1">
        <button
          type="button"
          data-action="p1-points-stories"
          class="size-7 shrink-0 rounded-md flex items-center justify-center opacity-0 group-hover/req:opacity-100 focus-visible:opacity-100 hover:bg-surface-raised-base-hover"
          aria-label={language.t("p1.points.open")}
          title={language.t("p1.points.open")}
          onClick={(event) => props.onStories(event)}
        >
          <Stories />
        </button>
        <span data-action="p1-points" class="px-2 py-0.5 tabular-nums text-text-strong" data-text>
          {Math.round((props.sum ? props.sum.points : parseFloat(value()) || 0) * 10) / 10}h
        </span>
      </span>
    )
  if (props.col === 1137) return <span data-text>{props.row.attachments || ""}</span>
  if (props.col === 1139) return <span data-text>{value().replace(",", "/")}</span>
  if (props.col === 1601)
    return <span data-text>{/^\d{6}$/.test(value()) ? `${value().slice(0, 4)}-${value().slice(4)}` : value()}</span>
  if (props.col === 1503 || props.col === 1510) {
    // From its stories' time once they are read, else as P1 has it.
    const pct = () => Math.max(0, Math.min(100, props.sum?.finish ?? (parseFloat(value()) || 0)))
    return (
      // While any of its family is pointed at for % finish, the spec's time spent and left, added up from its
      // stories, shown only.
      <div data-text class="inline-flex h-7 items-center">
        <div
          classList={{
            "inline-flex items-center gap-2": !props.sum || !props.timed,
            hidden: !!props.sum && !!props.timed,
          }}
        >
          <div class="h-1.5 w-16 rounded-full bg-surface-base overflow-hidden">
            <div class="h-full bg-surface-interactive-base" style={{ width: `${pct()}%` }} />
          </div>
          <span class="text-12-regular text-text-weak">
            {props.sum?.finish !== undefined ? `${pct()}%` : value() || "0%"}
          </span>
        </div>
        <Show when={props.sum}>
          {(sum) => (
            <span
              data-component="p1-spec-time"
              class="items-center gap-1 tabular-nums text-12-regular text-text-strong"
              classList={{ hidden: !props.timed, "inline-flex": !!props.timed }}
            >
              <span class="px-1" title={language.t("p1.stories.sum.spent")}>
                {sum().spent.toFixed(1)}h
              </span>
              <span class="text-text-weaker">/</span>
              <span class="px-1" title={language.t("p1.stories.sum.remain")}>
                {sum().remain.toFixed(1)}h
              </span>
            </span>
          )}
        </Show>
      </div>
    )
  }
  return (
    <div class="truncate">
      <span data-text>{value() === "0" && props.col === 1608 ? "" : value()}</span>
    </div>
  )
}

/** A group's name; priority # groups say which week (or none) their priority order stands for. */
function label(group: Group, month: string | undefined, language: ReturnType<typeof useLanguage>) {
  // P1's "Priority Order: 30 - 39" reads as "Priority # 30-39".
  const span = group.by === 1132 ? range(group.name) : undefined
  const name = span
    ? language.t("p1.group.priority", { range: `${span.lo}-${span.hi}` })
    : group.name || language.t("p1.group.unassigned")
  const found = group.by === 1132 && month ? bucket(group.name, month) : undefined
  if (!found) return name
  if (found.kind === "commit") return `${name} (${language.t("p1.group.commit")})`
  if (found.kind === "later") return `${name} (${language.t("p1.group.later")})`
  return `${name} (${language.t(`p1.group.week${found.index + 1}`)}, ${found.from} - ${found.to})`
}

/** A group's heading across the list: its name, how many requirements it holds, and their points and time. */
function Heading(props: { group: Group; span: number; shut: boolean; month?: string; onToggle: () => void }) {
  const language = useLanguage()
  const name = () => label(props.group, props.month, language)
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
            fallback={
              <span class="shrink-0 tabular-nums">{language.t("p1.group.sum", { total: props.group.points })}</span>
            }
          >
            {(totals) => (
              <>
                <span class="shrink-0 tabular-nums">
                  {language.t("p1.group.points", { total: props.group.points, done: totals().done })}
                </span>
                <span class="shrink-0 tabular-nums">
                  {language.t("p1.group.time", {
                    spent: totals().spent.toFixed(1),
                    remain: totals().remain.toFixed(1),
                  })}
                </span>
                <span class="shrink-0 flex items-center gap-1.5 tabular-nums">
                  <span class="w-16 h-1.5 rounded-full bg-surface-raised-base overflow-hidden">
                    <span
                      class="block h-full bg-surface-interactive-base"
                      style={{ width: `${Math.min(100, totals().finish)}%` }}
                    />
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
