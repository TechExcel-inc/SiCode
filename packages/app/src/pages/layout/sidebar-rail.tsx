import { createMemo, Show, type JSX } from "solid-js"
import { useParams } from "@solidjs/router"
import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import { ProgressCircle } from "@opencode-ai/ui/progress-circle"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { decode64 } from "@/utils/base64"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useProviders } from "@/hooks/use-providers"
import { getSessionContextMetrics } from "@/components/session/session-context-metrics"

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
