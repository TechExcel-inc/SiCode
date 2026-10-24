import { eadApi, eadServer } from "./urls"

/** Empty until Settings / auto-resolve fills a real path. */
export const DEFAULT_MCP_ENTRY = ""

// The EAD repo is checked out as "EAD_PFM-Editor" on some machines and "EAD_PFM Editor" on others.
const REPOS = ["EAD_PFM-Editor", "EAD_PFM Editor"]

export function mcpCandidates(worktree: string, preferred = "") {
  const root = worktree.replace(/\/+$/, "")
  const parts = root.split("/").filter(Boolean)
  const prefix = root.startsWith("/") ? "/" : ""
  const walked: string[] = []
  for (let i = parts.length; i >= 1; i--) {
    const base = prefix + parts.slice(0, i).join("/")
    walked.push(...REPOS.map((repo) => `${base}/${repo}/mcp-eadpfm/dist/index.js`))
    walked.push(`${base}/SiCode/packages/desktop/src-tauri/resources/mcp-eadpfm/dist/index.js`)
    walked.push(`${base}/KloudCode/packages/desktop/src-tauri/resources/mcp-eadpfm/dist/index.js`)
    walked.push(`${base}/packages/desktop/src-tauri/resources/mcp-eadpfm/dist/index.js`)
  }
  const list = [
    preferred.trim(),
    ...REPOS.flatMap((repo) => [
      `${root}/../${repo}/mcp-eadpfm/dist/index.js`,
      `${root}/../../${repo}/mcp-eadpfm/dist/index.js`,
    ]),
    // The open project is the EAD repo itself (the only spot the server lets the app confirm exists).
    `${root}/mcp-eadpfm/dist/index.js`,
    `${root}/../mcp-eadpfm/dist/index.js`,
    ...walked,
  ]
  const seen = new Set<string>()
  return list.filter((path) => {
    if (!path || seen.has(path)) return false
    seen.add(path)
    return true
  })
}

export function mcpConfig(token: string, entry: string, workspace = "") {
  const api = eadApi().replace(/\/api\/?$/i, "") || "https://eadfm.com"
  const env: Record<string, string> = {
    EADPFM_API_URL: api,
    EADPFM_API_TOKEN: token,
    EADPFM_TOKEN: token,
    EADPFM_SERVER_URL: eadServer(),
  }
  if (workspace.trim()) env.EADPFM_WORKSPACE = workspace.trim()
  return {
    type: "local" as const,
    enabled: true,
    command: ["node", entry],
    environment: env,
  }
}

/** MCP snippet for opencode.json — desktop will auto-patch via SDK mcp.add. */
export function mcpSnippet(token: string, entry = DEFAULT_MCP_ENTRY) {
  return {
    mcp: {
      eadpfm: mcpConfig(token, entry),
    },
  }
}
