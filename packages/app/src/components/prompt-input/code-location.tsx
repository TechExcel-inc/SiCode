import { createMemo, createSignal, For, Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { Popover } from "@opencode-ai/ui/popover"
import { Switch } from "@opencode-ai/ui/switch"
import { useCowork } from "@/context/cowork"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSync } from "@/context/sync"
import { useEad } from "@/ead/settings"
import { placeKey } from "@/ead/place"

/**
 * The composer's dev server picker, for a project whose product develops repos on a Shared Server. It picks where
 * this session works on the project's repo: its Shared Server (by short name) or the Local Server. While a request
 * runs it names where the work is happening: the server once a step reaches it (the dot pulses while one runs
 * there), otherwise Local.
 */
export function CodeLocation(props: { session?: string; directory: string }) {
  const ead = useEad()
  const cowork = useCowork()
  const layout = useLayout()
  const language = useLanguage()
  const sync = useSync()
  const [open, setOpen] = createSignal(false)

  const repo = () => cowork.repoOf(props.directory)
  const place = createMemo(() =>
    ead.place(repo(), [layout.nav.current() === "ead" ? ead.productId() : 0, cowork.productOf(props.directory) ?? 0]),
  )
  // Shown when the product develops any repo on a Shared Server; a repo of its own on none offers only Local.
  const shown = createMemo(() => {
    const found = place()
    return found?.product.repos.some((row) => row.serverId) ? found : undefined
  })
  const server = () => place()?.server
  const key = () => placeKey(props.session, props.directory)
  // Remote coding for the whole product, then this session's choice for its repo.
  const enabled = () => !!place() && ead.productRemote(place()!.product.productId)
  const on = () => enabled() && !!place()?.repo.serverId && ead.remote(key(), repo())

  // The latest request's steps that reach the server: they use its SSH key or name its host.
  const steps = createMemo(() => {
    const found = server()
    const messages = props.session ? (sync.data.message[props.session] ?? []) : []
    if (!found) return []
    const last = messages.findLastIndex((message) => message.role === "user")
    if (last < 0) return []
    return messages
      .slice(last + 1)
      .flatMap((message) => sync.data.part[message.id] ?? [])
      .filter((part) => part.type === "tool")
      .filter((part) => {
        const text = JSON.stringify(part.state.input ?? {})
        return text.includes(`sicode_ead_s${found.serverId}_`) || text.includes(found.sshHost)
      })
  })
  const working = () => !!props.session && (sync.data.session_status[props.session]?.type ?? "idle") !== "idle"
  // Where the work is happening now: an idle session counts as wherever it is set to work.
  const remote = () => on() && (!working() || steps().length > 0)
  const busy = () => steps().some((part) => part.state.status === "running" || part.state.status === "pending")
  // The key isn't on the server yet (SiCode is putting it there) or the server is gone.
  const warn = () => remote() && !server()?.enabled

  const name = () => server()?.shortName ?? language.t("place.missing")
  const label = () => (remote() ? name() : language.t("place.local"))
  const choose = (value: boolean) => {
    ead.setRemote(key(), value, repo())
    setOpen(false)
  }

  return (
    <Show when={shown()}>
      {(found) => (
        <div data-component="prompt-code-location">
          <Popover
            open={open()}
            onOpenChange={setOpen}
            placement="top-end"
            triggerAs="button"
            triggerProps={{
              type: "button",
              "aria-label": language.t("place.title"),
              class:
                "h-7 px-2 flex items-center gap-1.5 rounded-md text-13-regular text-text-base hover:bg-surface-raised-base-hover",
            }}
            trigger={
              <>
                <span
                  class="size-2 shrink-0 rounded-full"
                  classList={{
                    "bg-[#3fbf6a]": remote() && !warn(),
                    "animate-pulse": busy(),
                    "bg-[#e0a43c]": warn(),
                    "bg-border-strong-base": !remote(),
                  }}
                />
                <span class="truncate max-w-[160px]">{label()}</span>
              </>
            }
            class="!min-w-0 w-[340px] [&_[data-slot=popover-body]]:p-0"
          >
            <div class="flex flex-col gap-3 p-4 select-text">
              <div class="flex flex-col gap-0.5">
                <span class="text-14-medium text-text-strong">{language.t("place.title")}</span>
                <span class="text-12-regular text-text-weak break-words">
                  {found().product.name} · {found().repo.name || found().repo.repository}
                </span>
              </div>
              <label class="flex items-center justify-between gap-3 text-13-regular text-text-strong">
                {language.t("place.enable")}
                <Switch
                  checked={enabled()}
                  onChange={(value) => ead.setProductRemote(found().product.productId, value)}
                />
              </label>
              <div
                class="flex flex-col rounded-md border border-border-weak-base overflow-hidden"
                classList={{ "opacity-50 pointer-events-none": !enabled() }}
              >
                <For
                  each={[
                    ...(found().repo.serverId
                      ? [{ value: true, title: name(), detail: found().repo.folder || server()?.rootFolder || "" }]
                      : []),
                    { value: false, title: language.t("place.localServer"), detail: props.directory },
                  ]}
                >
                  {(item) => (
                    <button
                      type="button"
                      data-action="prompt-code-location-choose"
                      class="flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-raised-base-hover border-t border-border-weaker-base first:border-t-0"
                      onClick={() => choose(item.value)}
                    >
                      <span class="size-4 shrink-0 flex items-center justify-center text-text-interactive-base">
                        <Show when={on() === item.value}>
                          <Icon name="check-small" size="small" />
                        </Show>
                      </span>
                      <span class="flex-1 min-w-0 flex flex-col">
                        <span class="text-13-medium text-text-strong">{item.title}</span>
                        <span class="text-12-regular text-text-weak font-mono break-all">{item.detail}</span>
                      </span>
                    </button>
                  )}
                </For>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-12-medium text-text-weak">{language.t("place.repos")}</span>
                <For
                  each={found().product.repos.filter(
                    (row, index, all) =>
                      !!row.serverId && all.findIndex((item) => item.definitionId === row.definitionId) === index,
                  )}
                >
                  {(row) => (
                    <div
                      class="flex items-center gap-2 text-12-regular"
                      classList={{ "text-text-strong": row === found().repo, "text-text-base": row !== found().repo }}
                    >
                      <span
                        class="size-1.5 shrink-0 rounded-full"
                        classList={{
                          "bg-[#3fbf6a]": !!row.serverId && enabled(),
                          "bg-border-strong-base": !row.serverId || !enabled(),
                        }}
                      />
                      <span class="flex-1 min-w-0 truncate">{row.name || row.repository}</span>
                      <span class="shrink-0 text-text-weak">
                        {row.serverId
                          ? (found().servers.find((item) => item.serverId === row.serverId)?.shortName ??
                            language.t("place.missing"))
                          : language.t("place.localServer")}
                      </span>
                    </div>
                  )}
                </For>
              </div>
              <Show when={on() && server() && !server()!.enabled}>
                <p class="text-12-regular text-text-weak">{language.t("place.waiting")}</p>
              </Show>
            </div>
          </Popover>
        </div>
      )}
    </Show>
  )
}
