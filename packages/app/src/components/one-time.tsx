import { createSignal, Show, type JSX } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import type { Session } from "@opencode-ai/sdk/v2"
import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { usePrompt } from "@/context/prompt"
import { useProviders } from "@/hooks/use-providers"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { OnceDetails } from "./model-tooltip"
import { errorText, findOpenOnce } from "@/utils/one-time"

/** A one-session-only model as the picker lists it. */
export type OnceModel = {
  id: string
  name: string
  provider: { id: string; name: string }
  oneSession?: { description?: string; price?: string; limit?: number }
}

type OneTime = NonNullable<Session["oneTime"]>

const fail = (title: string, err: unknown) => showToast({ title, description: errorText(err) })

/** The display name of a session's locked model. */
function useModelName() {
  const providers = useProviders()
  return (one: OneTime) =>
    providers.all().find((p) => p.id === one.model.providerID)?.models[one.model.modelID]?.name ?? one.model.modelID
}

/** A small gold "One-time" chip, shared by the picker, banner and sidebar. */
export function OnceTag(props: { closed?: boolean; class?: string }) {
  const language = useLanguage()
  return (
    <span
      data-component="one-time-tag"
      class={`shrink-0 px-1.5 rounded text-11-medium uppercase tracking-wide ${props.class ?? ""}`}
      classList={{
        "bg-surface-warning-weak text-text-on-warning-base": !props.closed,
        "bg-surface-base text-text-weak": props.closed,
      }}
    >
      {props.closed ? language.t("oneTime.tag.closed") : language.t("oneTime.tag")}
    </span>
  )
}

/**
 * Picking a one-session-only model: go to this session's open one-time session on that model, or open a new one,
 * with no confirmation in between. Whatever is typed in the composer goes along, unsent, so it is sent only when the
 * person presses Send in the one-time session.
 */
export function useOpenOnce() {
  const sdk = useSDK()
  const sync = useSync()
  const prompt = usePrompt()
  const language = useLanguage()
  const params = useParams()
  const navigate = useNavigate()

  return async (model: OnceModel) => {
    const origin = params.id || undefined
    const pick = { providerID: model.provider.id, modelID: model.id }
    const existing = origin ? findOpenOnce(sync.data.session ?? [], origin, pick) : undefined
    const id =
      existing?.id ??
      (await sdk.client.session.oneTime
        .open({ originSessionID: origin, model: pick })
        .then((res) => {
          if (!res.data) throw new Error(language.t("common.requestFailed"))
          return res.data.id
        })
        .catch((err: unknown) => {
          fail(language.t("oneTime.open.failed"), err)
          return undefined
        }))
    if (!id) return
    const draft = prompt.current()
    if (prompt.dirty()) {
      const scope = { dir: params.dir!, id }
      prompt.set(draft, undefined, scope)
      prompt.reset()
    }
    navigate(`/${params.dir}/session/${id}`)
  }
}

/** The bar above the composer in an open one-time session: the model, its price and usage, and the two ways out. */
export function OneTimeBanner(props: { session: Session }): JSX.Element {
  const sdk = useSDK()
  const sync = useSync()
  const prompt = usePrompt()
  const providers = useProviders()
  const language = useLanguage()
  const params = useParams()
  const navigate = useNavigate()
  const [busy, setBusy] = createSignal(false)
  const one = () => props.session.oneTime as OneTime
  const origin = () => {
    const id = one().originSessionID
    return id ? sync.session.get(id) : undefined
  }
  const model = useModelName()
  const info = () =>
    providers.all().find((p) => p.id === one().model.providerID)?.models[one().model.modelID]?.oneSession

  /** Close the session, add its answer to where the person goes next, and go there. */
  const finish = async (goTo: "origin" | "new") => {
    setBusy(true)
    const result = await sdk.client.session.oneTime
      .done({ sessionID: props.session.id, goTo, addResult: true })
      .then((res) => {
        if (!res.data) throw new Error(language.t("common.requestFailed"))
        return res.data
      })
      .catch((err: unknown) => {
        fail(language.t("oneTime.done.failed"), err)
        return undefined
      })
    setBusy(false)
    if (!result) return
    if (result.fallback) showToast({ title: language.t("oneTime.done.fallback") })
    // Whatever is typed here goes along, unsent, to the session the person goes to.
    if (prompt.dirty()) {
      prompt.set(prompt.current(), undefined, { dir: params.dir!, id: result.targetSessionID })
      prompt.reset()
    }
    navigate(`/${params.dir}/session/${result.targetSessionID}`)
  }

  return (
    <div
      data-component="one-time-banner"
      class="flex items-center gap-2 px-3 py-2 mb-1 rounded-md border border-border-warning-base bg-surface-warning-weak text-13-regular text-text-strong"
    >
      <OnceTag />
      <Tooltip
        placement="top"
        inactive={!info()}
        value={
          <div class="flex flex-col gap-1 py-1">
            <OnceDetails info={info()} />
          </div>
        }
      >
        <span class="min-w-0 truncate">
          <span class="text-13-medium">{model(one())}</span>
          <Show when={info()?.price}>
            <span class="text-text-weak"> · {info()?.price}</span>
          </Show>
        </span>
      </Tooltip>
      <span class="flex-1" />
      <Show when={origin()}>
        <Button
          variant="primary"
          size="small"
          class="shrink-0"
          data-action="one-time-done-back"
          disabled={busy()}
          onClick={() => finish("origin")}
        >
          {language.t("oneTime.banner.doneBack")}
        </Button>
      </Show>
      <Button
        variant={origin() ? "secondary" : "primary"}
        size="small"
        class="shrink-0"
        data-action="one-time-done-new"
        disabled={busy()}
        onClick={() => finish("new")}
      >
        {language.t("oneTime.banner.doneNew")}
      </Button>
    </div>
  )
}

/** Shown in place of the composer once a one-time session is closed. */
export function OneTimeClosed(props: {
  session: Session
  /** Still open, but every allowed request is used: point to the Done buttons instead of Reopen. */
  full?: boolean
  ref?: (el: HTMLDivElement) => void
}): JSX.Element {
  const sdk = useSDK()
  const sync = useSync()
  const language = useLanguage()
  const params = useParams()
  const navigate = useNavigate()
  const [busy, setBusy] = createSignal(false)
  /** The parent session it was opened from, or where Done led when there was no parent. */
  const target = () => {
    const one = props.session.oneTime as OneTime
    const id = one.originSessionID ?? one.targetSessionID
    return id ? sync.session.get(id) : undefined
  }

  const reopen = async () => {
    setBusy(true)
    await sdk.client.session.oneTime
      .reopen({ sessionID: props.session.id })
      .catch((err: unknown) => fail(language.t("oneTime.reopen.failed"), err))
    setBusy(false)
  }

  return (
    <div
      ref={props.ref}
      data-component="one-time-closed"
      class="w-full flex flex-wrap items-center gap-2 rounded-[12px] border border-border-weak-base bg-background-base p-3 text-14-regular text-text-weak"
    >
      <OnceTag closed={!props.full} />
      <span>
        {props.full
          ? language.t("oneTime.full.body", { count: (props.session.oneTime as OneTime).limit ?? 0 })
          : language.t("oneTime.closed.body")}
      </span>
      <span class="flex-1" />
      <Show when={!props.full && target()}>
        {(item) => (
          <Button
            variant="primary"
            size="small"
            data-action="one-time-return"
            title={item().title}
            onClick={() => navigate(`/${params.dir}/session/${item().id}`)}
          >
            {language.t("oneTime.closed.return")}
          </Button>
        )}
      </Show>
      <Show when={!props.full}>
        <Button variant="secondary" size="small" data-action="one-time-reopen" disabled={busy()} onClick={reopen}>
          {language.t("oneTime.closed.reopen")}
        </Button>
      </Show>
    </div>
  )
}
