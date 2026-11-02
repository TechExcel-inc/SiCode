import { For, Show, createEffect, createMemo, on, onCleanup, onMount } from "solid-js"
import { Portal } from "solid-js/web"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import { useP1 } from "@/p1/settings"
import { listed, type Story } from "@/p1/stories"
import { mean, readReviews, reviews, scores, spans, summary, team, time, type Member, type Scope } from "@/p1/workload"
import { P1Pop, layer } from "./p1-pop"
import { Tip } from "./p1-tip"

/**
 * P1's Workload and Performance Score report for a roadmap month: each member's spec points against target,
 * time spent and left, active work time when shown, workload, % complete, WO review and monthly score, for the whole
 * month or one of its weeks, with the team's average of each below.
 */
export function P1Workload(props: { place: Scope; month: string; items: number[]; onClose: () => void }) {
  const p1 = useP1()
  const language = useLanguage()
  const tabs = spans(props.month)
  const [state, setState] = createStore({
    tab: 0,
    loading: true,
    err: "",
    members: [] as Member[],
    // The tab's sprints, and the month's stories, read once, whose tasks hold everyone's time.
    sprints: [] as number[],
    stories: undefined as Story[] | undefined,
    scores: {} as Record<number, number>,
    // WO scores for the tab by member, and the members whose WO is reviewed (the rest show N/A).
    wo: {} as Record<number, number>,
    on: [] as number[],
    syncs: undefined as unknown,
    // Where the settings popup opens, while it is open.
    at: undefined as DOMRect | undefined,
  })
  const span = () => tabs[state.tab] ?? tabs[0]
  const name = new Intl.DateTimeFormat(language.locale(), { month: "long" }).format(
    new Date(Number(props.month.slice(0, 4)), Number(props.month.slice(4)) - 1, 1),
  )
  let asked = false
  const fail = (err: unknown) => setState({ err: err instanceof Error ? err.message : String(err), loading: false })

  // The members and their points for the tab; scores and WO reviews are the month's, read once.
  createEffect(
    on(
      () => state.tab,
      async (tab) => {
        setState({ loading: true, err: "" })
        const host = p1.server()
        const token = p1.token()
        const locale = language.locale()
        const got = await summary(host, token, props.place, props.items, tabs[tab] ?? tabs[0], locale).catch(fail)
        if (!got || state.tab !== tab) return
        setState({ members: got.members, sprints: got.sprints, loading: false })
        if (!asked) {
          asked = true
          void Promise.all(
            props.items.map((id) => listed(host, token, props.place.project, id, locale).catch(() => [] as Story[])),
          ).then((lists) => setState("stories", lists.flat()))
        }
        if (!Object.keys(state.scores).length)
          void scores(host, token, props.place, props.month, locale)
            .then((value) => setState("scores", value))
            .catch(() => undefined)
        if (state.syncs === undefined && got.members.length)
          void reviews(
            host,
            token,
            props.place,
            got.members.map((item) => item.id),
            props.month,
            locale,
          )
            .then((value) => setState({ syncs: value.syncs, on: value.on }))
            .catch(() => setState("syncs", null))
      },
    ),
  )
  createEffect(() => {
    if (state.syncs) setState("wo", readReviews(state.syncs, span()))
  })

  const hours = createMemo(() => time(state.stories ?? [], state.sprints, span().week === 0))
  const average = createMemo(() =>
    team(
      state.scores,
      state.members.map((item) => item.id),
    ),
  )
  // The team's average of every column; WO counts only the members whose WO is reviewed.
  const totals = createMemo(() => {
    const list = state.members
    const shown = list.filter((item) => state.syncs === undefined || state.on.includes(item.id))
    return {
      spec: mean(list.map((item) => item.spec)) ?? 0,
      target: mean(list.map((item) => item.target)) ?? 0,
      spent: mean(list.map((item) => hours()[item.id]?.spent ?? 0)) ?? 0,
      remain: mean(list.map((item) => hours()[item.id]?.remain ?? 0)) ?? 0,
      load: Math.round(mean(list.map((item) => item.load)) ?? 0),
      done: Math.round(mean(list.map((item) => item.done)) ?? 0),
      wo: shown.length ? Math.round(mean(shown.map((item) => state.wo[item.id] ?? 0)) ?? 0) : undefined,
    }
  })
  const head = "px-3 py-2.5 text-12-medium text-text-weak text-left font-medium whitespace-nowrap"
  const cell = "px-3 py-2 align-middle text-13-regular text-text-base tabular-nums"

  return (
    <P1Pop
      name="p1-workload"
      x={window.innerWidth / 2}
      y={72}
      width={980}
      min={{ w: 720, h: 360 }}
      onClose={props.onClose}
    >
      <div class="shrink-0 px-5 pt-4 select-none">
        {/* Only the title row moves the popup, so the tabs below stay plain to click. */}
        <div data-drag class="flex items-start gap-4 cursor-move">
          <div class="flex-1 min-w-0 text-16-medium text-text-strong">
            {language.t("p1.work.title", { month: name })}
          </div>
          <button
            type="button"
            data-action="p1-workload-send"
            class="-mt-1 h-8 px-3 shrink-0 rounded-lg border border-border-weak-base flex items-center gap-1.5 text-13-medium text-text-strong hover:bg-surface-raised-base-hover"
            onClick={() => showToast({ description: language.t("p1.tab.soon"), duration: 2500 })}
          >
            <Icon name="share" size="small" />
            {language.t("p1.work.send")}
          </button>
          <button
            type="button"
            data-action="p1-workload-settings"
            class="-mt-1 -mr-2 size-8 shrink-0 rounded-lg flex items-center justify-center text-icon-weak hover:text-text-strong hover:bg-surface-raised-base-hover"
            classList={{ "text-text-strong bg-surface-raised-base-hover": !!state.at }}
            aria-label={language.t("p1.work.settings")}
            onClick={(event) => setState("at", event.currentTarget.getBoundingClientRect())}
          >
            <Icon name="settings-gear" size="small" />
          </button>
          <button
            type="button"
            data-action="p1-workload-close"
            class="-mt-1 -mr-2 size-8 shrink-0 rounded-lg flex items-center justify-center text-icon-weak hover:text-text-strong hover:bg-surface-raised-base-hover"
            aria-label={language.t("common.close")}
            onClick={() => props.onClose()}
          >
            <Icon name="close" size="small" />
          </button>
        </div>
        <div class="mt-3 flex items-center gap-1 border-b border-border-weaker-base">
          <For each={tabs}>
            {(tab, index) => (
              <button
                type="button"
                data-action="p1-work-tab"
                class="h-9 px-3 -mb-px border-b-2 text-13-medium"
                classList={{
                  "border-border-interactive-base text-text-strong": state.tab === index(),
                  "border-transparent text-text-weak hover:text-text-base": state.tab !== index(),
                }}
                onClick={() => setState("tab", index())}
              >
                {tab.week ? language.t(`p1.group.week${tab.week}`) : language.t("p1.work.monthly")}
              </button>
            )}
          </For>
        </div>
      </div>
      <div class="flex-1 min-h-0 overflow-auto">
        <Show
          when={!state.err}
          fallback={<p class="px-5 py-4 text-13-regular text-text-diff-delete-base">{state.err}</p>}
        >
          <table class="w-full border-collapse">
            <thead class="sticky top-0 z-10 bg-surface-raised-stronger-non-alpha">
              <tr class="border-b border-border-weaker-base">
                <th class={`${head} pl-5`}>{language.t("p1.work.name")}</th>
                <th class={`${head} relative group/tip`}>
                  {language.t("p1.work.spec")}
                  <Tip side="left" text={language.t("p1.work.spechint")} />
                </th>
                <th class={`${head} relative group/tip`}>
                  {language.t("p1.work.time")}
                  <Tip side="left" text={language.t("p1.work.timehint")} />
                </th>
                <Show when={p1.active()}>
                  <th class={`${head} relative group/tip`}>
                    {language.t("p1.work.active")}
                    <Tip side="left" text={language.t("p1.work.activehint")} />
                  </th>
                </Show>
                <th class={head}>{language.t("p1.work.load")}</th>
                <th class={head}>{language.t("p1.work.done")}</th>
                <th class={head}>{language.t("p1.work.wo")}</th>
                <th class={`${head} pr-5`}>{language.t("p1.work.score")}</th>
              </tr>
            </thead>
            <tbody classList={{ "opacity-60": state.loading }}>
              <For
                each={state.members}
                fallback={
                  <tr>
                    <td colSpan={p1.active() ? 8 : 7} class="h-32 text-center text-13-regular text-text-weak">
                      <Show when={state.loading} fallback={language.t("p1.work.none")}>
                        <Spinner class="size-4 inline-block" />
                      </Show>
                    </td>
                  </tr>
                }
              >
                {(member) => (
                  <tr class="border-b border-border-weaker-base hover:bg-surface-base-hover">
                    <td class={`${cell} pl-5 text-text-strong`}>{member.name}</td>
                    <td class={cell}>{`${member.spec}/${member.target}`}</td>
                    <td class={cell}>
                      <Show when={state.stories} fallback={<span class="text-text-weaker">—</span>}>
                        <span class="whitespace-nowrap">
                          {(hours()[member.id]?.spent ?? 0).toFixed(1)}h<span class="mx-1 text-text-weaker">/</span>
                          {(hours()[member.id]?.remain ?? 0).toFixed(1)}h
                        </span>
                      </Show>
                    </td>
                    <Show when={p1.active()}>
                      <td class={cell}>
                        <span class="text-text-weaker">—</span>
                      </td>
                    </Show>
                    <td class={cell}>
                      <Meter value={member.load} narrow={p1.active()} />
                    </td>
                    <td class={cell}>
                      <Meter value={member.done} narrow={p1.active()} />
                    </td>
                    <td class={cell}>
                      <Show
                        when={state.syncs === undefined || state.on.includes(member.id)}
                        fallback={<span class="text-text-weak">{language.t("p1.work.na")}</span>}
                      >
                        <Meter value={state.wo[member.id] ?? 0} tone="green" narrow={p1.active()} />
                      </Show>
                    </td>
                    <td class={`${cell} pr-5`}>
                      <Score value={state.scores[member.id] ?? 0} narrow={p1.active()} />
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
            <Show when={state.members.length}>
              <tfoot>
                <tr class="border-t border-border-weak-base">
                  <td class={`${cell} pl-5 text-13-medium text-text-strong whitespace-nowrap`}>
                    {language.t("p1.work.average")}
                  </td>
                  <td class={cell}>{`${totals().spec}/${totals().target}`}</td>
                  <td class={cell}>
                    <Show when={state.stories} fallback={<span class="text-text-weaker">—</span>}>
                      <span class="whitespace-nowrap">
                        {totals().spent.toFixed(1)}h<span class="mx-1 text-text-weaker">/</span>
                        {totals().remain.toFixed(1)}h
                      </span>
                    </Show>
                  </td>
                  <Show when={p1.active()}>
                    <td class={cell}>
                      <span class="text-text-weaker">—</span>
                    </td>
                  </Show>
                  <td class={cell}>
                    <Meter value={totals().load} narrow={p1.active()} />
                  </td>
                  <td class={cell}>
                    <Meter value={totals().done} narrow={p1.active()} />
                  </td>
                  <td class={cell}>
                    <Show
                      when={totals().wo !== undefined}
                      fallback={<span class="text-text-weak">{language.t("p1.work.na")}</span>}
                    >
                      <Meter value={totals().wo ?? 0} tone="green" narrow={p1.active()} />
                    </Show>
                  </td>
                  <td class={`${cell} pr-5`}>
                    <Score value={average() ?? 0} narrow={p1.active()} />
                  </td>
                </tr>
              </tfoot>
            </Show>
          </table>
        </Show>
      </div>
      <Show when={state.at}>{(at) => <Settings at={at()} onClose={() => setState("at", undefined)} />}</Show>
    </P1Pop>
  )
}

/**
 * The report's settings: whether to show each person's active work time, AI agent time plus their time working
 * with AI, which SiCode doesn't record in P1 yet.
 */
function Settings(props: { at: DOMRect; onClose: () => void }) {
  const p1 = useP1()
  const language = useLanguage()
  const stack = layer()
  const width = 520
  const left = Math.max(16, Math.min(props.at.right - width, window.innerWidth - width - 16))
  onMount(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && stack.top()) props.onClose()
    }
    window.addEventListener("keydown", key)
    onCleanup(() => window.removeEventListener("keydown", key))
  })
  return (
    <Portal>
      <div class="fixed inset-0" style={{ "z-index": stack.z }} onClick={() => props.onClose()} />
      <div
        data-component="p1-workload-settings"
        class="fixed flex flex-col rounded-xl border border-border-strong-base bg-surface-raised-stronger-non-alpha"
        style={{
          left: `${left}px`,
          top: `${props.at.bottom + 6}px`,
          width: `${width}px`,
          "z-index": stack.z + 1,
          "box-shadow": "0 12px 32px rgb(0 0 0 / 0.35)",
        }}
      >
        <div class="h-11 pl-4 pr-2 flex items-center justify-between border-b border-border-weaker-base">
          <span class="text-14-medium text-text-strong">{language.t("p1.work.settings")}</span>
          <button
            type="button"
            class="size-8 rounded-lg flex items-center justify-center text-icon-weak hover:text-text-strong hover:bg-surface-base-hover"
            aria-label={language.t("common.close")}
            onClick={() => props.onClose()}
          >
            <Icon name="close" size="small" />
          </button>
        </div>
        <label class="px-4 py-3 flex items-start gap-2 text-13-regular text-text-base cursor-pointer">
          <input
            type="checkbox"
            data-action="p1-workload-active"
            class="mt-0.5 size-4 shrink-0 accent-[var(--surface-interactive-base)]"
            checked={p1.active()}
            onChange={(event) => p1.activate(event.currentTarget.checked)}
          />
          <span class="whitespace-nowrap">{language.t("p1.work.show")}</span>
        </label>
      </div>
    </Portal>
  )
}

/** A percentage on a short bar, which stops at full while the number can go past 100. */
export function Meter(props: { value: number; tone?: "green"; narrow?: boolean }) {
  return (
    <span class="inline-flex items-center gap-2">
      <span
        class="h-1.5 shrink-0 rounded-full bg-surface-raised-base overflow-hidden"
        classList={{ "w-20": !props.narrow, "w-12": props.narrow }}
      >
        <span
          class="block h-full rounded-full"
          classList={{ "bg-surface-interactive-base": !props.tone, "bg-[#3ccf7e]": props.tone === "green" }}
          style={{ width: `${Math.min(100, Math.max(0, props.value))}%` }}
        />
      </span>
      <span class="min-w-10">{props.value}%</span>
    </span>
  )
}

/** A score out of 10 with a gold bar, as P1 draws it. */
export function Score(props: { value: number; narrow?: boolean }) {
  return (
    <span class="inline-flex items-center gap-2">
      <span class="min-w-7 text-right">{props.value}</span>
      <span
        class="h-2 shrink-0 rounded-sm border border-[#e2b15e] overflow-hidden"
        classList={{ "w-24": !props.narrow, "w-14": props.narrow }}
      >
        <span class="block h-full bg-[#e2b15e]" style={{ width: `${Math.min(100, props.value * 10)}%` }} />
      </span>
    </span>
  )
}
