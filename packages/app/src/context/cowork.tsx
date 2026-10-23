import { createSimpleContext } from "@opencode-ai/ui/context"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast, toaster } from "@opencode-ai/ui/toast"
import { useLocation } from "@solidjs/router"
import { createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { getFilename } from "@opencode-ai/util/path"
import { DialogGitHub } from "@/components/dialog-github"
import { me } from "@/ead/api"
import { tokenUser } from "@/ead/auth"
import { cowork, CoworkFail, githubRepo, type CoworkProject, type CoworkRelated } from "@/ead/cowork"
import { useEad } from "@/ead/settings"
import { decode64 } from "@/utils/base64"
import { useGlobalSDK } from "./global-sdk"
import { useGlobalSync } from "./global-sync"
import { useLanguage } from "./language"
import { useLayout } from "./layout"
import { workspaceKey } from "@/pages/layout/helpers"

/**
 * Runs `fn` once the page's toast area has been on screen, unchanged, for a second. At start-up the
 * layout mounts it more than once, and a toast shown into a toast area that is then replaced is lost.
 */
const later = (fn: () => void, tries = 150, seen?: Element, since = 0) => {
  const region = document.querySelector('[data-component="toast-region"]') ?? undefined
  const now = Date.now()
  if (tries <= 0 || (region && region === seen && now - since >= 1000)) return fn()
  setTimeout(() => later(fn, tries - 1, region, region === seen ? since : now), 100)
}

const absolute = (dir: string | undefined) => !!dir && (dir.startsWith("/") || /^[A-Za-z]:[\\/]/.test(dir))

/** A Pilot project with this computer's folder for it, when there is one. */
/** A project for the pickers: from EAD Pilot (with `projectId`) or only on this computer (without). */
export type CoworkEntry = { projectId?: number; name: string; repo: string; worktree?: string }

/**
 * CoWork's link to EAD Pilot. Projects, recent use, related projects and the GitHub connection
 * live in Pilot's database; which folder holds a project on this computer stays local (the
 * engine's project_link table). Opening a folder resolves its GitHub repository to a Pilot project.
 */
export const { use: useCowork, provider: CoworkProvider } = createSimpleContext({
  name: "Cowork",
  init: () => {
    const sdk = useGlobalSDK()
    const sync = useGlobalSync()
    const ead = useEad()
    const layout = useLayout()
    const language = useLanguage()
    const dialog = useDialog()
    const location = useLocation()

    const token = createMemo(() => ead.token().trim())
    const user = createMemo(() => tokenUser(token()))
    // The company comes from Pilot's /auth/me. A plain signal, not a resource, so loading it never suspends the app.
    const [tenant, setTenant] = createSignal<number | undefined | null>(null)
    // Re-read when the sign-in or the Pilot server (production or localhost) changes.
    createEffect(
      on([token, ead.server], ([value, server]) => {
        setTenant(null)
        if (!server) return
        if (!value) return setTenant(undefined)
        void me(value)
          .then((profile) => setTenant(profile.tenantId || undefined))
          .catch(() => setTenant(undefined))
      }),
    )
    const client = createMemo(() => {
      const company = tenant()
      ead.server()
      if (!token() || !user() || company === null) return
      return cowork(token(), company)
    })
    // An EAD Pilot without the CoWork API (not yet upgraded) answers 404: leave these features off quietly.
    const [supported, setSupported] = createSignal<boolean>()
    createEffect(
      on(client, (next) => {
        setSupported(undefined)
        if (!next) return
        void next
          .settings()
          .then(() => setSupported(true))
          .catch((err) => setSupported(!(err instanceof CoworkFail && err.code === "HTTP_404")))
      }),
    )
    const api = createMemo(() => (supported() ? client() : undefined))

    const [store, setStore] = createStore({
      /** Local folder (workspace key) to Pilot project id, for this person on this computer. */
      links: {} as Record<string, { directory: string; projectId: number }>,
      /** Related projects per Pilot project id. */
      related: {} as Record<number, CoworkRelated[]>,
      github: undefined as boolean | undefined,
    })

    // Root folder of a directory: the local project whose worktree or sandboxes include it.
    const rootOf = (dir: string) => {
      const key = workspaceKey(dir)
      const match = sync.data.project.find(
        (item) => workspaceKey(item.worktree) === key || item.sandboxes?.some((x) => workspaceKey(x) === key),
      )
      return match && match.worktree !== "/" ? match.worktree : dir
    }
    const projectOf = (dir: string | undefined) => {
      if (!dir) return
      return store.links[workspaceKey(dir)]?.projectId ?? store.links[workspaceKey(rootOf(dir))]?.projectId
    }
    const folderOf = (projectId: number) =>
      Object.values(store.links).find((link) => link.projectId === projectId)?.directory

    const loadLinks = async () => {
      if (!user()) return setStore("links", reconcile({}))
      const rows = await sdk.client.global.projectLink
        .list({ user: user() })
        .then((res) => (Array.isArray(res.data) ? res.data : []))
        .catch(() => [])
      const next: Record<string, { directory: string; projectId: number }> = {}
      // Newest first: keep the newest folder for each key.
      for (const row of rows) next[workspaceKey(row.directory)] ??= { directory: row.directory, projectId: row.projectId }
      setStore("links", reconcile(next))
    }

    const loadGithub = async () => {
      const client = api()
      if (!client) return setStore("github", undefined)
      const list = await client.accounts().catch(() => undefined)
      setStore("github", list ? list.some((x) => x.repoPlatform === "GITHUB" && x.status === "ACTIVE") : undefined)
    }

    createEffect(on(user, () => void loadLinks()))
    createEffect(on(api, () => void loadGithub()))

    const connect = (after?: () => void) => {
      if (!api()) return
      dialog.show(() => (
        <DialogGitHub
          api={api()!}
          onConnected={() => {
            setStore("github", true)
            after?.()
          }}
        />
      ))
    }

    /** Explains why a folder could not be linked to its Pilot project, with a way forward when there is one. */
    const explain = (dir: string, err: unknown) => {
      const fail = err instanceof CoworkFail ? err : undefined
      if (fail?.code === "OFFLINE") return
      const name = getFilename(dir) || dir
      later(() => {
        const id: number = showToast({
        variant: "error",
        persistent: fail?.code === "GITHUB_NOT_CONNECTED",
        title: language.t("cowork.project.unlinked", { name }),
        description: fail?.message ?? (err instanceof Error ? err.message : String(err)),
        actions:
          fail?.code === "GITHUB_NOT_CONNECTED"
            ? [
                {
                  label: language.t("cowork.github.connect"),
                  onClick: () =>
                    connect(() => {
                      toaster.dismiss(id)
                      void link(dir, true)
                    }),
                },
                { label: language.t("common.dismiss"), onClick: "dismiss" },
              ]
            : undefined,
        })
      })
    }

    const resolving = new Map<string, Promise<CoworkProject | undefined>>()
    const opened = new Set<string>()

    /** Links a folder to its Pilot project through its GitHub remote. Records the project as opened. */
    const link = (dir: string, force = false): Promise<CoworkProject | undefined> => {
      const client = api()
      if (!client || !absolute(dir)) return Promise.resolve(undefined)
      const root = rootOf(dir)
      const key = workspaceKey(root)
      const known = store.links[key]?.projectId
      if (known && opened.has(key) && !force) return Promise.resolve(undefined)
      const pending = resolving.get(key)
      if (pending) return pending
      const run = (async () => {
        if (known && !force) {
          opened.add(key)
          return client.activity(known, "OPENED")
        }
        const vcs = await sdk.client.vcs.get({ directory: root }).then((res) => res.data)
        const remote = vcs?.remote_url
        if (!remote) throw new CoworkFail(400, "NO_REMOTE", language.t("cowork.project.noRemote"))
        const project = await client.resolve(remote)
        await sdk.client.global.projectLink.save({ user: user(), directory: root, projectId: project.projectId, repoId: project.repoId })
        setStore("links", key, { directory: root, projectId: project.projectId })
        opened.add(key)
        return project
      })()
        .catch((err) => {
          explain(root, err)
          return undefined
        })
        .finally(() => resolving.delete(key))
      resolving.set(key, run)
      return run
    }

    // Opening a project (its page), and signing in while one is open.
    createEffect(
      on([() => decode64(location.pathname.split("/")[1]), api], ([dir]) => {
        if (dir) void link(dir)
      }),
    )

    // Closing a project removes it from the open list.
    createEffect(
      on(
        () => layout.projects.list().map((item) => item.worktree),
        (next, prev) => {
          const client = api()
          if (!prev || !client) return
          for (const dir of prev) {
            if (next.includes(dir)) continue
            const id = projectOf(dir)
            if (!id) continue
            opened.delete(workspaceKey(dir))
            void client.activity(id, "CLOSED").catch(() => undefined)
            void client.sidebar(id, false).catch(() => undefined)
          }
        },
      ),
    )

    // Working in a project: a session there starts running. At most once a minute per project.
    const worked = new Map<number, number>()
    const stop = sdk.event.listen((e) => {
      const event = e.details
      if (event?.type !== "session.status" || event.properties.status.type !== "busy") return
      const client = api()
      const id = projectOf(e.name)
      if (!client || !id) return
      const now = Date.now()
      if (now - (worked.get(id) ?? 0) < 60_000) return
      worked.set(id, now)
      void client.activity(id, "WORKED").catch(() => undefined)
    })
    onCleanup(stop)

    // Local projects by GitHub "owner/name", from their git remotes: finds a Pilot project's folder on
    // this computer before it has been opened in CoWork. Looked up once per folder.
    const [remotes, setRemotes] = createStore<Record<string, string>>({})
    const looked = new Set<string>()
    const discover = async () => {
      const dirs = sync.data.project.map((item) => item.worktree).filter((dir) => absolute(dir) && dir !== "/" && !looked.has(dir))
      await Promise.all(
        dirs.map(async (dir) => {
          looked.add(dir)
          const url = await sdk.client.vcs
            .get({ directory: dir })
            .then((res) => res.data?.remote_url)
            .catch(() => undefined)
          const repo = githubRepo(url)
          if (repo) setRemotes(repo, dir)
        }),
      )
    }

    const entry = (item: CoworkProject): CoworkEntry => ({
      projectId: item.projectId,
      name: item.projectName,
      repo: `${item.repoOwner}/${item.repoName}`,
      worktree: folderOf(item.projectId) ?? remotes[`${item.repoOwner}/${item.repoName}`.toLowerCase()],
    })

    // The related projects' folders the server keeps on its project: the agent reads and changes them
    // from this project's sessions, and the list also holds folders EAD Pilot cannot save (no GitHub
    // repository). A related folder is often another project's primary repo.
    const local = (root: string) => sync.data.project.find((item) => workspaceKey(item.worktree) === workspaceKey(root))
    // What this app last saved, by project, until the server's copy arrives: several saves in a row
    // each build on the one before instead of on a list that is not updated yet.
    const [saved, setSaved] = createStore<Record<string, string[]>>({})
    const kept = (root: string) => saved[workspaceKey(root)] ?? local(root)?.related ?? []
    const keep = async (root: string, dirs: string[]) => {
      const project = local(root)
      if (!project) return
      const next = [...new Set(dirs)].filter((dir) => workspaceKey(dir) !== workspaceKey(root)).toSorted()
      if (next.join("\n") === kept(root).join("\n")) return
      setSaved(workspaceKey(root), next)
      await sdk.client.project.update({ projectID: project.id, related: next }).catch(() => undefined)
    }

    const loadRelated = async (projectId: number) => {
      const client = api()
      if (!client) return
      const list = await client.related(projectId).catch(() => undefined)
      if (!list) return
      setStore("related", projectId, list)
      // EAD Pilot's relations also reach the server, so the agent knows them.
      const root = folderOf(projectId)
      const dirs = list.flatMap((item) => folderOf(item.relatedProjectId) ?? [])
      if (root && dirs.some((dir) => !kept(root).includes(dir))) void keep(root, [...kept(root), ...dirs])
    }

    return {
      user,
      tenant: () => tenant() ?? undefined,
      signedIn: () => !!api(),
      github: () => store.github,
      connect,
      link,
      projectOf,
      folderOf,
      /**
       * Projects for the pickers, most recently used first: the person's EAD Pilot projects, then the
       * projects on this computer that Pilot does not list (all of them while Pilot is unavailable).
       * `current` is always included. `pilot` lists Pilot projects only, for choices Pilot must save.
       */
      async recent(input: { limit?: number; q?: string; skip?: number[]; current?: string; pilot?: boolean } = {}) {
        const client = api()
        const limit = input.limit ?? 10
        const skip = new Set(input.skip ?? [])
        const text = input.q?.trim().toLowerCase() ?? ""
        const [list] = await Promise.all([
          client
            ? client.recent({ limit: Math.min(100, limit + skip.size), q: text || undefined }).catch(() => [])
            : Promise.resolve([] as CoworkProject[]),
          client ? discover() : Promise.resolve(),
        ])
        const pilot = list.filter((item) => !skip.has(item.projectId)).map(entry)
        if (input.pilot) return pilot.slice(0, limit)
        const seen = new Set(pilot.flatMap((item) => (item.worktree ? [workspaceKey(item.worktree)] : [])))
        const local = [...layout.projects.list(), ...sync.data.project]
          .toSorted((a, b) => (b.time?.updated ?? b.time?.created ?? 0) - (a.time?.updated ?? a.time?.created ?? 0))
          .flatMap((item): CoworkEntry[] => {
            const key = workspaceKey(item.worktree)
            if (!absolute(item.worktree) || item.worktree === "/" || seen.has(key)) return []
            const id = projectOf(item.worktree)
            if (id && skip.has(id)) return []
            seen.add(key)
            return [{ projectId: id, name: item.name || getFilename(item.worktree) || item.worktree, repo: "", worktree: item.worktree }]
          })
          .filter((item) => !text || item.name.toLowerCase().includes(text) || item.worktree!.toLowerCase().includes(text))
        const out = [...pilot, ...local].slice(0, limit)
        const current = input.current
        if (current && !text && !out.some((item) => item.worktree && workspaceKey(item.worktree) === workspaceKey(current))) {
          out.unshift({ projectId: projectOf(current), name: getFilename(current) || current, repo: "", worktree: current })
        }
        return out.slice(0, limit)
      },
      /** Folders of the projects related to the project in `root`, that exist on this computer. */
      relatedDirs(root: string) {
        const id = projectOf(root)
        if (id && !store.related[id]) void loadRelated(id)
        const pilot = id
          ? (store.related[id] ?? []).flatMap((item) => {
              const dir = folderOf(item.relatedProjectId)
              return dir ? [dir] : []
            })
          : []
        return [...new Set([...pilot, ...kept(root)])]
      },
      relatedIds(root: string) {
        const id = projectOf(root)
        if (!id) return [] as number[]
        if (!store.related[id]) void loadRelated(id)
        return (store.related[id] ?? []).map((item) => item.relatedProjectId)
      },
      async relate(root: string, relatedProjectId: number) {
        const client = api()
        const id = projectOf(root)
        if (!client || !id || id === relatedProjectId) return
        const list = await client.relate(id, relatedProjectId)
        setStore("related", id, list)
        const dir = folderOf(relatedProjectId)
        if (!dir) return
        layout.projects.open(dir)
        await keep(root, [...kept(root), dir])
      },
      /**
       * Sets the related folders in one step (the dialog's Save), then brings EAD Pilot in line:
       * removed ones are unlinked there, and added ones with a GitHub repository are linked.
       */
      async setRelated(root: string, dirs: string[]) {
        const same = (a: string, b: string) => workspaceKey(a) === workspaceKey(b)
        const before = this.relatedDirs(root)
        const added = dirs.filter((dir) => !before.some((item) => same(item, dir)))
        const removed = before.filter((dir) => !dirs.some((item) => same(item, dir)))
        added.forEach((dir) => layout.projects.open(dir))
        await keep(root, dirs)
        const client = api()
        if (!client) return
        const id = projectOf(root) ?? (await link(root, true))?.projectId
        if (!id) return
        await Promise.all(
          removed.flatMap((dir) => {
            const other = projectOf(dir)
            return other ? [client.unrelate(id, other).catch(() => undefined)] : []
          }),
        )
        for (const dir of added) {
          const remote = await sdk.client.vcs
            .get({ directory: dir })
            .then((res) => res.data?.remote_url)
            .catch(() => undefined)
          const other = remote ? (projectOf(dir) ?? (await link(dir, true))?.projectId) : undefined
          if (other && other !== id) await client.relate(id, other).catch(() => undefined)
        }
        await loadRelated(id)
      },
      /**
       * Relates any folder on this computer: it opens as a project and the agent may change it from
       * this project's sessions. EAD Pilot also saves the relation when the folder has a GitHub repository.
       */
      async relateFolder(root: string, dir: string) {
        if (workspaceKey(dir) === workspaceKey(root)) return
        layout.projects.open(dir)
        await keep(root, [...kept(root), dir])
        if (!api()) return
        const remote = await sdk.client.vcs
          .get({ directory: dir })
          .then((res) => res.data?.remote_url)
          .catch(() => undefined)
        if (!remote) return
        const item = await link(dir, true)
        if (!item) return
        if (!projectOf(root)) await link(root, true)
        await this.relate(root, item.projectId).catch(() => undefined)
      },
      /** Relates a picked project; a folder Pilot does not know yet is first registered through its GitHub repository. */
      async relateEntry(root: string, item: CoworkEntry) {
        const id = item.projectId ?? (item.worktree ? (await link(item.worktree, true))?.projectId : undefined)
        if (!id) return
        if (!projectOf(root)) await link(root, true)
        await this.relate(root, id)
      },
      async unrelate(root: string, relatedDir: string) {
        await keep(
          root,
          kept(root).filter((dir) => workspaceKey(dir) !== workspaceKey(relatedDir)),
        )
        const client = api()
        const id = projectOf(root)
        const other = projectOf(relatedDir)
        if (!client || !id || !other) return
        await client.unrelate(id, other)
        await loadRelated(id)
      },
      /** Pilot API as the signed-in person, or undefined while signed out. */
      api,
    }
  },
})
