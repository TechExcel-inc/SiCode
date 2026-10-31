import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js"
import { Avatar } from "@opencode-ai/ui/avatar"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useEad } from "@/ead/settings"
import { me } from "@/ead/api"
import { useP1 } from "@/p1/settings"
import { kloud } from "@/p1/kloud"
import { HELP_URL } from "./about-popover"

/**
 * The one account menu, at the far right of the top bar in every view: the EAD Pilot account, the P1 sign-in and
 * whether P1 is linked to Kloud, then Settings, Help and the version. A dot on the avatar means an account needs
 * signing in again.
 */
export function AccountMenu(props: { onSignIn: () => void; onP1: () => void; onSettings: () => void }) {
  const ead = useEad()
  const p1 = useP1()
  const language = useLanguage()
  const platform = usePlatform()

  // Read in the background with a plain signal, never a resource: a resource read before its first answer holds the
  // window on "Loading" until EAD Pilot replies. Tried again a few times, since right after the app starts EAD Pilot
  // may not answer yet.
  const [profile, setProfile] = createSignal<Awaited<ReturnType<typeof me>>>()
  createEffect(
    on(
      () => ead.token(),
      (token) => {
        setProfile(undefined)
        if (!token) return
        const state = { live: true }
        onCleanup(() => (state.live = false))
        void (async () => {
          for (const wait of [0, 2_000, 5_000, 10_000]) {
            if (wait) await new Promise((done) => setTimeout(done, wait))
            if (!state.live) return
            const user = await me(token).catch(() => undefined)
            if (!state.live) return
            if (user) return void setProfile(user)
          }
        })()
      },
    ),
  )

  // Whether the P1 server is linked to Kloud, asked once P1 is signed in.
  const [linked, setLinked] = createSignal<boolean>()
  createEffect(
    on(
      () => [p1.server(), p1.token()] as const,
      ([server, token]) => {
        setLinked(undefined)
        if (!server || !token) return
        void kloud(server, token, language.locale())
          .then((found) => setLinked(!!found))
          .catch(() => setLinked(false))
      },
    ),
  )

  const name = createMemo(() => profile()?.name || profile()?.email || "")
  const host = createMemo(() => p1.server().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
  const p1In = createMemo(() => !!p1.token())
  // Signed out of EAD Pilot, or P1 used here before but its sign-in gone (P1 refused it or it was signed out).
  const attention = createMemo(() => !ead.token() || (!!p1.server() && !p1In()))
  const shown = createMemo(() => name() || p1.name() || "")
  const build = import.meta.env.VITE_KLOUD_BUILD || "dev"
  const label = "px-2 pt-2 pb-1 text-11-medium text-text-weaker"
  const line = "px-2 py-1 flex items-center justify-between gap-3 text-13-regular"

  return (
    <DropdownMenu placement="bottom-end" gutter={6}>
      <DropdownMenu.Trigger
        as="button"
        type="button"
        data-action="account-menu"
        aria-label={shown() || language.t("rail.account")}
        title={shown() || language.t("rail.account")}
        class="relative size-7 shrink-0 rounded-full"
      >
        <Show
          when={shown()}
          fallback={
            <span class="size-full rounded-full border border-dashed border-border-base flex items-center justify-center text-text-weak">
              <Icon name="enter" size="small" />
            </span>
          }
        >
          <Avatar fallback={shown()} class="size-full rounded-full" />
        </Show>
        <Show when={attention() && shown()}>
          <span
            data-slot="account-attention"
            class="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-[#f0b44c] ring-2 ring-background-base"
          />
        </Show>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content data-component="account-menu" class="w-[300px] mr-1">
          <Show when={name()}>
            <div class="px-2 py-2 flex items-center gap-2.5">
              <Avatar fallback={name()} class="size-9 shrink-0 rounded-full" />
              <div class="min-w-0 flex flex-col">
                <span class="truncate text-14-medium text-text-strong">{profile()?.name || profile()?.email}</span>
                <Show when={profile()?.name && profile()?.email}>
                  <span class="truncate text-12-regular text-text-weak">{profile()?.email}</span>
                </Show>
              </div>
            </div>
            <DropdownMenu.Separator />
          </Show>

          <div class={label}>{language.t("account.ead")}</div>
          <Show
            when={ead.token()}
            fallback={
              <DropdownMenu.Item data-action="account-ead-sign-in" onSelect={props.onSignIn}>
                <DropdownMenu.ItemLabel>{language.t("account.signIn")}</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            }
          >
            <DropdownMenu.Item data-action="account-ead-sign-out" onSelect={() => ead.signOut()}>
              <DropdownMenu.ItemLabel>{language.t("rail.account.signOut")}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </Show>
          <DropdownMenu.Separator />

          <div class={label}>P1</div>
          <Show when={p1In()}>
            <div class={line}>
              <span class="min-w-0 flex flex-col">
                <span class="truncate text-text-strong">{p1.name()}</span>
                <span class="truncate text-12-regular text-text-weak">{host()}</span>
              </span>
            </div>
          </Show>
          <Show
            when={p1In()}
            fallback={
              <DropdownMenu.Item data-action="account-p1-sign-in" onSelect={props.onP1}>
                <DropdownMenu.ItemLabel>{language.t("account.signIn")}</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            }
          >
            <DropdownMenu.Item data-action="account-p1-sign-out" onSelect={() => p1.clear()}>
              <DropdownMenu.ItemLabel>{language.t("rail.account.signOut")}</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </Show>

          <Show when={p1In()}>
            <DropdownMenu.Separator />
            <div class={label}>Kloud</div>
            <div class={`${line} justify-start`} data-slot="account-kloud">
              <span
                class="size-2 shrink-0 rounded-full"
                classList={{
                  "bg-[#3fbf6a]": linked() === true,
                  "bg-border-strong-base": linked() !== true,
                }}
              />
              <span class="text-text-strong">
                {language.t(
                  linked() === undefined ? "account.kloud.checking" : linked() ? "account.kloud.linked" : "account.kloud.none",
                )}
              </span>
            </div>
          </Show>
          <DropdownMenu.Separator />

          <DropdownMenu.Item data-action="account-settings" onSelect={props.onSettings}>
            <DropdownMenu.ItemLabel>{language.t("sidebar.settings")}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
          <DropdownMenu.Item data-action="account-help" onSelect={() => platform.openLink(HELP_URL)}>
            <DropdownMenu.ItemLabel>{language.t("about.help")}</DropdownMenu.ItemLabel>
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <div class="px-2 py-1.5 text-11-regular text-text-weaker select-text" data-slot="account-about">
            {language.t("about.title")} {platform.version ?? "dev"} · {language.t("about.build")} {build}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}
