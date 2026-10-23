import { createMemo, createResource, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Avatar } from "@opencode-ai/ui/avatar"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { Popover } from "@opencode-ai/ui/popover"
import { getFilename } from "@opencode-ai/util/path"
import { useCowork, type CoworkEntry } from "@/context/cowork"
import { getAvatarColors } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { workspaceKey } from "@/pages/layout/helpers"

/** A search box appears once there are more projects than this. */
const SEARCH = 5

// Kept outside the component: linking a project adds its group to the sidebar, which rebuilds this
// menu, and the menu must stay open so several projects can be checked in a row.
const [menu, setMenu] = createStore({ open: undefined as string | undefined, query: "" })

/**
 * The project's related projects as a checklist: their repos, often other projects' primary repos.
 * A checked box is related; checking or unchecking saves at once. The agent may read and change every
 * related folder from this project's sessions.
 */
export function ProjectLinks(props: {
  root: string
  /** Which copy of the sidebar this is in (the desktop and the phone layout each have one). */
  place: string
  trigger: JSX.Element
  triggerProps?: Record<string, unknown>
}) {
  const language = useLanguage()
  const cowork = useCowork()
  const platform = usePlatform()
  const dialog = useDialog()
  const same = (a: string, b: string) => workspaceKey(a) === workspaceKey(b)

  // Only the copy whose button is on screen opens: the hidden phone layout, or a copy left over from
  // a sidebar rebuild, would otherwise show a second menu at the window's corner. The button is
  // measured a frame after it is placed, once it is on the page.
  const key = () => `${props.place}:${workspaceKey(props.root)}`
  const [shown, setShown] = createSignal(false)
  const place = (el: HTMLElement) => {
    const frame = requestAnimationFrame(() => setShown(el.isConnected && el.getClientRects().length > 0))
    onCleanup(() => cancelAnimationFrame(frame))
  }
  const open = () => menu.open === key() && shown()
  const setOpen = (value: boolean) => setMenu({ open: value ? key() : undefined, query: value ? menu.query : "" })

  const related = createMemo(() => cowork.relatedDirs(props.root))
  const [recent] = createResource(
    () => (open() ? props.root : undefined),
    (root) => cowork.recent({ limit: 30, current: root }),
  )
  // Related projects first, then the recent ones; never this project itself.
  const rows = createMemo(() => {
    const linked: CoworkEntry[] = related().map((dir) => ({ name: getFilename(dir) || dir, repo: "", worktree: dir }))
    const rest = (recent.latest ?? []).filter(
      (item) => !item.worktree || !related().some((dir) => same(dir, item.worktree!)),
    )
    const text = menu.query.trim().toLowerCase()
    return [...linked, ...rest]
      .filter((item) => !item.worktree || !same(item.worktree, props.root))
      .filter((item) => !text || item.name.toLowerCase().includes(text) || (item.worktree ?? item.repo).toLowerCase().includes(text))
  })
  const checked = (item: CoworkEntry) =>
    item.worktree
      ? related().some((dir) => same(dir, item.worktree!))
      : !!item.projectId && cowork.relatedIds(props.root).includes(item.projectId)

  const toggle = (item: CoworkEntry) => {
    if (checked(item)) return void (item.worktree ? cowork.unrelate(props.root, item.worktree) : undefined)
    if (item.worktree) return void cowork.relateFolder(props.root, item.worktree)
    void cowork.relateEntry(props.root, item)
  }

  // Any folder on this computer: the system folder picker, or the app's own when there is none.
  const pick = async () => {
    setOpen(false)
    const title = language.t("links.related.open")
    if (platform.openDirectoryPickerDialog) {
      const picked = await platform.openDirectoryPickerDialog({ title })
      return (Array.isArray(picked) ? picked[0] : picked) ?? undefined
    }
    const { DialogSelectDirectory } = await import("@/components/dialog-select-directory")
    return new Promise<string | undefined>((done) =>
      dialog.show(
        () => <DialogSelectDirectory onSelect={(picked) => done((Array.isArray(picked) ? picked[0] : picked) ?? undefined)} />,
        () => done(undefined),
      ),
    )
  }

  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      placement="bottom-start"
      triggerAs="button"
      triggerProps={{ type: "button", ...props.triggerProps, ref: place }}
      trigger={props.trigger}
      class="project-links !max-w-[360px] w-[340px] [&_[data-slot=popover-body]]:p-1"
    >
      <div data-component="project-links" class="flex flex-col gap-1">
        <div class="flex items-baseline justify-between gap-2 px-2 pt-1">
          <span class="min-w-0 truncate text-12-medium text-text-weak">
            {language.t("links.related.title", { project: getFilename(props.root) })}
          </span>
          <span class="shrink-0 text-11-regular text-text-weak">
            {language.t("links.related.count", { count: related().length })}
          </span>
        </div>
        <Show when={rows().length > SEARCH || menu.query}>
          <div class="mx-1 flex items-center gap-2 h-8 px-2 rounded-md bg-surface-base border border-border-weak-base focus-within:border-border-interactive-base">
            <Icon name="magnifying-glass" size="small" class="text-icon-weak shrink-0" />
            <input
              type="text"
              data-action="links-search"
              value={menu.query}
              onInput={(event) => setMenu("query", event.currentTarget.value)}
              placeholder={language.t("rail.project.search")}
              aria-label={language.t("rail.project.search")}
              class="flex-1 min-w-0 bg-transparent text-12-regular text-text-strong placeholder:text-text-weak outline-none"
            />
          </div>
        </Show>
        <div class="max-h-80 overflow-y-auto flex flex-col" role="list">
          <Show
            when={rows().length > 0}
            fallback={
              <div class="px-2 py-1.5 text-12-regular text-text-weak">
                {recent.loading ? "…" : language.t("search.related.none")}
              </div>
            }
          >
            <For each={rows()}>
              {(item) => (
                <button
                  type="button"
                  data-action="links-related"
                  role="checkbox"
                  aria-checked={checked(item)}
                  title={item.worktree ?? item.repo}
                  class="w-full min-w-0 px-2 py-1.5 rounded-md flex items-center gap-2 text-left hover:bg-surface-raised-base-hover"
                  onClick={() => toggle(item)}
                >
                  <span
                    class="size-4 shrink-0 rounded flex items-center justify-center"
                    classList={{
                      "bg-surface-interactive-base border border-border-interactive-base": checked(item),
                      "border border-border-strong-base": !checked(item),
                    }}
                  >
                    <Show when={checked(item)}>
                      <Icon name="check-small" size="small" class="text-text-interactive-base [&_path]:stroke-[2.25]" />
                    </Show>
                  </span>
                  <Avatar fallback={item.name} size="small" class="size-5 shrink-0 rounded" {...getAvatarColors()} />
                  <span class="flex-1 min-w-0 flex flex-col">
                    <span class="truncate text-13-regular text-text-strong">{item.name}</span>
                    <span class="truncate text-11-regular text-text-weak">
                      {item.worktree ?? `${item.repo} · ${language.t("cowork.picker.elsewhere")}`}
                    </span>
                  </span>
                </button>
              )}
            </For>
          </Show>
        </div>
        <div class="border-t border-border-weak-base pt-1">
          <button
            type="button"
            data-action="links-open-project"
            class="w-full px-2 py-1.5 rounded-md flex items-center gap-2 text-left text-13-regular text-text-strong hover:bg-surface-raised-base-hover"
            onClick={() =>
              void pick().then((dir) => {
                if (dir) return cowork.relateFolder(props.root, dir)
              })
            }
          >
            <Icon name="folder-add-left" size="small" class="shrink-0 text-text-strong" />
            {language.t("links.related.open")}
          </button>
        </div>
      </div>
    </Popover>
  )
}
