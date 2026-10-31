import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { usePlatform } from "@/context/platform"
import { persisted } from "@/utils/persist"
import type { Filter } from "./filter"
import { bind } from "./http"

type State = {
  server: string
  token: string
  user: string
  name: string
  project: number
  view: "list" | "board"
  // The folder tree is closed; hovering its icon shows it over the list.
  folded?: boolean
  // Each column's width as you dragged it: the list's by field id, a popup's by "popup.column".
  widths: Record<string, number>
  // Where each popup was moved to and how big it was made, by popup name.
  boxes: Record<string, Box>
  // The requirement list's filter and grouping, by requirement project.
  filters?: Record<string, Filter>
  // What clicking a field in the list does: edit it where it is, or open the edit panel beside the list.
  edit?: "inline" | "panel"
}

export type Box = { x: number; y: number; w: number; h?: number }

const empty: State = { server: "", token: "", user: "", name: "", project: 0, view: "list", widths: {}, boxes: {} }

export const { use: useP1, provider: P1Provider } = createSimpleContext({
  name: "P1",
  init: () => {
    bind(usePlatform())
    const [store, setStore, , ready] = persisted("p1.v1", createStore<State>({ ...empty }))
    return {
      ready,
      server: () => store.server ?? "",
      token: () => store.token ?? "",
      name: () => store.name ?? "",
      user: () => store.user ?? "",
      view: () => store.view ?? "list",
      project: () => store.project ?? 0,
      signed: () => !!(store.token ?? "").trim(),
      save(next: Omit<State, "project" | "view" | "folded" | "widths" | "boxes" | "filters">) {
        setStore({
          ...next,
          project: store.project ?? 0,
          view: store.view ?? "list",
          widths: store.widths ?? {},
          boxes: store.boxes ?? {},
        })
      },
      edit: () => store.edit ?? "panel",
      mode(next: "inline" | "panel") {
        setStore("edit", next)
      },
      folded: () => !!store.folded,
      fold(on: boolean) {
        setStore("folded", on)
      },
      show(view: State["view"]) {
        setStore("view", view)
      },
      width: (id: number | string) => store.widths?.[id] as number | undefined,
      size(id: number | string, px?: number) {
        setStore("widths", (all) => ({ ...all, [id]: px }))
      },
      filter: (project: number) => store.filters?.[project] as Filter | undefined,
      refine(project: number, next: Filter) {
        setStore("filters", (all) => ({ ...all, [project]: next }))
      },
      box: (name: string) => store.boxes?.[name] as Box | undefined,
      place(name: string, box: Box) {
        setStore("boxes", (all) => ({ ...all, [name]: box }))
      },
      choose(id: number) {
        setStore("project", id)
      },
      clear() {
        setStore({ token: "", user: "", name: "" })
      },
    }
  },
})
