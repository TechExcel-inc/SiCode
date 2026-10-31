import { For, Show, createEffect, createMemo, on } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useLanguage } from "@/context/language"
import { useP1 } from "@/p1/settings"
import { readReviews, reviews, scores, spans, summary, team, type Member, type Scope } from "@/p1/workload"
import { P1Pop } from "./p1-pop"

/**
 * P1's Workload and Performance Score report for a roadmap month: each member's spec and task points against
 * target, workload, % complete, WO score and monthly score, for the whole month or one of its weeks.
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
    scores: {} as Record<number, number>,
    // WO scores for the tab by member, and the members whose WO is reviewed (the rest show N/A).
    wo: {} as Record<number, number>,
    on: [] as number[],
    syncs: undefined as unknown,
  })
  const span = () => tabs[state.tab] ?? tabs[0]
  const name = new Intl.DateTimeFormat(language.locale(), { month: "long" }).format(
    new Date(Number(props.month.slice(0, 4)), Number(props.month.slice(4)) - 1, 1),
  )
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
        setState({ members: got.members, loading: false })
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

  const average = createMemo(() =>
    team(
      state.scores,
      state.members.map((item) => item.id),
    ),
  )
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
      <div data-drag class="shrink-0 px-5 pt-4 cursor-move select-none">
        <div class="flex items-start justify-between gap-4">
          <div class="text-16-medium text-text-strong">{language.t("p1.work.title", { month: name })}</div>
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
                <th class={head} title={language.t("p1.work.spechint")}>
                  {language.t("p1.work.spec")}
                </th>
                <th class={head} title={language.t("p1.work.taskhint")}>
                  {language.t("p1.work.task")}
                </th>
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
                    <td colSpan={7} class="h-32 text-center text-13-regular text-text-weak">
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
                    <td class={cell}>{`${member.task}/${member.tasks}`}</td>
                    <td class={cell} title={language.t("p1.work.loads", { spec: member.load, task: member.work })}>
                      <Meter value={member.work} />
                    </td>
                    <td class={cell}>
                      <Meter value={member.done} />
                    </td>
                    <td class={cell}>
                      <Show
                        when={state.syncs === undefined || state.on.includes(member.id)}
                        fallback={<span class="text-text-weak">{language.t("p1.work.na")}</span>}
                      >
                        <Meter value={state.wo[member.id] ?? 0} tone="green" />
                      </Show>
                    </td>
                    <td class={`${cell} pr-5`}>
                      <Score value={state.scores[member.id] ?? 0} />
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
            <Show when={state.members.length && average() !== undefined}>
              <tfoot>
                <tr class="border-t border-border-weak-base">
                  <td colSpan={6} class={`${cell} pl-5 text-13-medium text-text-strong`}>
                    {language.t("p1.work.team")}
                  </td>
                  <td class={`${cell} pr-5`}>
                    <Score value={average() ?? 0} />
                  </td>
                </tr>
              </tfoot>
            </Show>
          </table>
        </Show>
      </div>
    </P1Pop>
  )
}

/** A percentage on a short bar, which stops at full while the number can go past 100. */
export function Meter(props: { value: number; tone?: "green" }) {
  return (
    <span class="inline-flex items-center gap-2">
      <span class="w-20 h-1.5 rounded-full bg-surface-raised-base overflow-hidden">
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
export function Score(props: { value: number }) {
  return (
    <span class="inline-flex items-center gap-2">
      <span class="min-w-7 text-right">{props.value}</span>
      <span class="w-24 h-2 rounded-sm border border-[#e2b15e] overflow-hidden">
        <span class="block h-full bg-[#e2b15e]" style={{ width: `${Math.min(100, props.value * 10)}%` }} />
      </span>
    </span>
  )
}
