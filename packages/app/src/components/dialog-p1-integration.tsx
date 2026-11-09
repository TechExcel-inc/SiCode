import { For, Show, createResource } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Spinner } from "@opencode-ai/ui/spinner"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import { eadHttp } from "@/ead/http"
import { kloudToken } from "@/ead/kloud-sign-in"
import { useP1 } from "@/p1/settings"
import { kloudP1Servers } from "@/p1/servers"

/**
 * Avatar menu → Setup P1 Integration. SiCode is a subsystem of Kloud, so its P1 integrations are Kloud's: each is
 * set up in Kloud by a Kloud admin together with a P1 admin. This lists the ones in the person's Kloud companies;
 * adding one from SiCode (for SiCode admins) is coming.
 */
export function DialogP1Integration() {
  const language = useLanguage()
  const dialog = useDialog()
  const p1 = useP1()
  const [servers] = createResource(() => kloudP1Servers(kloudToken(), eadHttp()))
  const host = (url: string) => url.replace(/^https?:\/\//i, "").toLowerCase()
  const signedIn = (url: string) => Boolean(p1.token()) && host(p1.server()) === host(url)

  return (
    <Dialog title={language.t("p1.integration.title")}>
      <div class="flex flex-col gap-4 px-4 pb-4 text-13-regular text-text-base select-text" data-slot="p1-integration">
        <p>{language.t("p1.integration.intro")}</p>
        <div class="flex flex-col gap-2">
          <span class="text-12-medium text-text-weak">{language.t("p1.integration.list")}</span>
          <Show
            when={!servers.loading}
            fallback={
              <div class="flex items-center gap-2 text-text-weak">
                <Spinner class="size-4" />
              </div>
            }
          >
            <Show
              when={(servers() ?? []).length > 0}
              fallback={<p class="text-text-weak">{language.t("p1.integration.none")}</p>}
            >
              <ul class="flex flex-col rounded-md border border-border-weak-base">
                <For each={servers()}>
                  {(item) => (
                    <li class="flex items-center justify-between gap-3 px-3 py-2 border-b border-border-weak-base last:border-b-0">
                      <span class="min-w-0 flex flex-col">
                        <span class="truncate text-text-strong">{item.company || item.name}</span>
                        <span class="truncate text-12-regular text-text-weak">{host(item.url)}</span>
                      </span>
                      <Show when={signedIn(item.url)}>
                        <span class="shrink-0 text-12-regular text-text-weak">
                          {language.t("p1.integration.signedIn", { name: p1.name() || p1.user() })}
                        </span>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
        </div>
        <div class="flex items-center gap-3">
          <Button
            variant="secondary"
            data-action="p1-integration-add"
            onClick={() => showToast({ title: language.t("p1.integration.title"), description: language.t("p1.integration.soon") })}
          >
            {language.t("p1.integration.add")}
          </Button>
          <Button variant="primary" onClick={() => dialog.close()}>
            {language.t("common.close")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
