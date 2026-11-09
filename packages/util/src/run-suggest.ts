/** Run commands a project's own files point to, for Edit project → Run → Suggest commands. */
export type RunCommands = { dev?: string; port?: number; build?: string; install?: string; deploy?: string }

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

/** A launch entry's script runs from its own path; a tool such as bun or npm runs by name, wherever it is installed. */
const script = (exe: string) => /[\\/]/.test(exe) && /\.(sh|bash|zsh|py|rb|js|mjs|cjs|ts|bat|cmd|ps1)$/i.test(exe)

const program = (exe: string) => (script(exe) ? exe : exe.split(/[\\/]/).pop())

/** A script in a temporary folder or one that is gone would break the saved command, so it is not suggested. */
function usable(exe: string, exists?: (path: string) => boolean) {
  if (!script(exe)) return true
  if (/^(\/private)?\/(tmp|var\/folders)\//.test(exe)) return false
  return exists?.(exe) ?? true
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
  /** Whether a script path still exists, where the caller can check. */
  exists?: (path: string) => boolean
}): RunCommands {
  const read = <T,>(text?: string) => {
    if (!text?.trim()) return
    try {
      return JSON.parse(text) as T
    } catch {
      return
    }
  }
  const first = read<Launch>(input.launch)?.configurations?.find((item) => item.runtimeExecutable)
  const launch = first?.runtimeExecutable && usable(first.runtimeExecutable, input.exists) ? first : undefined
  const scripts = read<Package>(input.pkg)?.scripts ?? {}
  const run = runner(input.locks)
  const exe = launch?.runtimeExecutable && program(launch.runtimeExecutable)
  const dev = launch
    ? [exe, ...(launch.runtimeArgs ?? [])].filter((part): part is string => !!part).map(quote).join(" ")
    : scripts.dev
      ? `${run} dev`
      : scripts.start
        ? `${run} start`
        : undefined
  const install = ["install:app", "reinstall", "deploy:local"].find((name) => scripts[name])
  const deploy = ["deploy", "deploy:prod", "deploy:production"].find((name) => scripts[name])
  const product = read<{ productName?: string }>(input.tauri?.config)?.productName
  const bundle = product && input.tauri ? `${input.tauri.dir}/target/release/bundle/macos/${product}.app` : undefined
  return {
    dev,
    port: launch?.port ?? (scripts.dev ? portOf(scripts.dev) : scripts.start ? portOf(scripts.start) : undefined),
    build: scripts.build ? `${run} build` : undefined,
    install: install ? `${run} ${install}` : bundle ? `"$SICODE_REINSTALL" ${quote(bundle)}` : undefined,
    deploy: deploy ? `${run} ${deploy}` : undefined,
  }
}

const LOCKS = ["bun.lock", "bun.lockb", "pnpm-lock.yaml", "yarn.lock"]
const TAURI = ["src-tauri", "packages/desktop/src-tauri"]

/** Suggestions for a project, reading its files with `read` (empty when a file is missing). */
export async function suggestFrom(read: (path: string) => Promise<string>, exists?: (path: string) => boolean) {
  const [launch, pkg, locks, configs] = await Promise.all([
    read(".claude/launch.json"),
    read("package.json"),
    Promise.all(LOCKS.map(read)),
    Promise.all(TAURI.map((dir) => read(`${dir}/tauri.conf.json`))),
  ])
  return suggestRun({
    launch,
    pkg,
    locks: LOCKS.filter((_, index) => !!locks[index]),
    tauri: configs.flatMap((config, index) => (config ? [{ config, dir: TAURI[index] }] : []))[0],
    exists,
  })
}
