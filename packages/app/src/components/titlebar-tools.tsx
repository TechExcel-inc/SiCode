import { For } from "solid-js"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { normalizeLocale, useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { HELP_URL } from "./about-popover"

const button =
  "size-7 shrink-0 rounded-md flex items-center justify-center text-icon-base hover:text-text-strong hover:bg-surface-raised-base-hover data-[expanded]:bg-surface-raised-base-hover"

/** The top bar's Help and Language buttons, beside the account menu in every view. */
export function TitlebarTools() {
  const language = useLanguage()
  const platform = usePlatform()
  return (
    <div class="flex items-center gap-0.5">
      <Tooltip placement="bottom" value={language.t("about.help")}>
        <button
          type="button"
          data-action="titlebar-help"
          class={button}
          aria-label={language.t("about.help")}
          onClick={() => platform.openLink(HELP_URL)}
        >
          <Icon name="help" size="small" />
        </button>
      </Tooltip>
      <DropdownMenu placement="bottom-end" gutter={6}>
        <DropdownMenu.Trigger
          as="button"
          type="button"
          data-action="titlebar-language"
          class={button}
          aria-label={language.t("titlebar.language")}
        >
          {/* A globe, drawn here as the icon set has none. */}
          <svg
            class="size-4"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.2"
            aria-hidden="true"
          >
            <circle cx="8" cy="8" r="6.25" />
            <path d="M1.75 8h12.5M8 1.75c1.7 1.8 2.5 3.85 2.5 6.25S9.7 12.45 8 14.25C6.3 12.45 5.5 10.4 5.5 8S6.3 3.55 8 1.75z" />
          </svg>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content data-component="titlebar-language" class="max-h-[420px] overflow-y-auto">
            <DropdownMenu.RadioGroup
              value={language.locale()}
              onChange={(next) => language.setLocale(normalizeLocale(String(next)))}
            >
              <For each={language.locales}>
                {(locale) => (
                  <DropdownMenu.RadioItem value={locale}>
                    <DropdownMenu.ItemLabel>{language.label(locale)}</DropdownMenu.ItemLabel>
                    <DropdownMenu.ItemIndicator>
                      <Icon name="check-small" size="small" class="text-icon-weak" />
                    </DropdownMenu.ItemIndicator>
                  </DropdownMenu.RadioItem>
                )}
              </For>
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  )
}
