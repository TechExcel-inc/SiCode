import type { Platform } from "@/context/platform"

type Http = typeof fetch

let platform: Platform | undefined

/** Call once from P1Provider so P1 API calls use Tauri-safe fetch on desktop. */
export function bind(next: Platform) {
  platform = next
}

export function client(): Http {
  if (platform?.platform === "desktop") {
    if (!platform.fetch) throw new Error("P1 requests require the desktop HTTP plugin")
    return platform.fetch
  }
  return platform?.fetch ?? globalThis.fetch.bind(globalThis)
}
