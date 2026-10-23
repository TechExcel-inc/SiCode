import { createMemo, createResource, Show, type JSX } from "solid-js"
import { useParams } from "@solidjs/router"
import { Avatar } from "@opencode-ai/ui/avatar"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import { ProgressCircle } from "@opencode-ai/ui/progress-circle"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { decode64 } from "@/utils/base64"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useProviders } from "@/hooks/use-providers"
import { getSessionContextMetrics } from "@/components/session/session-context-metrics"
import { useEad } from "@/ead/settings"
import { me } from "@/ead/api"

export const RailItem = (props: {
  icon: IconProps["name"]
  label: string
  active?: boolean
  mobile?: boolean
  onClick: () => void
}): JSX.Element => (
  <Tooltip placement={props.mobile ? "bottom" : "right"} value={props.label}>
    <button
      type="button"
      data-action="rail-nav"
      aria-label={props.label}
      aria-current={props.active ? "page" : undefined}
      classList={{
        "w-12 py-1.5 rounded-lg flex flex-col items-center gap-0.5 transition-colors": true,
        "bg-surface-info-base text-text-interactive-base": props.active,
        "text-text-weak hover:bg-surface-base-hover hover:text-text-base": !props.active,
      }}
      onClick={props.onClick}
    >
      <Icon name={props.icon} size="medium" />
      <span class="text-[11px] font-medium leading-none truncate max-w-full">{props.label}</span>
    </button>
  </Tooltip>
)

export const RailUsage = (props: { mobile?: boolean }): JSX.Element => {
  const params = useParams()
  const globalSync = useGlobalSync()
  const providers = useProviders()
  const language = useLanguage()
  const layout = useLayout()

  const metrics = createMemo(() => {
    const dir = decode64(params.dir)
    if (!dir || !params.id) return
    const [store] = globalSync.child(dir, { bootstrap: false })
    return getSessionContextMetrics(store.message[params.id] ?? [], providers.all())
  })
  const usd = createMemo(() => new Intl.NumberFormat(language.intl(), { style: "currency", currency: "USD" }))

  const open = () => {
    if (!params.dir || !params.id) return
    const key = `${params.dir}/${params.id}`
    const view = layout.view(key)
    if (!view.reviewPanel.opened()) view.reviewPanel.open()
    const tabs = layout.tabs(key)
    tabs.open("context")
    tabs.setActive("context")
  }

  const value = () => (
    <Show when={metrics()} fallback={<span>{language.t("rail.usage.empty")}</span>}>
      {(m) => (
        <div>
          <div class="flex items-center gap-2">
            <span class="text-text-invert-strong">{(m().context?.total ?? 0).toLocaleString(language.intl())}</span>
            <span class="text-text-invert-base">{language.t("context.usage.tokens")}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-text-invert-strong">{m().context?.usage ?? 0}%</span>
            <span class="text-text-invert-base">{language.t("context.usage.usage")}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-text-invert-strong">{usd().format(m().totalCost)}</span>
            <span class="text-text-invert-base">{language.t("context.usage.cost")}</span>
          </div>
        </div>
      )}
    </Show>
  )

  return (
    <Tooltip placement={props.mobile ? "bottom" : "right"} value={value()}>
      <button
        type="button"
        data-action="rail-usage"
        aria-label={language.t("rail.usage")}
        class="w-12 py-1.5 rounded-lg flex flex-col items-center gap-0.5 text-text-weak hover:bg-surface-base-hover"
        onClick={open}
      >
        <ProgressCircle size={20} strokeWidth={2} percentage={metrics()?.context?.usage ?? 0} />
        <span class="text-[11px] font-medium leading-none">
          {metrics()?.context?.usage != null ? `${metrics()!.context!.usage}%` : "--"}
        </span>
      </button>
    </Tooltip>
  )
}

export const RailAccount = (props: { mobile?: boolean; onSignIn: () => void }): JSX.Element => {
  const ead = useEad()
  const language = useLanguage()
  // Tried again a few times: right after the app starts EAD Pilot may not answer yet, and the
  // avatar would otherwise stay "?" for the whole run.
  const [profile] = createResource(
    () => ead.token() || undefined,
    async (token) => {
      for (const wait of [0, 2_000, 5_000, 10_000]) {
        if (wait) await new Promise((done) => setTimeout(done, wait))
        const user = await me(token).catch(() => undefined)
        if (user) return user
      }
    },
  )
  const name = createMemo(() => profile()?.name || profile()?.email || "")

  return (
    <Show
      when={ead.token()}
      fallback={
        <Tooltip placement={props.mobile ? "bottom" : "right"} value={language.t("rail.account.signIn")}>
          <button
            type="button"
            data-action="rail-sign-in"
            aria-label={language.t("rail.account.signIn")}
            class="size-9 rounded-full border border-dashed border-border-base flex items-center justify-center text-text-weak hover:bg-surface-base-hover"
            onClick={props.onSignIn}
          >
            <Icon name="enter" size="small" />
          </button>
        </Tooltip>
      }
    >
      <DropdownMenu placement={props.mobile ? "bottom" : "right-end"}>
        <DropdownMenu.Trigger
          as="button"
          type="button"
          data-action="rail-account"
          aria-label={name() || language.t("rail.account")}
          class="size-9 rounded-full overflow-hidden"
        >
          <Avatar fallback={name() || "?"} class="size-full rounded-full" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="ml-1">
            <Show when={name()}>
              <div class="px-2 py-1.5 flex flex-col">
                <span class="text-13-medium text-text-strong">{profile()?.name || profile()?.email}</span>
                <Show when={profile()?.name && profile()?.email}>
                  <span class="text-12-regular text-text-weak">{profile()?.email}</span>
                </Show>
              </div>
              <DropdownMenu.Separator />
            </Show>
            <DropdownMenu.Item data-action="rail-sign-out" onSelect={() => ead.signOut()}>
              <DropdownMenu.ItemLabel>{language.t("rail.account.signOut")}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </Show>
  )
}
