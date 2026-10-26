import { createMemo, Show } from "solid-js"
import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"

const soon = {
  work: { icon: "checklist", label: "rail.work", body: "rail.soon.work" },
  spec: { icon: "edit", label: "rail.spec", body: "rail.soon.spec" },
  task: { icon: "checklist", label: "rail.task", body: "rail.soon.task" },
} as const satisfies Record<string, { icon: IconProps["name"]; label: string; body: string }>

export function RailPlaceholder() {
  const layout = useLayout()
  const language = useLanguage()
  const item = createMemo(() => {
    const nav = layout.nav.current()
    if (nav === "work" || nav === "spec" || nav === "task") return soon[nav]
  })

  return (
    <Show when={item()}>
      {(entry) => (
        <div
          data-component="rail-placeholder"
          class="absolute inset-0 z-40 bg-background-base flex flex-col items-center justify-center gap-3 px-6 text-center"
        >
          <div class="size-12 rounded-xl bg-surface-base flex items-center justify-center text-text-weak">
            <Icon name={entry().icon} size="large" />
          </div>
          <div class="text-16-medium text-text-strong">
            {language.t("rail.soon.title", { name: language.t(entry().label) })}
          </div>
          <div class="text-14-regular text-text-weak max-w-md">{language.t(entry().body)}</div>
        </div>
      )}
    </Show>
  )
}
