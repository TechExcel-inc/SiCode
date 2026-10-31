import { For, Show } from "solid-js"

/**
 * A small framed card under whatever it sits in while you point at it (or focus it): a line of text, or
 * labels with their values. Its parent needs `relative group/tip`.
 */
export function Tip(props: { text?: string; rows?: [string, string][]; side?: "left" | "right"; up?: boolean }) {
  return (
    <div
      role="tooltip"
      class="pointer-events-none absolute z-50 p-3 rounded-xl border border-border-strong-base bg-surface-raised-stronger-non-alpha text-left opacity-0 translate-y-1 transition duration-150 group-hover/tip:opacity-100 group-hover/tip:translate-y-0 group-focus-within/tip:opacity-100 group-focus-within/tip:translate-y-0"
      classList={{
        "top-full mt-2": !props.up,
        "bottom-full mb-2": !!props.up,
        "right-0": props.side !== "left",
        "left-0": props.side === "left",
        "w-52": !!props.rows,
        "w-max max-w-64": !props.rows,
      }}
      style={{ "box-shadow": "0 12px 32px rgb(0 0 0 / 0.35)" }}
    >
      <Show when={props.text}>
        <p class="text-12-regular text-text-base whitespace-normal font-normal normal-case tracking-normal">
          {props.text}
        </p>
      </Show>
      <For each={props.rows ?? []}>
        {(row, index) => (
          <div
            class="flex items-baseline justify-between gap-4 py-1"
            classList={{ "border-t border-border-weaker-base": index() > 0 }}
          >
            <span class="text-12-regular text-text-weak">{row[0]}</span>
            <span
              class="tabular-nums text-text-strong"
              classList={{ "text-14-medium": index() === 0, "text-13-regular": index() > 0 }}
            >
              {row[1]}
            </span>
          </div>
        )}
      </For>
    </div>
  )
}
