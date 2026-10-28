import { describe, expect, test } from "bun:test"
import { suggestRun } from "./run-suggest"

describe("suggestRun", () => {
  test("uses the dev server the project already runs for previews", () => {
    const launch = JSON.stringify({
      configurations: [
        { name: "web", runtimeExecutable: "/Users/me/.bun/bin/bun", runtimeArgs: ["--cwd", "packages/app", "dev", "--port", "3000"], port: 3000 },
      ],
    })
    const pkg = JSON.stringify({ scripts: { dev: "bun run src/index.ts", build: "bun run script/build.ts" } })
    expect(suggestRun({ launch, pkg, locks: ["bun.lock"] })).toEqual({
      dev: "bun --cwd packages/app dev --port 3000",
      port: 3000,
      build: "bun run build",
      install: undefined,
    })
  })

  test("falls back to package scripts with the project's package manager and the tool's port", () => {
    const pkg = JSON.stringify({ scripts: { dev: "vite", build: "vite build", "install:app": "sh install.sh" } })
    expect(suggestRun({ pkg, locks: ["pnpm-lock.yaml"] })).toEqual({
      dev: "pnpm run dev",
      port: 5173,
      build: "pnpm run build",
      install: "pnpm run install:app",
    })
    expect(suggestRun({ pkg: JSON.stringify({ scripts: { start: "next dev -p 4000" } }), locks: [] })).toEqual({
      dev: "npm run start",
      port: 4000,
      build: undefined,
      install: undefined,
    })
  })

  test("a deploy script becomes the Deploy command", () => {
    const pkg = JSON.stringify({ scripts: { build: "next build", deploy: "bash scripts/deploy-meet.sh" } })
    expect(suggestRun({ pkg, locks: ["package-lock.json"] }).deploy).toBe("npm run deploy")
    expect(suggestRun({ pkg: JSON.stringify({ scripts: { build: "next build" } }), locks: [] }).deploy).toBeUndefined()
  })

  test("suggests nothing for a folder without these files or with broken ones", () => {
    expect(suggestRun({ locks: [] })).toEqual({ dev: undefined, port: undefined, build: undefined, install: undefined })
    expect(suggestRun({ pkg: "{ not json", locks: [] }).dev).toBeUndefined()
  })

  test("a Tauri desktop app installs through SiCode's installer helper", () => {
    const tauri = { config: JSON.stringify({ productName: "Kloud Meet" }), dir: "src-tauri" }
    expect(suggestRun({ locks: [], tauri }).install).toBe('"$SICODE_REINSTALL" "src-tauri/target/release/bundle/macos/Kloud Meet.app"')
  })
})
