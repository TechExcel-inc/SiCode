import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Popover } from "@opencode-ai/ui/popover"
import { createSignal } from "solid-js"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"

/** Where "Online Help" goes: the EAD SiCode page on eadfm.com. */
export const HELP_URL = "https://eadfm.com/sicode/"

/** The rail's About button: product name, version, build number, and a link to online help. */
export function AboutPopover(props: { mobile?: boolean }) {
  const language = useLanguage()
  const platform = usePlatform()
  const [open, setOpen] = createSignal(false)
  const build = import.meta.env.VITE_KLOUD_BUILD || "dev"

  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      placement={props.mobile ? "bottom" : "right-end"}
      triggerAs={IconButton}
      triggerProps={{
        icon: "help",
        variant: "ghost",
        size: "large",
        "aria-label": language.t("about.label"),
        title: language.t("about.label"),
        "data-action": "rail-about",
      }}
      class="about-popover !min-w-0 w-[240px] [&_[data-slot=popover-body]]:p-0"
    >
      <div class="flex flex-col gap-3 p-4 select-text">
        <div class="flex flex-col gap-0.5">
          <span class="text-14-medium text-text-strong">{language.t("about.title")}</span>
          <span data-slot="about-tagline" class="text-12-regular text-text-weak">{language.t("about.tagline")}</span>
        </div>
        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-12-regular">
          <dt class="text-text-weak">{language.t("about.version")}</dt>
          <dd class="text-text-strong tabular-nums" data-action="about-version">
            {platform.version ?? "dev"}
          </dd>
          <dt class="text-text-weak">{language.t("about.build")}</dt>
          <dd class="text-text-strong font-mono" data-action="about-build">
            {build}
          </dd>
        </dl>
        <button
          type="button"
          data-action="about-help"
          class="self-start flex items-center gap-1.5 text-12-medium text-text-interactive-base hover:underline"
          onClick={() => {
            setOpen(false)
            platform.openLink(HELP_URL)
          }}
        >
          <Icon name="help" size="small" />
          {language.t("about.help")}
        </button>
      </div>
    </Popover>
  )
}
