import { OnceTag } from "@/components/one-time"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { Avatar } from "@opencode-ai/ui/avatar"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { showToast } from "@opencode-ai/ui/toast"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { getFilename } from "@opencode-ai/util/path"
import { A, useNavigate, useParams } from "@solidjs/router"
import { type Accessor, createMemo, createSignal, For, type JSX, Match, Show, Switch } from "solid-js"
import { useArchive } from "@/context/archive"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { getAvatarColors, type LocalProject, useLayout } from "@/context/layout"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { messageAgentColor } from "@/utils/agent"
import { sessionTitle } from "@/utils/session-title"
import { sessionPermissionRequest } from "../session/composer/session-request-tree"
import { dismissedSteps } from "../session/composer/dismissed-steps"
import { type SessionAttention, sessionAttention } from "./active-sessions"
import { SessionAttentionDot, useAttentionAction } from "./session-attention-dot"
import { ago, childSessionOnPath, hasProjectPermissions } from "./helpers"

const OPENCODE_PROJECT_ID = "4b0ea68d7af9a6031a7ffda7ad66e0cb83315750"


/** Sidebar levels: projects and panel actions sit on the edge, sessions one indent in, child sessions further. */
export const EDGE = 8
export const INDENT = 10
/** Highlights start this far before an item's text or icon, so each level's highlight starts at its own indent. */
export const INSET = 6
const ROW = EDGE + INDENT

export const ProjectIcon = (props: { project: LocalProject; class?: string; notify?: boolean }): JSX.Element => {
  const globalSync = useGlobalSync()
  const notification = useNotification()
  const permission = usePermission()
  const dirs = createMemo(() => [props.project.worktree, ...(props.project.sandboxes ?? [])])
  const unseenCount = createMemo(() =>
    dirs().reduce((total, directory) => total + notification.project.unseenCount(directory), 0),
  )
  const hasError = createMemo(() => dirs().some((directory) => notification.project.unseenHasError(directory)))
  const hasPermissions = createMemo(() =>
    dirs().some((directory) => {
      const [store] = globalSync.child(directory, { bootstrap: false })
      return hasProjectPermissions(store.permission, (item) => !permission.autoResponds(item, directory))
    }),
  )
  const notify = createMemo(() => props.notify && (hasPermissions() || unseenCount() > 0))
  const name = createMemo(() => props.project.name || getFilename(props.project.worktree))

  return (
    <div class={`relative size-8 shrink-0 rounded ${props.class ?? ""}`}>
      <div class="size-full rounded overflow-clip">
        <Avatar
          fallback={name()}
          src={
            props.project.id === OPENCODE_PROJECT_ID ? "https://opencode.ai/favicon.svg" : props.project.icon?.override
          }
          {...getAvatarColors(props.project.icon?.color)}
          class="size-full rounded"
          classList={{ "badge-mask": notify() }}
        />
      </div>
      <Show when={notify()}>
        <div
          classList={{
            "absolute top-px right-px size-1.5 rounded-full z-10": true,
            "bg-surface-warning-strong": hasPermissions(),
            "bg-icon-critical-base": !hasPermissions() && hasError(),
            "bg-text-interactive-base": !hasPermissions() && !hasError(),
          }}
        />
      </Show>
    </div>
  )
}

export type SessionItemProps = {
  session: Session
  list: Session[]
  navList?: Accessor<Session[]>
  slug: string
  mobile?: boolean
  dense?: boolean
  showTooltip?: boolean
  showChild?: boolean
  level?: number
  sidebarExpanded: Accessor<boolean>
  clearHoverProjectSoon: () => void
  prefetchSession: (session: Session, priority?: "high" | "low") => void
  archiveSession: (session: Session) => Promise<void>
}

const SessionRow = (props: {
  session: Session
  slug: string
  mobile?: boolean
  dense?: boolean
  tint: Accessor<string | undefined>
  isWorking: Accessor<boolean>
  attention: Accessor<SessionAttention | undefined>
  onAttention: (attention: SessionAttention) => void
  hasPermissions: Accessor<boolean>
  hasError: Accessor<boolean>
  unseenCount: Accessor<number>
  clearHoverProjectSoon: () => void
  sidebarOpened: Accessor<boolean>
  warmPress: () => void
  warmFocus: () => void
  /** A one-time session shown under the session it was opened from. */
  nested?: boolean
}): JSX.Element => {
  const language = useLanguage()
  // Under its parent, a one-time session's "model · from <parent>" title only needs the model.
  const title = () => {
    const full = sessionTitle(props.session.title)
    return props.nested ? (full?.split(" · from ")[0] ?? full) : full
  }
  const once = () =>
    props.session.oneTime ? <OnceTag closed={props.session.oneTime.status === "closed"} /> : undefined
  // The orange (waiting on the person) or red (stuck) dot; real work shows the spinner instead.
  const dot = () => {
    const attention = props.attention()
    if (!attention || attention.kind === "working") return
    return <SessionAttentionDot attention={attention} placement="right" onActivate={() => props.onAttention(attention)} />
  }

  return (
    <A
      href={`/${props.slug}/session/${props.session.id}`}
      class={`relative flex items-center gap-2 min-w-0 w-full text-left focus:outline-none ${props.dense ? "py-0.5" : "py-1"} ${props.nested ? "pl-3 border-l border-dashed border-border-weak-base" : ""}`}
      onPointerDown={props.warmPress}
      onFocus={props.warmFocus}
      onClick={() => {
        if (props.sidebarOpened()) return
        props.clearHoverProjectSoon()
      }}
    >
      {/* Sits in the indent to the left of the title, so titles line up with or without a status. */}
      <Show when={props.isWorking() || props.hasPermissions() || props.hasError() || props.unseenCount() > 0}>
        <div
          class="absolute right-full top-1/2 -translate-y-1/2 mr-px size-4 flex items-center justify-center"
          style={{ color: props.tint() ?? "var(--icon-interactive-base)" }}
        >
          <Switch>
            <Match when={props.isWorking()}>
              <Spinner class="size-[15px]" />
            </Match>
            <Match when={props.hasPermissions()}>
              <div class="size-1.5 rounded-full bg-surface-warning-strong" />
            </Match>
            <Match when={props.hasError()}>
              <div class="size-1.5 rounded-full bg-text-diff-delete-base" />
            </Match>
            <Match when={props.unseenCount() > 0}>
              <div class="size-1.5 rounded-full bg-text-interactive-base" />
            </Match>
          </Switch>
        </div>
      </Show>
      <div class="min-w-0 flex-1 flex flex-col">
        <Show
          when={props.dense}
          fallback={
            <span class="text-14-regular text-text-strong truncate" title={sessionTitle(props.session.title)}>
              {title()}
            </span>
          }
        >
          <span class="flex items-center gap-1.5 min-w-0">
            <span class="text-14-regular text-text-strong truncate">{title()}</span>
            {once()}
            {dot()}
          </span>
        </Show>
        <Show when={!props.dense}>
          <span class="flex items-center gap-1.5 min-w-0 text-12-regular text-text-weak">
            {once()}
            <span class="truncate">
              {ago(props.session.time.updated ?? props.session.time.created, Date.now(), language.intl())}
            </span>
            <Switch>
              <Match when={props.isWorking()}>
                <span class="shrink-0 px-1.5 rounded bg-surface-info-weak text-text-on-info-base">
                  {language.t("agent.status.working")}
                </span>
              </Match>
              <Match when={props.attention()?.cause === "permission"}>
                <span class="shrink-0 px-1.5 rounded bg-surface-warning-weak text-text-on-warning-base">
                  {language.t("agent.status.approval")}
                </span>
              </Match>
              <Match when={props.attention()?.kind === "waiting"}>
                <span class="shrink-0 px-1.5 rounded bg-surface-warning-weak text-text-on-warning-base">
                  {language.t("agent.status.waiting")}
                </span>
              </Match>
              <Match when={props.attention()?.kind === "stuck"}>
                <span class="shrink-0 px-1.5 rounded bg-surface-critical-weak text-text-on-critical-base">
                  {language.t("agent.status.stopped")}
                </span>
              </Match>
              <Match when={props.hasError()}>
                <span class="shrink-0 px-1.5 rounded bg-surface-critical-weak text-text-on-critical-base">
                  {language.t("agent.status.error")}
                </span>
              </Match>
            </Switch>
            {dot()}
          </span>
        </Show>
      </div>
    </A>
  )
}

/**
 * Confirms deleting a session from the sidebar; leaves the session page when it was open.
 * `prepare` runs after the confirmation and before the delete, e.g. to stop a running session first.
 */
export const DialogDelete = (props: { session: Session; slug: string; prepare?: () => Promise<void> }): JSX.Element => {
  const globalSDK = useGlobalSDK()
  const dialog = useDialog()
  const language = useLanguage()
  const params = useParams()
  const navigate = useNavigate()
  const remove = async () => {
    const ok = await (props.prepare?.() ?? Promise.resolve())
      .then(() => globalSDK.client.session.delete({ directory: props.session.directory, sessionID: props.session.id }))
      .then(() => true)
      .catch((err: unknown) => {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: err instanceof Error ? err.message : "",
        })
        return false
      })
    dialog.close()
    if (ok && params.id === props.session.id) navigate(`/${props.slug}/session`)
  }

  return (
    <Dialog title={language.t("session.delete.title")} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <span class="text-14-regular text-text-strong">
          {language.t("session.delete.confirm", {
            name: sessionTitle(props.session.title) ?? language.t("command.session.new"),
          })}
        </span>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" data-action="session-delete-confirm" onClick={remove}>
            {language.t("session.delete.button")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export const SessionItem = (props: SessionItemProps): JSX.Element => {
  const params = useParams()
  const layout = useLayout()
  const language = useLanguage()
  const notification = useNotification()
  const archive = useArchive()
  const permission = usePermission()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const dialog = useDialog()
  const unseenCount = createMemo(() => notification.session.unseenCount(props.session.id))
  const hasError = createMemo(() => notification.session.unseenHasError(props.session.id))
  const [sessionStore] = globalSync.child(props.session.directory)
  const hasPermissions = createMemo(() => {
    return !!sessionPermissionRequest(sessionStore.session, sessionStore.permission, props.session.id, (item) => {
      return !permission.autoResponds(item, props.session.directory)
    })
  })
  // Shared with the session header and the Active group, so they never disagree.
  const attention = createMemo(() =>
    sessionAttention(
      { ...sessionStore, directory: props.session.directory },
      props.session.id,
      (item) => !permission.autoResponds(item, props.session.directory),
      dismissedSteps.is,
    ),
  )
  const isWorking = createMemo(() => attention()?.kind === "working")
  const act = useAttentionAction()

  const title = () => sessionTitle(props.session.title) ?? ""
  // The draft title while renaming in place; undefined when not renaming.
  const [name, setName] = createSignal<string>()
  const [menu, setMenu] = createSignal(false)
  const rename = () => {
    const next = name()?.trim()
    setName(undefined)
    if (!next || next === title()) return
    void globalSDK.client.session
      .update({ directory: props.session.directory, sessionID: props.session.id, title: next })
      .catch((err: unknown) =>
        showToast({ title: language.t("common.requestFailed"), description: err instanceof Error ? err.message : "" }),
      )
  }

  const tint = createMemo(() => messageAgentColor(sessionStore.message[props.session.id], sessionStore.agent))
  const tooltip = createMemo(() => props.showTooltip ?? (props.mobile || !props.sidebarExpanded()))
  const currentChild = createMemo(() => {
    if (!props.showChild) return
    return childSessionOnPath(sessionStore.session, props.session.id, params.id)
  })

  const warm = (span: number, priority: "high" | "low") => {
    const nav = props.navList?.()
    const list = nav?.some((item) => item.id === props.session.id && item.directory === props.session.directory)
      ? nav
      : props.list

    props.prefetchSession(props.session, priority)

    const idx = list.findIndex((item) => item.id === props.session.id && item.directory === props.session.directory)
    if (idx === -1) return

    for (let step = 1; step <= span; step++) {
      const next = list[idx + step]
      if (next) props.prefetchSession(next, step === 1 ? "high" : priority)

      const prev = list[idx - step]
      if (prev) props.prefetchSession(prev, step === 1 ? "high" : priority)
    }
  }

  const nested = createMemo(
    () =>
      !!props.session.oneTime?.originSessionID &&
      props.list.some((item) => item.id === props.session.oneTime?.originSessionID),
  )
  const item = (
    <SessionRow
      session={props.session}
      nested={nested()}
      slug={props.slug}
      mobile={props.mobile}
      dense={props.dense}
      tint={tint}
      isWorking={isWorking}
      attention={attention}
      onAttention={(value) => act(props.session, value)}
      hasPermissions={hasPermissions}
      hasError={hasError}
      unseenCount={unseenCount}
      clearHoverProjectSoon={props.clearHoverProjectSoon}
      sidebarOpened={layout.sidebar.opened}
      warmPress={() => warm(2, "high")}
      warmFocus={() => warm(2, "high")}
    />
  )

  return (
    <>
      <div
        data-session-id={props.session.id}
        class="group/session relative min-w-0 rounded-md cursor-default pr-3 transition-colors hover:bg-surface-raised-base-hover [&:has(:focus-visible)]:bg-surface-raised-base-hover has-[[data-expanded]]:bg-surface-raised-base-hover has-[.active]:bg-surface-base-active has-[.active]:shadow-[inset_2px_0_0_var(--text-interactive-base)]"
        style={
          // A one-time session's highlight starts at its dotted guide line; others just before their title.
          nested()
            ? { "margin-left": `${ROW + (props.level ?? 0) * 16}px` }
            : { "margin-left": `${ROW - INSET + (props.level ?? 0) * 16}px`, "padding-left": `${INSET}px` }
        }
      >
        <div class="flex min-w-0 items-center gap-1">
          <div class="min-w-0 flex-1">
            <Show
              when={name() === undefined}
              fallback={
                <input
                  ref={(el) => requestAnimationFrame(() => el.select())}
                  data-action="session-rename-input"
                  value={name()}
                  aria-label={language.t("common.rename")}
                  class="w-full my-1 h-7 px-1.5 rounded bg-surface-base border border-border-interactive-base text-14-regular text-text-strong outline-none"
                  onInput={(event) => setName(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") rename()
                    if (event.key === "Escape") setName(undefined)
                  }}
                  onBlur={rename}
                />
              }
            >
              <Show
                when={!tooltip()}
                fallback={
                  <Tooltip
                    placement={props.mobile ? "bottom" : "right"}
                    value={sessionTitle(props.session.title)}
                    gutter={10}
                    class="min-w-0 w-full"
                  >
                    {item}
                  </Tooltip>
                }
              >
                {item}
              </Show>
            </Show>
          </div>

          <Show when={!props.level && name() === undefined}>
            <div
              class="shrink-0 overflow-hidden transition-[width,opacity]"
              classList={{
                "w-6 opacity-100 pointer-events-auto": !!props.mobile || menu(),
                "w-0 opacity-0 pointer-events-none": !props.mobile && !menu(),
                "group-hover/session:w-6 group-hover/session:opacity-100 group-hover/session:pointer-events-auto": true,
                "group-focus-within/session:w-6 group-focus-within/session:opacity-100 group-focus-within/session:pointer-events-auto": true,
              }}
            >
              <DropdownMenu placement="bottom-end" onOpenChange={setMenu}>
                <DropdownMenu.Trigger
                  as={IconButton}
                  icon="dot-grid"
                  variant="ghost"
                  class="size-6 rounded-md data-[expanded]:bg-surface-base-active"
                  data-action="session-menu"
                  aria-label={language.t("agent.sessions.menu")}
                  onClick={(event: MouseEvent) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                />
                <DropdownMenu.Portal>
                  <DropdownMenu.Content class="mt-1 min-w-40">
                    <DropdownMenu.Item data-action="session-rename" onSelect={() => setName(title())}>
                      <DropdownMenu.ItemLabel>{language.t("common.rename")}</DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      data-action="session-unread"
                      onSelect={() => notification.session.markUnread(props.session.id, props.session.directory)}
                    >
                      <DropdownMenu.ItemLabel>{language.t("agent.sessions.unread")}</DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      data-action={archive.done(props.session.id) ? "session-reopen" : "session-finish"}
                      onSelect={() =>
                        archive.done(props.session.id)
                          ? archive.reopen(props.session)
                          : archive.finish(props.session)
                      }
                    >
                      <DropdownMenu.ItemLabel>
                        {language.t(archive.done(props.session.id) ? "session.reopen" : "session.finish")}
                      </DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      data-action="session-archive"
                      onSelect={() => void props.archiveSession(props.session)}
                    >
                      <DropdownMenu.ItemLabel>{language.t("common.archive")}</DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item
                      data-action="session-delete"
                      onSelect={() => dialog.show(() => <DialogDelete session={props.session} slug={props.slug} />)}
                    >
                      <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu>
            </div>
          </Show>
        </div>
      </div>
      <Show when={currentChild()}>
        {(child) => (
          <div class="w-full">
            <SessionItem {...props} session={child()} level={(props.level ?? 0) + 1} />
          </div>
        )}
      </Show>
    </>
  )
}

export const NewSessionItem = (props: {
  slug: string
  mobile?: boolean
  dense?: boolean
  sidebarExpanded: Accessor<boolean>
  clearHoverProjectSoon: () => void
}): JSX.Element => {
  const layout = useLayout()
  const language = useLanguage()
  const label = language.t("command.session.new")
  const tooltip = () => props.mobile || !props.sidebarExpanded()
  const item = (
    <A
      href={`/${props.slug}/session`}
      end
      class={`flex items-center gap-2 min-w-0 w-full text-left focus:outline-none ${props.dense ? "py-0.5" : "py-1"}`}
      onClick={() => {
        if (layout.sidebar.opened()) return
        props.clearHoverProjectSoon()
      }}
    >
      <div class="shrink-0 size-6 flex items-center justify-center">
        <Icon name="new-session" size="small" class="text-icon-weak" />
      </div>
      <span class="text-14-regular text-text-strong min-w-0 flex-1 truncate">{label}</span>
    </A>
  )

  return (
    <div class="group/session relative w-full min-w-0 rounded-md cursor-default transition-colors pl-2 pr-3 hover:bg-surface-raised-base-hover [&:has(:focus-visible)]:bg-surface-raised-base-hover has-[.active]:bg-surface-base-active">
      <Show
        when={!tooltip()}
        fallback={
          <Tooltip placement={props.mobile ? "bottom" : "right"} value={label} gutter={10} class="min-w-0 w-full">
            {item}
          </Tooltip>
        }
      >
        {item}
      </Show>
    </div>
  )
}

export const SessionSkeleton = (props: { count?: number }): JSX.Element => {
  const items = Array.from({ length: props.count ?? 4 }, (_, index) => index)
  return (
    <div class="flex flex-col gap-1">
      <For each={items}>
        {() => <div class="h-8 w-full rounded-md bg-surface-raised-base opacity-60 animate-pulse" />}
      </For>
    </div>
  )
}
