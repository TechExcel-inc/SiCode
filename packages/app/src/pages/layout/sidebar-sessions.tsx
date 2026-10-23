import { createMemo, createSignal, For, Match, Show, Switch, type Accessor, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useParams } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/util/encode"
import { Avatar } from "@opencode-ai/ui/avatar"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { DialogSearch } from "@/components/dialog-search"
import { ProjectLinks } from "@/components/project-links"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useCowork } from "@/context/cowork"
import { getAvatarColors, type LocalProject, useLayout } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { sessionTitle } from "@/utils/session-title"
import { displayName, hasProjectPermissions, oneTimeRows, sortedRootSessions, workspaceKey } from "./helpers"
import { ActiveSessions } from "./sidebar-active"
import { EDGE, INDENT, INSET, SessionItem, SessionSkeleton } from "./sidebar-items"
import { type WorkspaceSidebarContext } from "./sidebar-workspace"

const PAGE = 5

/** Sessions of every open project, grouped by project like the Claude app sidebar. */
export const AllSessions = (props: {
  ctx: WorkspaceSidebarContext
  current: Accessor<LocalProject | undefined>
  projects: Accessor<LocalProject[]>
  sortNow: Accessor<number>
  mobile?: boolean
  onNew: (project: LocalProject) => void
  onSwitch: (project: LocalProject) => void
  onEdit: (project: LocalProject) => void
}): JSX.Element => {
  const language = useLanguage()
  const layout = useLayout()
  const cowork = useCowork()
  const params = useParams()
  const dialog = useDialog()
  const [state, setState] = createStore({
    query: "",
    folded: {} as Record<string, boolean>,
    shown: {} as Record<string, number>,
    // The project row last clicked on its empty area: highlighted only, nothing folds.
    picked: "",
  })

  return (
    <div class="size-full flex flex-col min-h-0 -ml-1">
      <div class="shrink-0 pt-3 pb-2 flex flex-col gap-2">
        <div class="px-2 text-[11px] font-medium uppercase tracking-wide text-text-weak">
          {language.t("agent.sessions.title")}
        </div>
        <div class="flex items-center gap-1">
          <div class="flex-1 min-w-0 flex items-center gap-2 h-8 px-2 rounded-md bg-surface-base border border-border-weak-base focus-within:border-border-interactive-base">
            <Icon name="magnifying-glass" size="small" class="text-icon-weak shrink-0" />
            <input
              type="text"
              data-action="session-search"
              value={state.query}
              onInput={(event) => setState("query", event.currentTarget.value)}
              placeholder={language.t("agent.sessions.searchAll")}
              aria-label={language.t("agent.sessions.searchAll")}
              class="flex-1 min-w-0 bg-transparent text-12-regular text-text-strong placeholder:text-text-weak outline-none"
            />
            <Show when={state.query}>
              <IconButton
                icon="close-small"
                variant="ghost"
                class="size-5"
                onClick={() => setState("query", "")}
                aria-label={language.t("agent.sessions.clear")}
              />
            </Show>
          </div>
          <Tooltip placement="bottom" value={language.t("search.title")}>
            <IconButton
              icon="magnifying-glass-menu"
              variant="ghost"
              class="shrink-0 size-8 rounded-md"
              data-action="session-advanced-search"
              aria-label={language.t("search.title")}
              onClick={() => dialog.show(() => <DialogSearch project={props.current()?.worktree} />)}
            />
          </Tooltip>
        </div>
        <Show when={props.current()}>
          {(project) => (
            <button
              type="button"
              data-action="session-new"
              class="h-8 pr-2 rounded-md flex items-center gap-2 text-left text-13-regular text-text-strong hover:bg-surface-raised-base-hover"
              style={{ "margin-left": `${EDGE - INSET}px`, "padding-left": `${INSET}px` }}
              classList={{ "bg-surface-base-active": !!params.dir && !params.id }}
              onClick={() => props.onNew(project())}
            >
              <Icon name="plus-small" size="small" class="shrink-0 text-text-strong [&_path]:stroke-[2.25]" />
              <span class="truncate">{language.t("agent.sessions.new")}</span>
            </button>
          )}
        </Show>
      </div>
      <div
        ref={(el) => props.ctx.setScrollContainerRef(el, props.mobile)}
        class="flex-1 min-h-0 flex flex-col gap-3 pb-3 overflow-y-auto no-scrollbar [overflow-anchor:none]"
      >
        <ActiveSessions projects={props.projects} archiveSession={props.ctx.archiveSession} />
        <For each={props.projects()}>
          {(project, index) => (
            <>
            <Group
              ctx={props.ctx}
              project={project}
              active={workspaceKey(props.current()?.worktree ?? "") === workspaceKey(project.worktree)}
              query={state.query.trim().toLowerCase()}
              folded={!!state.folded[project.worktree]}
              shown={state.shown[project.worktree] ?? PAGE}
              sortNow={props.sortNow}
              mobile={props.mobile}
              onFold={() => setState("folded", project.worktree, (value) => !value)}
              picked={state.picked === project.worktree}
              onPick={() => setState("picked", project.worktree)}
              onMore={() => setState("shown", project.worktree, (value) => (value ?? PAGE) + PAGE)}
              onNew={() => props.onNew(project)}
              onSwitch={() => props.onSwitch(project)}
              onHide={() => {
                const root = props.current()?.worktree
                if (root) void cowork.unrelate(root, project.worktree)
              }}
            />
            {/* Related Projects sits right after the current project's sessions, above the related groups. */}
            <Show when={index() === 0 && props.current()}>
              {(current) => (
                <ProjectLinks
                  root={current().worktree}
                  place={props.mobile ? "mobile" : "desktop"}
                  triggerProps={{
                    class:
                      "w-[calc(100%-2px)] ml-0.5 h-8 pl-1.5 pr-1 rounded-md flex items-center gap-2 text-left text-13-regular text-text-strong hover:bg-surface-raised-base-hover data-[expanded]:bg-surface-base-active",
                    "data-action": "session-related-project",
                    "aria-label": language.t("links.menu"),
                  }}
                  trigger={
                    <>
                      <Icon name="folder-add-left" size="small" class="shrink-0 text-text-strong" />
                      <span class="truncate">{language.t("links.row")}</span>
                      <Show when={cowork.relatedDirs(current().worktree).length > 0}>
                        <span class="shrink-0 px-1.5 rounded-full bg-surface-interactive-base text-11-medium text-text-interactive-base">
                          {cowork.relatedDirs(current().worktree).length}
                        </span>
                      </Show>
                      {/* Always shown: it is the way into the menu, so it never waits for a hover. */}
                      <span class="ml-auto shrink-0 size-6 rounded-md flex items-center justify-center text-text-strong">
                        <Icon name="dot-grid" size="small" class="text-text-strong [&_path]:stroke-[1.75]" />
                      </span>
                    </>
                  }
                />
              )}
            </Show>
            </>
          )}
        </For>
      </div>
    </div>
  )
}

const Group = (props: {
  ctx: WorkspaceSidebarContext
  project: LocalProject
  active: boolean
  query: string
  folded: boolean
  shown: number
  sortNow: Accessor<number>
  mobile?: boolean
  onFold: () => void
  picked: boolean
  onPick: () => void
  onMore: () => void
  onNew: () => void
  /** Make this related project the current project, like picking it in the toolbar project picker. */
  onSwitch: () => void
  /** Stop showing this related project's sessions. Not offered for the current project. */
  onHide: () => void
}): JSX.Element => {
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const dialog = useDialog()
  const notification = useNotification()
  const permission = usePermission()
  const dirs = createMemo(() => [props.project.worktree, ...(props.project.sandboxes ?? [])])
  // What the project's sessions are doing, even while another project is on screen or this one is folded.
  const activity = createMemo(() => {
    const stores = dirs().map((directory) => ({
      directory,
      store: globalSync.child(directory, { bootstrap: false })[0],
    }))
    if (
      stores.some((item) =>
        hasProjectPermissions(item.store.permission, (req) => !permission.autoResponds(req, item.directory)),
      )
    )
      return "approval" as const
    if (
      stores.some((item) =>
        Object.values(item.store.session_status ?? {}).some((status) => status && status.type !== "idle"),
      )
    )
      return "working" as const
    if (dirs().some((directory) => notification.project.unseenHasError(directory))) return "error" as const
  })
  const workspace = createMemo(() => {
    const [store, setStore] = globalSync.child(props.project.worktree)
    return { store, setStore }
  })
  const slug = createMemo(() => base64Encode(props.project.worktree))
  const sessions = createMemo(() => sortedRootSessions(workspace().store, props.sortNow()) ?? [])
  const matches = createMemo(() => {
    if (!props.query) return sessions()
    return sessions().filter((session) => (sessionTitle(session.title) ?? "").toLowerCase().includes(props.query))
  })
  const visible = createMemo(() => (props.query ? matches() : matches().slice(0, props.shown)))
  // Parents whose archived one-time sessions are shown.
  const [opened, setOpened] = createSignal<ReadonlySet<string>>(new Set())
  const rows = createMemo(() => oneTimeRows(visible(), opened()))
  const flip = (id: string) =>
    setOpened((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const loading = createMemo(() => workspace().store.status !== "complete" && sessions().length === 0)
  const more = createMemo(
    () => !props.query && (sessions().length > props.shown || workspace().store.sessionTotal > sessions().length),
  )
  const loadMore = () => {
    props.onMore()
    if (sessions().length > props.shown) return
    workspace().setStore("limit", (limit) => (limit ?? 0) + PAGE)
    void globalSync.project.loadSessions(props.project.worktree)
  }

  return (
    <Show when={!props.query || matches().length > 0}>
      <section data-component="session-group" class="flex flex-col gap-0.5">
        {/* The empty part of the row only selects it; the icon, name and chevron fold it. */}
        <div
          data-current={props.active ? "" : undefined}
          data-picked={props.picked ? "" : undefined}
          class="group/project h-8 pr-0.5 rounded-md flex items-center gap-1.5 cursor-default hover:bg-surface-raised-base-hover"
          classList={{ "bg-surface-base-active": props.picked }}
          style={{ "margin-left": `${EDGE - INSET}px`, "padding-left": `${INSET}px` }}
          onClick={props.onPick}
        >
          <button
            type="button"
            data-action="session-group-toggle"
            class="min-w-0 h-full flex items-center gap-1.5 text-left"
            aria-expanded={!props.folded}
            onClick={(event) => {
              event.stopPropagation()
              props.onFold()
            }}
          >
            <Avatar
              fallback={displayName(props.project)}
              src={props.project.icon?.override}
              size="small"
              {...getAvatarColors(props.project.icon?.color)}
              class="shrink-0 size-4 rounded text-[10px] leading-none"
            />
            <span class="truncate text-[13px] font-medium text-text-strong">{displayName(props.project)}</span>
            <Icon
              name="chevron-down"
              size="small"
              class="shrink-0 text-text-strong [&_path]:stroke-[1.75] transition-transform"
              classList={{ "-rotate-90": props.folded }}
            />
            <Switch>
              <Match when={activity() === "approval"}>
                <span
                  data-activity="approval"
                  title={language.t("agent.status.approval")}
                  class="shrink-0 size-2 rounded-full bg-surface-warning-strong"
                />
              </Match>
              <Match when={activity() === "working"}>
                <span data-activity="working" title={language.t("agent.status.working")} class="shrink-0 flex">
                  <Spinner class="size-3" />
                </span>
              </Match>
              <Match when={activity() === "error"}>
                <span
                  data-activity="error"
                  title={language.t("agent.status.error")}
                  class="shrink-0 size-2 rounded-full bg-text-diff-delete-base"
                />
              </Match>
            </Switch>
          </button>
          <span class="flex-1 min-w-0 h-full" />
          <Show when={!props.active}>
            <DropdownMenu placement="bottom-end">
              <DropdownMenu.Trigger
                as={IconButton}
                icon="dot-grid"
                variant="ghost"
                class="shrink-0 size-6 rounded-md opacity-0 group-hover/project:opacity-100 focus-visible:opacity-100 data-[expanded]:opacity-100 data-[expanded]:bg-surface-base-active"
                data-action="session-group-menu"
                aria-label={language.t("agent.sessions.projectMenu")}
              />
              <DropdownMenu.Portal>
                <DropdownMenu.Content class="mt-1 min-w-48">
                  <DropdownMenu.Item data-action="session-group-switch" onSelect={props.onSwitch}>
                    <DropdownMenu.ItemLabel>
                      {language.t("agent.sessions.switchTo", { name: displayName(props.project) })}
                    </DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    data-action="session-group-search"
                    onSelect={() => dialog.show(() => <DialogSearch project={props.project.worktree} />)}
                  >
                    <DropdownMenu.ItemLabel>{language.t("agent.sessions.searchSessions")}</DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  {/* Only removes the link in EAD Pilot; no files or sessions are deleted. */}
                  <DropdownMenu.Item data-action="session-group-hide" onSelect={props.onHide}>
                    <DropdownMenu.ItemLabel>{language.t("agent.sessions.removeRelated")}</DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu>
          </Show>
          <button
            type="button"
            class="shrink-0 size-6 rounded-md flex items-center justify-center hover:bg-surface-base-hover"
            data-action="session-group-new"
            aria-label={language.t("command.session.new")}
            onClick={props.onNew}
          >
            <Icon name="plus-small" size="small" class="text-text-strong [&_path]:stroke-[2.25]" />
          </button>
        </div>
        <Show when={!props.folded || props.query}>
          <nav class="flex flex-col gap-0.5" aria-label={displayName(props.project)}>
            <Show when={loading()}>
              <SessionSkeleton />
            </Show>
            <Show when={!loading() && sessions().length === 0}>
              <div class="py-1 text-12-regular text-text-weak" style={{ "padding-left": `${EDGE + INDENT}px` }}>
                {language.t("agent.sessions.empty")}
              </div>
            </Show>
            <For each={rows()}>
              {(row) =>
                "archived" in row ? (
                  <button
                    type="button"
                    data-action="one-time-archived"
                    aria-expanded={row.open}
                    class="pl-3 py-0.5 flex items-center gap-1 text-left text-12-regular text-text-weak hover:text-text-base border-l border-dashed border-border-weak-base"
                    style={{ "margin-left": `${EDGE + INDENT}px` }}
                    onClick={() => flip(row.archived)}
                  >
                    <Icon
                      name={row.open ? "chevron-down" : "chevron-right"}
                      size="small"
                      class="shrink-0 text-text-strong [&_path]:stroke-[1.75]"
                    />
                    {language.t("oneTime.sidebar.archived", { count: row.count })}
                  </button>
                ) : (
                  <SessionItem
                    session={row.session}
                    list={sessions()}
                    navList={props.ctx.navList}
                    slug={slug()}
                    mobile={props.mobile}
                    showChild
                    sidebarExpanded={props.ctx.sidebarExpanded}
                    clearHoverProjectSoon={props.ctx.clearHoverProjectSoon}
                    prefetchSession={props.ctx.prefetchSession}
                    archiveSession={props.ctx.archiveSession}
                  />
                )
              }
            </For>
            <Show when={more()}>
              <button
                type="button"
                data-action="session-load-more"
                class="self-start py-1 text-12-regular text-text-weak hover:text-text-base"
                style={{ "margin-left": `${EDGE + INDENT}px` }}
                onClick={loadMore}
              >
                {language.t("common.loadMore")}
              </button>
            </Show>
          </nav>
        </Show>
      </section>
    </Show>
  )
}
