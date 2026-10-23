/** Run commands a project's own files point to, for Edit project → Run → Suggest commands. */
export type RunCommands = { dev?: string; port?: number; build?: string; install?: string }

type Launch = { configurations?: { runtimeExecutable?: string; runtimeArgs?: string[]; port?: number }[] }
type Package = { scripts?: Record<string, string> }

/** The package manager's run prefix, from the lock file the project has. */
function runner(locks: string[]) {
  if (locks.some((file) => file.startsWith("bun.lock"))) return "bun run"
  if (locks.includes("pnpm-lock.yaml")) return "pnpm run"
  if (locks.includes("yarn.lock")) return "yarn"
  return "npm run"
}

const quote = (arg: string) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `"${arg.replaceAll('"', '\\"')}"`)

/** The port a dev script names, or the default of the tool it runs. */
function portOf(script: string) {
  const named = script.match(/(?:--port[ =]|-p |PORT=)(\d{2,5})/)
  if (named) return Number(named[1])
  if (/\bvite\b/.test(script)) return 5173
  if (/\bnext\b|\breact-scripts\b/.test(script)) return 3000
}

/**
 * Suggestions from `.claude/launch.json` (the dev server the project already runs for previews) and
 * `package.json` scripts. Install and reopen comes from an explicit script, or, for a Tauri desktop
 * app, SiCode's installer helper with the app the default Tauri build makes (edit it when the build
 * puts the app elsewhere).
 */
export function suggestRun(input: {
  launch?: string
  pkg?: string
  locks: string[]
  /** A Tauri desktop app's config and its folder, for Install and reopen through SiCode's installer helper. */
  tauri?: { config: string; dir: string }
}): RunCommands {
  const read = <T,>(text?: string) => {
    if (!text?.trim()) return
    try {
      return JSON.parse(text) as T
    } catch {
      return
    }
  }
  const launch = read<Launch>(input.launch)?.configurations?.find((item) => item.runtimeExecutable)
  const scripts = read<Package>(input.pkg)?.scripts ?? {}
  const run = runner(input.locks)
  const exe = launch?.runtimeExecutable?.split(/[\\/]/).pop()
  const dev = launch
    ? [exe, ...(launch.runtimeArgs ?? [])].filter((part): part is string => !!part).map(quote).join(" ")
    : scripts.dev
      ? `${run} dev`
      : scripts.start
        ? `${run} start`
        : undefined
  const install = ["install:app", "reinstall", "deploy:local"].find((name) => scripts[name])
  const product = read<{ productName?: string }>(input.tauri?.config)?.productName
  const bundle = product && input.tauri ? `${input.tauri.dir}/target/release/bundle/macos/${product}.app` : undefined
  return {
    dev,
    port: launch?.port ?? (scripts.dev ? portOf(scripts.dev) : scripts.start ? portOf(scripts.start) : undefined),
    build: scripts.build ? `${run} build` : undefined,
    install: install ? `${run} ${install}` : bundle ? `"$SICODE_REINSTALL" ${quote(bundle)}` : undefined,
  }
}
