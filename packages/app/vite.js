import { execSync } from "node:child_process"
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "url"

const theme = fileURLToPath(new URL("./public/oc-theme-preload.js", import.meta.url))

// Vditor loads its engine, icons, languages and diagram renderers at runtime from `${cdn}/dist/...`.
// They are served from the app itself at /vditor so the editor works offline.
const vditor = path.dirname(createRequire(import.meta.url).resolve("vditor/package.json"))
const types = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".gif": "image/gif",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
}
// MathJax is unused (math renders with KaTeX); source maps are not needed at runtime.
const skip = (file) => file.endsWith(".map") || file.includes(`${path.sep}mathjax${path.sep}`)
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return walk(full)
    return skip(full) ? [] : [full]
  })

/** Build number shown in About: KLOUD_BUILD when set, otherwise the git commit being built. */
const build = (() => {
  if (process.env.KLOUD_BUILD) return process.env.KLOUD_BUILD
  try {
    return execSync("git rev-parse --short=8 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()
  } catch {
    return "dev"
  }
})()

/**
 * @type {import("vite").PluginOption}
 */
export default [
  {
    name: "opencode-desktop:config",
    config() {
      return {
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
          },
        },
        worker: {
          format: "es",
        },
        define: {
          "import.meta.env.VITE_KLOUD_BUILD": JSON.stringify(build),
        },
      }
    },
  },
  {
    name: "opencode-desktop:theme-preload",
    transformIndexHtml(html) {
      return html.replace(
        '<script id="oc-theme-preload-script" src="/oc-theme-preload.js"></script>',
        `<script id="oc-theme-preload-script">${readFileSync(theme, "utf8")}</script>`,
      )
    },
  },
  {
    name: "sicode:vditor",
    configureServer(server) {
      server.middlewares.use("/vditor", (req, res, next) => {
        const file = path.join(vditor, decodeURIComponent((req.url ?? "").split("?")[0]))
        if (!file.startsWith(path.join(vditor, "dist") + path.sep) || !existsSync(file) || skip(file)) return next()
        res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream")
        createReadStream(file).pipe(res)
      })
    },
    generateBundle() {
      ;["js", "css", "images"]
        .flatMap((dir) => walk(path.join(vditor, "dist", dir)))
        .concat(path.join(vditor, "dist", "index.css"))
        .forEach((file) =>
          this.emitFile({
            type: "asset",
            fileName: path.join("vditor", path.relative(vditor, file)).split(path.sep).join("/"),
            source: readFileSync(file),
          }),
        )
    },
  },
  tailwindcss(),
  solidPlugin(),
]
