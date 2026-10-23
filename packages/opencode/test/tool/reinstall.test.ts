import fs from "fs"
import path from "path"
import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Reinstall } from "../../src/tool/reinstall"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

// A stand-in desktop app: a bundle with a version and a main program, never a real app on this Mac.
function bundle(dir: string, version: string, program = "sleep 0") {
  fs.mkdirSync(path.join(dir, "Contents", "MacOS"), { recursive: true })
  fs.writeFileSync(
    path.join(dir, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Fake</string><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`,
  )
  fs.writeFileSync(path.join(dir, "Contents", "MacOS", "Fake"), `#!/bin/sh\n${program}\n`, { mode: 0o755 })
}

async function until<T>(read: () => T | undefined, ms = 30_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const value = read()
    if (value !== undefined) return value
    await Bun.sleep(200)
  }
  throw new Error("timed out")
}

describe.skipIf(process.platform !== "darwin")("installer helper", () => {
  test("waits for the running app to quit, swaps in the new build and leaves a note", async () => {
    await using tmp = await tmpdir()
    const apps = path.join(tmp.path, "Applications")
    const installed = path.join(apps, "Fake.app")
    const build = path.join(tmp.path, "dist", "Fake.app")
    // The installed app is running and quits by itself 3 seconds after it is asked.
    bundle(installed, "1.0", "sleep 3")
    bundle(build, "2.0")
    const running = Bun.spawn([path.join(installed, "Contents", "MacOS", "Fake")])
    const note = path.join(tmp.path, "note.json")
    const script = path.join(tmp.path, "reinstall.sh")
    fs.writeFileSync(script, Reinstall.SCRIPT, { mode: 0o755 })

    const run = Bun.spawnSync(["/bin/sh", script, build], {
      cwd: tmp.path,
      env: {
        ...process.env,
        SICODE_APPLICATIONS: apps,
        SICODE_NOTE: note,
        SICODE_SESSION: "ses_test",
        SICODE_DIRECTORY: "/project",
        SICODE_NO_OPEN: "1",
        SICODE_QUIT: "true",
      },
    })
    // It returns at once and finishes on its own.
    expect(run.exitCode).toBe(0)
    expect(run.stdout.toString()).toContain("reopens by itself")

    const written = await until(() => (fs.existsSync(note) ? fs.readFileSync(note, "utf8") : undefined))
    expect(JSON.parse(written)).toEqual({
      session: "ses_test",
      directory: "/project",
      app: "Fake",
      status: "done",
      version: "2.0",
      detail: "",
    })
    expect(running.killed || running.exitCode !== null).toBe(true)
    expect(fs.readFileSync(path.join(installed, "Contents", "Info.plist"), "utf8")).toContain("<string>2.0</string>")
    expect(fs.existsSync(`${installed}.previous`)).toBe(false)
  }, 40_000)

  test("says so when there is no build to install", async () => {
    await using tmp = await tmpdir()
    const script = path.join(tmp.path, "reinstall.sh")
    fs.writeFileSync(script, Reinstall.SCRIPT, { mode: 0o755 })
    const run = Bun.spawnSync(["/bin/sh", script, "dist/Missing.app"], { cwd: tmp.path })
    expect(run.exitCode).toBe(1)
    expect(run.stdout.toString()).toContain("Build it first")
  })
})

describe("after the restart", () => {
  test("the note goes to the session that asked, once, and only in its project", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        fs.mkdirSync(path.dirname(Reinstall.note()), { recursive: true })
        const write = (directory: string) =>
          fs.writeFileSync(
            Reinstall.note(),
            JSON.stringify({ session: session.id, directory, app: "EAD SiCode", status: "done", version: "1.4.90", detail: "" }),
          )

        write("/another/project")
        expect(Reinstall.take()).toBeUndefined()
        expect(fs.existsSync(Reinstall.note())).toBe(true)

        write(Instance.directory)
        await Reinstall.resume()
        expect(fs.existsSync(Reinstall.note())).toBe(false)
        const text = (await Session.messages({ sessionID: session.id }))
          .flatMap((msg) => msg.parts)
          .flatMap((part) => (part.type === "text" && part.metadata?.update ? [part.text] : []))
        expect(text).toEqual([
          "EAD SiCode was installed and reopened: it is now version 1.4.90. Continue the work that was waiting on this update, and tell the user it is done.",
        ])
      },
    })
  })
})
