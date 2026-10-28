import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { usePlatform } from "@/context/platform"
import { persisted } from "@/utils/persist"
import { bind } from "./http"

type State = {
  server: string
  token: string
  user: string
  name: string
  project: number
  view: "list" | "board"
}

const empty: State = { server: "", token: "", user: "", name: "", project: 0, view: "list" }

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
      save(next: Omit<State, "project" | "view">) {
        setStore({ ...next, project: store.project ?? 0, view: store.view ?? "list" })
      },
      show(view: State["view"]) {
        setStore("view", view)
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
