import { useParams } from "@solidjs/router"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { showToast } from "@opencode-ai/ui/toast"
import { base64Encode } from "@opencode-ai/util/encode"
import { A } from "@solidjs/router"
import { type Accessor, createMemo, For, type JSX, Show } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import type { LocalProject } from "@/context/layout"
import { usePermission } from "@/context/permission"
import { sessionTitle } from "@/utils/session-title"
import { type ActiveSource, activeSessions, runStopSteps, stopSteps } from "./active-sessions"
import { dismissedSteps } from "@/pages/session/composer/dismissed-steps"
import { displayName } from "./helpers"
import { DialogDelete, EDGE, INDENT, INSET } from "./sidebar-items"
import { SessionAttentionDot, useAttentionAction } from "./session-attention-dot"

/** Sessions across the open projects that are working or waiting on the user, with Stop, Archive and Delete. */
export const ActiveSessions = (props: {
  projects: Accessor<LocalProject[]>
  archiveSession: (session: Session) => Promise<void>
}): JSX.Element => {
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const permission = usePermission()
  const language = useLanguage()
  const dialog = useDialog()
  const params = useParams()

  const source = (directory: string): ActiveSource => {
    const [store] = globalSync.child(directory, { bootstrap: false })
    return { ...store, directory }
  }
  const list = createMemo(() =>
    activeSessions(
      props.projects().map((project) => ({
        project,
        sources: [project.worktree, ...(project.sandboxes ?? [])].map(source),
      })),
      (item, directory) => !permission.autoResponds(item, directory),
      params.id,
      dismissedSteps.is,
    ),
  )

  // Rejects the session's pending questions and permission requests, then aborts it and waits for the abort.
  const stop = async (session: Session) => {
    const directory = session.directory
    await runStopSteps(stopSteps(source(directory), session.id), {
      rejectPermission: (requestID) => globalSDK.client.permission.reply({ requestID, directory, reply: "reject" }),
      rejectQuestion: (requestID) => globalSDK.client.question.reject({ requestID, directory }),
      abort: (sessionID) => globalSDK.client.session.abort({ sessionID, directory }),
    })
  }
  const act = useAttentionAction()
  const failed = (err: unknown) =>
    showToast({ title: language.t("agent.sessions.stopFailed"), description: err instanceof Error ? err.message : "" })

  return (
    <Show when={list().length > 0}>
      <section data-component="session-group-active" class="sidebar-active-sessions flex flex-col gap-0.5">
        <div class="h-8 pl-2 flex items-center gap-1.5 text-[13px] font-medium text-text-strong">
          <Show when={list().some((item) => item.state === "working")}>
            <Spinner class="size-3 shrink-0" />
          </Show>
          <span class="truncate">{language.t("agent.sessions.active")}</span>
        </div>
        <nav class="flex flex-col gap-0.5" aria-label={language.t("agent.sessions.active")}>
          <For each={list()}>
            {(item) => (
              <div
                data-session-id={item.session.id}
                data-state={item.state}
                class="group/active w-full min-w-0 rounded-md pr-1 flex items-center gap-1 hover:bg-surface-raised-base-hover has-[[data-expanded]]:bg-surface-raised-base-hover has-[.active]:bg-surface-base-active"
                style={{ "margin-left": `${EDGE + INDENT - INSET}px`, "padding-left": `${INSET}px` }}
              >
                <A
                  href={`/${base64Encode(item.session.directory)}/session/${item.session.id}`}
                  class="flex-1 min-w-0 py-1 flex flex-col text-left focus:outline-none"
                >
                  <span class="text-14-regular text-text-strong truncate">
                    {sessionTitle(item.session.title) ?? language.t("command.session.new")}
                  </span>
                  <span class="flex items-center gap-1.5 min-w-0 text-12-regular text-text-weak">
                    <span class="truncate">{displayName(item.project)}</span>
                    <span
                      class="shrink-0 px-1.5 rounded"
                      classList={{
                        "bg-surface-info-weak text-text-on-info-base": item.state === "working",
                        "bg-surface-warning-weak text-text-on-warning-base": item.state === "waiting",
                        "bg-surface-critical-weak text-text-on-critical-base": item.state === "stuck",
                      }}
                    >
                      {language.t(
                        item.state === "working"
                          ? "agent.status.working"
                          : item.state === "stuck"
                            ? "agent.status.stopped"
                            : "agent.status.waiting",
                      )}
                    </span>
                    <Show when={item.state !== "working"}>
                      <SessionAttentionDot
                        attention={item.attention}
                        placement="right"
                        onActivate={() => act(item.session, item.attention)}
                      />
                    </Show>
                  </span>
                </A>
                <DropdownMenu placement="bottom-end">
                  <DropdownMenu.Trigger
                    as={IconButton}
                    icon="dot-grid"
                    variant="ghost"
                    class="shrink-0 size-6 rounded-md data-[expanded]:bg-surface-base-active"
                    data-action="active-session-menu"
                    aria-label={language.t("agent.sessions.activeMenu")}
                  />
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content class="mt-1 min-w-40">
                      <DropdownMenu.Item
                        data-action="active-session-stop"
                        onSelect={() => void stop(item.session).catch(failed)}
                      >
                        <DropdownMenu.ItemLabel>{language.t("agent.sessions.stop")}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        data-action="active-session-archive"
                        onSelect={() =>
                          void stop(item.session)
                            .then(() => props.archiveSession(item.session))
                            .catch(failed)
                        }
                      >
                        <DropdownMenu.ItemLabel>{language.t("common.archive")}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Item
                        data-action="active-session-delete"
                        onSelect={() =>
                          dialog.show(() => (
                            <DialogDelete
                              session={item.session}
                              slug={base64Encode(item.session.directory)}
                              prepare={() => stop(item.session)}
                            />
                          ))
                        }
                      >
                        <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu>
              </div>
            )}
          </For>
        </nav>
      </section>
    </Show>
  )
}
