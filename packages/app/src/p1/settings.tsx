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
}

const empty: State = { server: "", token: "", user: "", name: "", project: 0 }

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
      project: () => store.project ?? 0,
      signed: () => !!(store.token ?? "").trim(),
      save(next: Omit<State, "project">) {
        setStore({ ...next, project: store.project ?? 0 })
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
