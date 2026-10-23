import { createMemo, createResource, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Avatar } from "@opencode-ai/ui/avatar"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { showToast } from "@opencode-ai/ui/toast"
import { getFilename } from "@opencode-ai/util/path"
import { useCowork, type CoworkEntry } from "@/context/cowork"
import { getAvatarColors } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { workspaceKey } from "@/pages/layout/helpers"

type Row = CoworkEntry & { key: string }

const keyOf = (item: CoworkEntry) => (item.worktree ? workspaceKey(item.worktree) : `pilot:${item.projectId}`)

/**
 * Chooses a project's related projects: their repos, often other projects' primary repos, which the
 * AI may read and change from this project's sessions. Ticking adds and unticking removes; nothing is
 * saved until Save.
 */
export function DialogRelatedProjects(props: { root: string; picked?: Record<string, boolean>; added?: Row[] }) {
  const dialog = useDialog()
  const language = useLanguage()
  const cowork = useCowork()
  const platform = usePlatform()
  const name = getFilename(props.root) || props.root

  const related = createMemo(() => cowork.relatedDirs(props.root))
  const linked = (row: Row) =>
    row.worktree
      ? related().some((dir) => workspaceKey(dir) === row.key)
      : !!row.projectId && cowork.relatedIds(props.root).includes(row.projectId)

  const [state, setState] = createStore({
    query: "",
    busy: false,
    /** The person's choices by row; rows they did not touch keep their saved state. */
    picked: { ...props.picked } as Record<string, boolean>,
    /** Folders opened here, listed until saved. */
    added: [...(props.added ?? [])] as Row[],
  })
  const [recent] = createResource(() => cowork.recent({ limit: 50, current: props.root }))

  const all = createMemo(() => {
    const seen = new Set<string>([workspaceKey(props.root)])
    const list: Row[] = []
    const add = (item: CoworkEntry) => {
      const key = keyOf(item)
      if (seen.has(key)) return
      seen.add(key)
      list.push({ ...item, key })
    }
    state.added.forEach(add)
    related().forEach((dir) => add({ name: getFilename(dir) || dir, repo: "", worktree: dir }))
    ;(recent.latest ?? []).forEach(add)
    return list
  })
  const rows = createMemo(() => {
    const text = state.query.trim().toLowerCase()
    return all().filter(
      (row) => !text || row.name.toLowerCase().includes(text) || (row.worktree ?? row.repo).toLowerCase().includes(text),
    )
  })
  const on = (row: Row) => state.picked[row.key] ?? linked(row)
  const adds = createMemo(() => all().filter((row) => on(row) && !linked(row)))
  const removes = createMemo(() => all().filter((row) => !on(row) && linked(row)))
  const count = createMemo(() => all().filter(on).length)

  // A folder opened here joins the list ticked; the system folder picker keeps this dialog open, and
  // the app's own picker (no system one) replaces it, so this dialog comes back with the choices kept.
  const open = async () => {
    const title = language.t("links.related.open")
    const take = (dir: string | undefined) => {
      if (!dir || workspaceKey(dir) === workspaceKey(props.root)) return
      const row = { name: getFilename(dir) || dir, repo: "", worktree: dir, key: workspaceKey(dir) }
      setState("added", (list) => [row, ...list.filter((item) => item.key !== row.key)])
      setState("picked", row.key, true)
    }
    if (platform.openDirectoryPickerDialog) {
      const picked = await platform.openDirectoryPickerDialog({ title })
      return take((Array.isArray(picked) ? picked[0] : picked) ?? undefined)
    }
    const { DialogSelectDirectory } = await import("@/components/dialog-select-directory")
    const back = (dir?: string) => {
      take(dir)
      dialog.show(() => <DialogRelatedProjects root={props.root} picked={{ ...state.picked }} added={[...state.added]} />)
    }
    dialog.show(
      () => <DialogSelectDirectory onSelect={(picked) => back((Array.isArray(picked) ? picked[0] : picked) ?? undefined)} />,
      () => back(),
    )
  }

  const save = async () => {
    if (state.busy) return
    if (adds().length + removes().length === 0) return dialog.close()
    setState("busy", true)
    // Folders are saved as one list; projects only in EAD Pilot (not on this computer) one by one.
    const work = [
      cowork.setRelated(
        props.root,
        all().flatMap((row) => (row.worktree && on(row) ? [row.worktree] : [])),
      ),
      ...adds().flatMap((row) => (row.worktree ? [] : [cowork.relateEntry(props.root, row)])),
    ]
    const done = await Promise.allSettled(work)
    setState("busy", false)
    const failed = done.filter((item) => item.status === "rejected").length
    dialog.close()
    showToast({
      variant: failed ? "error" : "success",
      icon: failed ? "circle-ban-sign" : "circle-check",
      title: language.t(failed ? "links.save.failed" : "links.save.done"),
    })
  }

  return (
    <Dialog
      title={language.t("links.related.title", { project: name })}
      description={language.t("links.dialog.body", { project: name })}
      class="w-full max-w-[560px] mx-auto"
    >
      <div data-component="dialog-related-projects" class="flex flex-col gap-3 px-6 pb-6">
        <div class="flex items-center gap-2 h-9 px-2.5 rounded-md bg-surface-base border border-border-weak-base focus-within:border-border-interactive-base">
          <Icon name="magnifying-glass" size="small" class="text-icon-weak shrink-0" />
          <input
            type="text"
            data-action="links-search"
            value={state.query}
            ref={(el) => setTimeout(() => el.focus(), 0)}
            onInput={(event) => setState("query", event.currentTarget.value)}
            placeholder={language.t("rail.project.search")}
            aria-label={language.t("rail.project.search")}
            class="flex-1 min-w-0 bg-transparent text-13-regular text-text-strong placeholder:text-text-weak outline-none"
          />
          <span class="shrink-0 text-12-regular text-text-weak">{language.t("links.related.count", { count: count() })}</span>
        </div>

        <div class="max-h-[360px] overflow-y-auto flex flex-col rounded-md border border-border-weak-base p-1" role="list">
          <Show
            when={rows().length > 0}
            fallback={
              <div class="px-2 py-3 text-13-regular text-text-weak">
                {recent.loading ? "…" : language.t("search.related.none")}
              </div>
            }
          >
            <For each={rows()}>
              {(row) => (
                <button
                  type="button"
                  data-action="links-related"
                  role="checkbox"
                  aria-checked={on(row)}
                  title={row.worktree ?? row.repo}
                  class="w-full min-w-0 px-2 py-2 rounded-md flex items-center gap-3 text-left hover:bg-surface-raised-base-hover"
                  onClick={() => setState("picked", row.key, !on(row))}
                >
                  <span
                    class="size-4 shrink-0 rounded flex items-center justify-center"
                    classList={{
                      "bg-surface-interactive-base border border-border-interactive-base": on(row),
                      "border border-border-strong-base": !on(row),
                    }}
                  >
                    <Show when={on(row)}>
                      <Icon name="check-small" size="small" class="text-text-interactive-base [&_path]:stroke-[2.25]" />
                    </Show>
                  </span>
                  <Avatar fallback={row.name} size="small" class="size-6 shrink-0 rounded" {...getAvatarColors()} />
                  <span class="flex-1 min-w-0 flex flex-col">
                    <span class="truncate text-13-medium text-text-strong">{row.name}</span>
                    <span class="truncate text-12-regular text-text-weak">
                      {row.worktree ?? `${row.repo} · ${language.t("cowork.picker.elsewhere")}`}
                    </span>
                  </span>
                </button>
              )}
            </For>
          </Show>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="large" icon="folder-add-left" data-action="links-open-project" onClick={() => void open()}>
            {language.t("links.related.open")}
          </Button>
          <Button type="button" variant="ghost" class="ml-auto" size="large" disabled={state.busy} onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="button" variant="primary" size="large" data-action="links-save" disabled={state.busy} onClick={() => void save()}>
            {state.busy ? <Spinner class="size-4" /> : null}
            {language.t("common.save")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
