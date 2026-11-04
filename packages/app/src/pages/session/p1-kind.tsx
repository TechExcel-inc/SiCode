import { Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { kind } from "@/p1/kinds"

/** A story's type as a leading label, "[Design]", before its name; nothing while it has none. */
export function KindTag(props: { type: number }) {
  const language = useLanguage()
  return (
    <Show when={kind(props.type)}>
      {(key) => <span class="text-text-weak">[{language.t(`p1.kind.${key()}`)}] </span>}
    </Show>
  )
}
