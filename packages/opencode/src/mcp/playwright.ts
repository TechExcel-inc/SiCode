import { existsSync } from "fs"
import path from "path"
import { Global } from "@/global"

/** Pinned: this version's dependencies install, and it has been out long enough to trust. */
const VERSION = "0.0.82"

/** The browser already on the computer, so nothing large has to be downloaded. */
function browser() {
  if (process.platform === "win32") return "msedge"
  if (process.platform !== "darwin") return "chromium"
  if (existsSync("/Applications/Google Chrome.app")) return "chrome"
  if (existsSync("/Applications/Microsoft Edge.app")) return "msedge"
  return "chromium"
}

/**
 * The desktop app's default local browser for the AI, run by SiCode's own bundled runtime so the user
 * needs no Node. It works unseen, in a throwaway profile, and may only request local addresses.
 */
export function playwright() {
  return {
    type: "local" as const,
    command: [
      process.execPath,
      "x",
      `@playwright/mcp@${VERSION}`,
      "--browser",
      browser(),
      "--headless",
      "--isolated",
      "--allowed-origins",
      "http://localhost:*;http://127.0.0.1:*",
      "--output-dir",
      path.join(Global.Path.data, "playwright"),
      // Snapshot and console links in results are files here; relative ones would point from the server's folder.
      "--file-paths",
      "absolute",
    ],
    environment: { BUN_BE_BUN: "1" },
    // The first start downloads the package.
    timeout: 120_000,
  }
}
