import { createEffect, createResource, For, on, onCleanup, Show } from "solid-js"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { getFilename } from "@opencode-ai/util/path"
import type { VcsFileDiff } from "@opencode-ai/sdk/v2"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { SDKProvider, useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { AgentCommit } from "./agent-commit"

/**
 * The uncommitted changes of one related project's repository, under the Changes box. Each folder is
 * its own git repository, so its files are listed and committed on their own, in that folder.
 */
export function RelatedChanges(props: { dir: string; session?: string }) {
  return (
    <SDKProvider directory={() => props.dir}>
      <Repo dir={props.dir} session={props.session} />
    </SDKProvider>
  )
}

function Repo(props: { dir: string; session?: string }) {
  const sdk = useSDK()
  const sync = useSync()
  const platform = usePlatform()
  const language = useLanguage()
  const [diffs, { refetch }] = createResource(
    () => props.dir,
    () =>
      sdk.client.vcs
        .diff({ mode: "git" })
        .then((res) => res.data ?? [])
        .catch(() => [] as VcsFileDiff[]),
  )
  const list = () => diffs.latest ?? []
  const timer = { id: undefined as ReturnType<typeof setTimeout> | undefined }
  const refresh = () => {
    if (timer.id) clearTimeout(timer.id)
    timer.id = setTimeout(() => {
      timer.id = undefined
      void refetch()
    }, 300)
  }
  const stop = sdk.event.listen((evt) => {
    if (evt.details.type !== "file.watcher.updated") return
    const file = (evt.details.properties as { file?: unknown } | undefined)?.file
    if (typeof file !== "string") return
    if (/(^|[\\/])\.git[\\/]/.test(file) && !/[\\/](index|HEAD)$/.test(file)) return
    refresh()
  })
  onCleanup(() => {
    stop()
    if (timer.id) clearTimeout(timer.id)
  })
  // The session works in the current project; its reply ending is when a related repo changes most.
  createEffect(
    on(
      () => (props.session ? sync.data.session_status[props.session]?.type : undefined),
      (next, prev) => {
        if (next === "idle" && prev && prev !== "idle") refresh()
      },
      { defer: true },
    ),
  )

  return (
    <Show when={list().length > 0}>
      <div data-component="agent-related-changes" class="mt-2 pt-2 border-t border-border-weak-base flex flex-col">
        <div class="h-8 flex items-center gap-2 min-w-0" title={props.dir}>
          <Icon name="folder" size="small" class="shrink-0 text-icon-base" />
          <span class="min-w-0 truncate text-13-medium text-text-strong">{getFilename(props.dir)}</span>
          <span class="ml-auto shrink-0 text-12-regular text-text-weak">
            {language.t("agent.edits.files", { count: list().length })}
          </span>
        </div>
        <div class="max-h-48 overflow-y-auto no-scrollbar flex flex-col">
          <For each={list()}>
            {(diff) => (
              <button
                type="button"
                data-action="agent-related-file"
                title={diff.file}
                class="w-full h-8 min-w-0 px-1 rounded-md flex items-center gap-2 text-left hover:bg-surface-base-hover"
                onClick={() => void platform.openPath?.(`${props.dir.replace(/[\\/]+$/, "")}/${diff.file}`)}
              >
                <FileIcon node={{ path: diff.file, type: "file" }} class="size-4 shrink-0" />
                <span class="flex-1 min-w-0 truncate text-13-regular text-text-strong">{getFilename(diff.file)}</span>
                <span class="shrink-0 flex items-center gap-1 text-12-mono">
                  <Show when={diff.additions}>
                    <span class="text-text-diff-add-base">+{diff.additions}</span>
                  </Show>
                  <Show when={diff.deletions}>
                    <span class="text-text-diff-delete-base">-{diff.deletions}</span>
                  </Show>
                </span>
              </button>
            )}
          </For>
        </div>
        <AgentCommit session={props.session} diffs={list} onCommitted={() => void refetch()} inline />
      </div>
    </Show>
  )
}
