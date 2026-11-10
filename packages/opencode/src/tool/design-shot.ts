import { existsSync } from "fs"
import fs from "fs/promises"
import os from "os"
import path from "path"
import z from "zod"
import { Effect } from "effect"
import { Instance } from "../project/instance"
import { Tool } from "./tool"
import DESCRIPTION from "./design-shot.txt"

const parameters = z.object({
  path: z.string().describe("The screen to look at, such as design/Requirements.design/List.html"),
  width: z.number().int().min(240).max(3840).optional().describe("Draw it at this window width only"),
})

type Shot = { size: { w: number; h: number }; png: Uint8Array }

/** What the Design tab allows a screen: its own inline styles and scripts, and images and fonts from its folder. */
const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:"

/** A screen of a UI design (`design/.../<Name>.design/<Screen>.html`), with forward slashes, or undefined. */
export function screen(file: string) {
  const norm = path.posix.normalize(file.replaceAll("\\", "/"))
  if (!/^design\/(?:[^/]+\/)*[^/]+\.design\/[^/]+\.html$/.test(norm)) return
  return norm
}

/** The window sizes to draw a screen at: its frame, and a phone for a web page that fills the window. */
export function sizes(frame: { w?: number; h?: number; fluid?: boolean } | undefined, width?: number) {
  const w = typeof frame?.w === "number" && frame.w > 0 ? Math.round(frame.w) : 1440
  const h = typeof frame?.h === "number" && frame.h > 0 ? Math.round(frame.h) : 980
  if (width) return [{ w: width, h }]
  return [{ w, h }, ...(frame?.fluid && w > 480 ? [{ w: 390, h: 844 }] : [])]
}

/** Chrome or Edge already on the computer, so nothing has to be downloaded. */
function browser() {
  if (process.platform === "win32")
    return [process.env["ProgramFiles(x86)"], process.env["ProgramFiles"], process.env["LOCALAPPDATA"]]
      .filter((dir): dir is string => !!dir)
      .flatMap((dir) => [
        path.join(dir, "Microsoft", "Edge", "Application", "msedge.exe"),
        path.join(dir, "Google", "Chrome", "Application", "chrome.exe"),
      ])
      .find((file) => existsSync(file))
  if (process.platform === "darwin")
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ].find((file) => existsSync(file))
  return ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"]
    .map((name) => Bun.which(name))
    .find((file) => !!file)
}

/** Draws one page into a PNG with the browser's own headless screenshot; nothing but the local server is reachable. */
async function shoot(exe: string, url: string, size: { w: number; h: number }, dir: string) {
  const out = path.join(dir, `${size.w}x${size.h}.png`)
  const proc = Bun.spawn(
    [
      exe,
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-sync",
      "--mute-audio",
      "--force-device-scale-factor=1",
      `--user-data-dir=${path.join(dir, "profile")}`,
      // Every request that is not to the local server goes to a closed port, so the page loads nothing from the network.
      "--proxy-server=http://127.0.0.1:9",
      `--window-size=${size.w},${size.h}`,
      "--virtual-time-budget=3000",
      `--screenshot=${out}`,
      url,
    ],
    { stdout: "ignore", stderr: "ignore", timeout: 15_000 },
  )
  await proc.exited
  const file = Bun.file(out)
  if (!(await file.exists())) return
  return new Uint8Array(await file.arrayBuffer())
}

export const DesignShotTool = Tool.define(
  "design_shot",
  Effect.succeed({
    description: DESCRIPTION,
    parameters,
    execute: (params: z.infer<typeof parameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        const file = screen(params.path)
        const full = file ? path.join(Instance.directory, file) : ""
        if (!file || !Instance.containsPath(full))
          throw new Error(`${params.path} is not a screen of a design: use design/<Name>.design/<Screen>.html`)
        if (!existsSync(full)) throw new Error(`${file} does not exist yet; write it first`)
        const name = path.basename(full)
        const skipped = (reason: string) => ({
          title: `Look at ${name}`,
          metadata: {},
          output: `The visual check was skipped: ${reason}. Carry on without it.`,
        })
        const exe = browser()
        if (!exe) return skipped("no Chrome or Edge was found on this computer")
        yield* ctx.metadata({ title: `Looking at ${name}` })
        const root = path.dirname(full)
        const canvas = yield* Effect.promise(() =>
          Bun.file(path.join(root, "canvas.json"))
            .json()
            .catch(() => undefined),
        )
        const list = sizes(canvas?.screens?.[name], params.width)
        const drawn = yield* Effect.acquireUseRelease(
          Effect.promise(async () => ({
            dir: await fs.mkdtemp(path.join(os.tmpdir(), "sicode-shot-")),
            server: Bun.serve({
              hostname: "127.0.0.1",
              port: 0,
              async fetch(req) {
                const target = path.join(root, decodeURIComponent(new URL(req.url).pathname))
                const body = Bun.file(target)
                if (!target.startsWith(root + path.sep) || !(await body.exists()))
                  return new Response(null, { status: 404 })
                return new Response(body, { headers: { "content-security-policy": CSP } })
              },
            }),
          })),
          (res) =>
            Effect.promise(async () => {
              const url = `http://127.0.0.1:${res.server.port}/${encodeURIComponent(name)}`
              const out: Shot[] = []
              for (const size of list) {
                const png = await shoot(exe, url, size, res.dir)
                if (png) out.push({ size, png })
              }
              return out
            }),
          (res) =>
            Effect.promise(async () => {
              res.server.stop(true)
              await fs.rm(res.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})
            }),
        ).pipe(
          Effect.timeoutOrElse({ duration: "30 seconds", orElse: () => Effect.succeed<Shot[]>([]) }),
          Effect.catchCause(() => Effect.succeed<Shot[]>([])),
        )
        if (drawn.length === 0) return skipped("the browser could not draw the page")
        return {
          title: `Look at ${name}`,
          metadata: {},
          output: [
            `${file} drawn at ${drawn.map((shot) => `${shot.size.w}x${shot.size.h}`).join(" and ")} px (pictures attached, in that order).`,
            "Fix overlaps, clipped text, poor contrast, uneven spacing and anything that breaks at phone width; at most two rounds of fixes per screen.",
          ].join("\n"),
          attachments: drawn.map((shot) => ({
            type: "file" as const,
            mime: "image/png",
            filename: `${name.replace(/\.html$/, "")}-${shot.size.w}.png`,
            url: `data:image/png;base64,${Buffer.from(shot.png).toString("base64")}`,
          })),
        }
      }),
  }),
)
