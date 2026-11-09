import { describe, expect, test } from "bun:test"
import {
  buildPilotShellUrl,
  buildPilotUrl,
  flagsFromAction,
  handlePluginMessage,
  hostClipboardCommand,
  openCrawlVision,
  openFindWizard,
  openHelpTip,
  openSetupMap,
  openProfile,
  postFindApplied,
  selectPfmSubSchema,
  updatePfmSelection,
} from "./bridge"
import { expandKey } from "./settings"
import { modelUsage } from "./cowork"
import { buildModal, formatModal, kindLabel } from "./context-modal"
import { clearPfmFilter, ownerSummary, readOwner, readPfmFilter, writeOwner, writePfmFilter } from "./filters"
import { formatJobCounts } from "./jobs"
import {
  buildTree,
  collectIds,
  filterByCount,
  filterByIds,
  filterDisplay,
  filterLinked,
  filterLinkedTree,
  filterPfm,
  filterSource,
  filteredCounts,
  hits,
  parseRows,
  pathIds,
  pathMatches,
  pathTrail,
  rollupCounts,
  tops,
  cue,
  underFolder,
} from "./source-tree"
import { collectProducts, collectGroups, productRole, formatSystemPrompt, authKind, parseFilterIds, parseOpenIds, parseFiles, loadActiveMap, loadPlans, planLabel, planName, renew, login } from "./api"
import { apply, drop, gateway, match, PLAN, spec } from "./plan"
import { queuePilot, takePilot, peekPilot, watchPilot } from "./actions"
import { t } from "./i18n"
import { beginDiag, formatDiag, noteDiag, readStartup } from "./diag"
import { applyEnv, eadApi, eadEnv, eadOrigin, eadServer, EAD_CURSOR_EXTENSION_VERSION, frameOrigin, isEadHost, isProxy, proxyOrigin, rewrite } from "./urls"
import { cowork, CoworkFail, githubRepo, usage } from "./cowork"
import { offline } from "./http"
import { looksLikeProviderApiKey, RENEW, renewDue, tokenExpired, tokenExpiry, tokenUser } from "./auth"
import { mcpCandidates } from "./mcp"
import { prober, resolveMcpEntry } from "./ensure-mcp"
import { enforce, VIRTUAL_MOVED, parseJson, configured } from "./top-level"
import { matches, parseBody, parseCue, parseStep, progress, result, PROGRESS, RESULT, SIGNAL, watch } from "./step-signal"
import { lined, precheck } from "./precheck"
import { sendChat } from "./composer"

describe("ead urls", () => {
  test("tracks cursor extension version", () => {
    expect(EAD_CURSOR_EXTENSION_VERSION).toBe("1.0.279")
  })

  test("rewrite puts the plugin path on the loopback proxy origin", () => {
    expect(rewrite("https://eadfm.com/plugin/ai-code?mode=cursor", "http://127.0.0.1:5190")).toBe(
      "http://127.0.0.1:5190/plugin/ai-code?mode=cursor",
    )
  })

  test("isEadHost accepts plugin proxy origins", () => {
    expect(isProxy("http://127.0.0.1:5190")).toBe(true)
    expect(isEadHost("http://127.0.0.1:5190")).toBe(true)
    expect(isEadHost("http://127.0.0.1:5180")).toBe(true)
    expect(isEadHost("http://127.0.0.1:8088")).toBe(false)
  })

  test("frameOrigin follows the iframe src", () => {
    applyEnv("production")
    expect(frameOrigin({ src: "http://127.0.0.1:5190/plugin/ai-code" })).toBe("http://127.0.0.1:5190")
    expect(frameOrigin({ src: "" })).toBe("https://eadfm.com")
  })

  test("proxyOrigin falls back when the host cannot serve a proxy", async () => {
    expect(await proxyOrigin("", "https://eadfm.com")).toBe("https://eadfm.com")
    expect(await proxyOrigin("http://127.0.0.1:1", "https://eadfm.com")).toBe("https://eadfm.com")
  })
})

describe("ead top-level", () => {
  const json = JSON.stringify([
    { name: "PPM Project Base", nodeId: 221, clientId: "dyn", isDynamic: true, sortOrder: 0 },
    { name: "User Manager", nodeId: 1143, clientId: "tl-um", isDynamic: false, sortOrder: 1 },
    { name: "System Settings", nodeId: 223, clientId: "tl-ss", isDynamic: false, sortOrder: 2 },
  ])

  test("orders configured tops and buckets extras", () => {
    const cfgs = parseJson(json, "PPM Project Base")
    expect(configured(cfgs)).toBe(true)
    expect(cfgs.map((n) => n.name)).toEqual(["PPM Project Base", "User Manager", "System Settings"])
    const next = enforce(
      [
        { nodeId: 221, nodeName: "PPM Project Base", children: [] },
        { nodeId: 1143, nodeName: "User Manager", children: [] },
        { nodeId: 223, nodeName: "System Settings", children: [{ nodeId: 1, nodeName: "Site Info" }] },
        { nodeId: 1546, nodeName: "Product Features", children: [] },
        { nodeId: 1547, nodeName: "Views", children: [] },
        { nodeId: 1543, nodeName: "To be moved", children: [{ nodeId: 99, nodeName: "Status Group" }] },
      ],
      {
        supportSubSchemas: true,
        topLevelNodesJson: json,
        dynamicTopLevelDisplayName: "PPM Project Base",
        dynamicTopLevelNodeId: 221,
      },
    )
    expect(next.map((n) => n.nodeName)).toEqual(["PPM Project Base", "User Manager", "System Settings", "To be moved"])
    expect(Number(next[3]?.nodeId)).toBe(1543)
    const names = (next[3]?.children || []).map((c) => c.nodeName)
    expect(names).toEqual(expect.arrayContaining(["Product Features", "Views", "Status Group"]))
    expect(names).not.toContain("System Settings")
  })

  test("uses virtual To be moved when no bucket exists", () => {
    const next = enforce(
      [
        { nodeId: 221, nodeName: "PPM Project Base", children: [] },
        { nodeId: 1143, nodeName: "User Manager", children: [] },
        { nodeId: 999, nodeName: "Orphan Module", children: [] },
      ],
      {
        supportSubSchemas: true,
        topLevelNodesJson: json,
        dynamicTopLevelDisplayName: "PPM Project Base",
      },
    )
    expect(Number(next[next.length - 1]?.nodeId)).toBe(VIRTUAL_MOVED)
  })

  test("prefers API dynId over stale placeholder", () => {
    const json = JSON.stringify([
      { name: "PPM Project Base", nodeId: 2030, clientId: "dyn", isDynamic: true, sortOrder: 0 },
      { name: "User Manager", nodeId: 1143, clientId: "tl-um", isDynamic: false, sortOrder: 1 },
    ])
    const next = enforce(
      [
        {
          nodeId: 2030,
          nodeName: "PPM Project Base",
          children: [{ nodeId: 1207, nodeName: "Time Settings" }],
        },
        {
          nodeId: 2220,
          nodeName: "Requirement Project Base",
          isDynamicTopLevel: true,
          isDynamicPfmSchema: true,
          children: [{ nodeId: 2221, nodeName: "General" }],
        },
        { nodeId: 1143, nodeName: "User Manager", children: [] },
      ],
      {
        supportSubSchemas: true,
        topLevelNodesJson: json,
        dynamicTopLevelDisplayName: "Requirement Project Base",
        dynamicTopLevelNodeId: 2220,
      },
    )
    expect(Number(next[0]?.nodeId)).toBe(2220)
    const names = (next[0]?.children || []).map((c) => c.nodeName)
    expect(names).toContain("General")
    expect(names).not.toContain("Time Settings")
  })
})

describe("ead auth", () => {
  test("tokenExpired reads jwt exp", () => {
    const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }))
    const past = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 60 }))
    expect(tokenExpired(`${header}.${past}.`)).toBe(true)
    const future = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))
    expect(tokenExpired(`${header}.${future}.`)).toBe(false)
  })

  test("tokenUser reads the Pilot user id", () => {
    const header = btoa(JSON.stringify({ alg: "none" }))
    expect(tokenUser(`${header}.${btoa(JSON.stringify({ sub: "42", username: "tierenz" }))}.`)).toBe("42")
    expect(tokenUser(`${header}.${btoa(JSON.stringify({ sub: 7 }))}.`)).toBe("7")
    expect(tokenUser(`${header}.${btoa(JSON.stringify({ exp: 1 }))}.`)).toBe("")
    expect(tokenUser("")).toBe("")
  })

  test("renewDue renews shortly before expiry and after it", () => {
    const now = Date.now()
    const jwt = (exp: number) =>
      `${btoa(JSON.stringify({ alg: "none" }))}.${btoa(JSON.stringify({ exp: Math.floor(exp / 1000) }))}.`
    expect(tokenExpiry(jwt(now))).toBe(Math.floor(now / 1000) * 1000)
    expect(tokenExpiry("opaque")).toBeUndefined()
    expect(renewDue(jwt(now + 24 * 3600 * 1000), now)).toBe(false)
    expect(renewDue(jwt(now + RENEW - 60_000), now)).toBe(true)
    expect(renewDue(jwt(now - 3 * 24 * 3600 * 1000), now)).toBe(true)
    expect(tokenExpired(jwt(now - 60_000), now)).toBe(true)
    expect(renewDue("opaque", now)).toBe(false)
  })

  test("renew posts the old token and returns the new one", async () => {
    applyEnv("production")
    const seen: { url: string; method?: string; auth?: string; client?: string }[] = []
    const ok = (async (url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined
      seen.push({ url, method: init?.method, auth: headers?.Authorization, client: headers?.["X-EAD-Client"] })
      return new Response(JSON.stringify({ success: true, token: "fresh", user: { username: "u" } }))
    }) as typeof fetch
    expect(await renew("stale", ok)).toBe("fresh")
    // X-EAD-Client: EAD Pilot joins SiCode sign-ins to Kloud's SiCode subsystem
    expect(seen).toEqual([
      { url: `${eadApi()}/auth/session/renew`, method: "POST", auth: "Bearer stale", client: "sicode" },
    ])
  })

  test("login says it comes from SiCode", async () => {
    applyEnv("production")
    let client: string | undefined
    const ok = (async (_url: string, init?: RequestInit) => {
      client = (init?.headers as Record<string, string> | undefined)?.["X-EAD-Client"]
      return new Response(JSON.stringify({ success: true, token: "t" }))
    }) as typeof fetch
    expect(await login("pat@example.com", "pw", ok)).toBe("t")
    expect(client).toBe("sicode")
  })

  test("renew fails when Pilot refuses the login", async () => {
    const refused = (async () =>
      new Response(JSON.stringify({ success: false, message: "Session cannot be renewed" }), {
        status: 401,
      })) as unknown as typeof fetch
    await expect(renew("stale", refused)).rejects.toThrow("Session cannot be renewed")
    const offline = (async () => {
      throw new Error("offline")
    }) as unknown as typeof fetch
    await expect(renew("stale", offline)).rejects.toThrow("offline")
  })

  test("looksLikeProviderApiKey rejects sk- keys as passwords", () => {
    expect(looksLikeProviderApiKey("sk-9738d5c0f2de40a3a15adbf5e0d")).toBe(true)
    expect(looksLikeProviderApiKey("  SK-abc  ")).toBe(true)
    expect(looksLikeProviderApiKey("secret")).toBe(false)
    expect(looksLikeProviderApiKey("")).toBe(false)
  })
})

describe("ead source-tree", () => {
  test("parseRows + buildTree + hide index", () => {
    const rows = parseRows([
      { nodeId: 1, nodePath: "src", nodeName: "src", nodeType: "FOLDER", parentNodeId: null },
      { nodeId: 2, nodePath: "src/index.tsx", nodeName: "index.tsx", nodeType: "FILE", parentNodeId: 1 },
      { nodeId: 3, nodePath: "src/app.tsx", nodeName: "app.tsx", nodeType: "FILE", parentNodeId: 1 },
    ])
    expect(filterDisplay(rows).map((r) => r.nodeId)).toEqual([1, 3])
    const tree = buildTree(filterDisplay(rows))
    expect(tree).toHaveLength(1)
    expect(tree[0]!.children.map((c) => c.nodeName)).toEqual(["app.tsx"])
  })

  test("filterByCount keeps pending ancestors", () => {
    const tree = buildTree(
      parseRows([
        { nodeId: 1, nodePath: "a", nodeName: "a", nodeType: "FOLDER" },
        { nodeId: 2, nodePath: "a/b.ts", nodeName: "b.ts", nodeType: "FILE", parentNodeId: 1 },
      ]),
    )
    const only = filterByCount(tree, {}, { "a/b.ts": true }, true)
    expect(only[0]?.nodeId).toBe(1)
    expect(only[0]?.children[0]?.nodeId).toBe(2)
  })

  test("filterByIds and search", () => {
    const nodes = [
      { nodeId: 1, name: "Root", children: [{ nodeId: 2, name: "Child", children: [] }] },
    ]
    expect(filterByIds(nodes, new Set([2]))[0]?.children).toHaveLength(1)
    expect(filterPfm(nodes, "child")[0]?.children[0]?.name).toBe("Child")
    const source = buildTree(parseRows([{ nodeId: 9, nodePath: "x/y.ts", nodeName: "y.ts", nodeType: "FILE" }]))
    expect(filterSource(source, "y.ts")).toHaveLength(1)
  })

  test("tops skips map root when it has children", () => {
    const root = {
      nodeId: 1,
      name: "SW Admin PFM Map",
      children: [
        { nodeId: 2, name: "Team Portal", children: [] },
        { nodeId: 3, name: "User Manager", children: [] },
      ],
    }
    expect(tops(root).map((n) => n.name)).toEqual(["Team Portal", "User Manager"])
    expect(tops({ nodeId: 9, name: "Lone", children: [] }).map((n) => n.name)).toEqual(["Lone"])
    expect(tops(undefined)).toEqual([])
  })

  test("cue is stable for the same tree and changes on rename", () => {
    const base = {
      pid: 2,
      schema: 1,
      view: "pfm",
      map: "SW Admin PFM Map",
      sibling: false,
      support: true,
      sub: 0,
      types: [] as Array<{ id: number; name: string }>,
      filter: [] as number[],
      paths: [] as string[],
      eadsOnly: true,
      nodes: [{ nodeId: 2, name: "Team Portal", children: [] }],
      files: [] as Array<{ nodeId: number; nodePath: string; children: never[] }>,
      products: [{ productId: 2, baseId: undefined as number | undefined, siblings: false }],
    }
    expect(cue(base)).toBe(cue({ ...base }))
    expect(cue(base)).not.toBe(cue({ ...base, nodes: [{ nodeId: 2, name: "Renamed", children: [] }] }))
  })

  test("rollupCounts + pathIds + collectIds", () => {
    const nodes = [
      {
        nodeId: 1,
        name: "Root",
        children: [
          { nodeId: 2, name: "A", children: [{ nodeId: 4, name: "A1", children: [] }] },
          { nodeId: 3, name: "B", children: [] },
        ],
      },
    ]
    expect(collectIds(nodes).sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
    const rolled = rollupCounts(nodes, { "4": 2, "3": 1 })
    expect(rolled["4"]).toBe(2)
    expect(rolled["2"]).toBe(2)
    expect(rolled["1"]).toBe(3)
    expect(rolled["3"]).toBe(1)
    expect(pathIds(nodes, 4)).toEqual([1, 2])
    expect(pathIds(nodes, 99)).toEqual([])
  })

  test("pathTrail returns ancestor source paths", () => {
    const nodes = buildTree([
      { nodeId: 1, nodeName: "a", nodePath: "a", parentNodeId: null },
      { nodeId: 2, nodeName: "b", nodePath: "a/b", parentNodeId: 1 },
      { nodeId: 3, nodeName: "c", nodePath: "a/b/c", parentNodeId: 2 },
    ])
    expect(pathTrail(nodes, 3)).toEqual(["a", "a/b"])
    expect(pathTrail(nodes, 1)).toEqual([])
    expect(pathTrail(nodes, 99)).toEqual([])
  })

  test("expandKey matches product:map:subSchema", () => {
    expect(expandKey(2, 10, 3)).toBe("2:10:3")
    expect(expandKey(2, 0, 0)).toBe("2:0:0")
  })

  test("filterLinked keeps ancestors of matched files", () => {
    const rows = parseRows([
      { nodeId: 1, nodePath: "src", nodeName: "src", nodeType: "FOLDER" },
      { nodeId: 2, nodePath: "src/auth/login.ts", nodeName: "login.ts", nodeType: "FILE", parentNodeId: 1 },
      { nodeId: 3, nodePath: "src/other.ts", nodeName: "other.ts", nodeType: "FILE", parentNodeId: 1 },
    ])
    expect(pathMatches("src/auth/login.ts", ["src/auth/login.ts"])).toBe(true)
    const kept = filterLinked(rows, ["src/auth/login.ts"])
    expect(kept.map((r) => r.nodeId).sort((a, b) => a - b)).toEqual([1, 2])
    const tree = filterLinkedTree(buildTree(rows), ["src/auth/login.ts"])
    expect(tree[0]?.children.map((c) => c.nodeName)).toEqual(["login.ts"])
    expect(filterLinked(rows, [])).toEqual([])
  })

  test("filteredCounts remaps PFM eads onto linked source paths", () => {
    expect(hits("src/auth/login.ts", "src/auth/login.ts")).toBe(true)
    expect(underFolder("src/auth/login.ts", "src/auth")).toBe(true)
    const counts = filteredCounts(
      ["src/auth", "src/auth/login.ts", "src/other.ts"],
      [{ nodeId: 128, paths: ["src/auth/login.ts"] }],
      { 128: 3 },
    )
    expect(counts["src/auth/login.ts"]).toBe(3)
    expect(counts["src/auth"]).toBe(3)
    expect(counts["src/other.ts"]).toBeUndefined()
  })

  test("underFolder allows Legacy ASP.NET / VB source paths", () => {
    expect(underFolder("Web/Login.aspx", "Web")).toBe(true)
    expect(underFolder("App_Code/Helper.vb", "App_Code")).toBe(true)
    expect(underFolder("ServiceWise.csproj", "")).toBe(false)
    expect(underFolder("notes.txt", "docs")).toBe(false)
  })
})

describe("ead bridge", () => {
  test("buildPilotUrl defaults to opencode", () => {
    const url = new URL(
      buildPilotUrl({
        productId: 2,
        productName: "SW Admin",
        nodeId: 128,
        nodeName: "Login",
        openAiPilot: true,
        language: "zh",
        mode: "opencode",
        bust: 3,
      }),
    )
    expect(url.searchParams.get("mode")).toBe("opencode")
    expect(url.searchParams.get("productId")).toBe("2")
    expect(url.searchParams.get("pfmNodeId")).toBe("128")
    expect(url.searchParams.get("openAiPilot")).toBe("1")
    expect(url.searchParams.get("lang")).toBe("zh")
    expect(url.searchParams.get("_cb")).toBe("3")
  })

  test("buildPilotShellUrl is product-scoped shell", () => {
    const url = new URL(
      buildPilotShellUrl({
        productId: 2,
        productName: "SW Admin",
        subSchemaId: 7,
        language: "zh",
        mode: "cursor",
        bust: 3,
      }),
    )
    expect(url.searchParams.get("mode")).toBe("cursor")
    expect(url.searchParams.get("productId")).toBe("2")
    expect(url.searchParams.get("subSchemaId")).toBe("7")
    expect(url.searchParams.get("pfmNodeId")).toBeNull()
    expect(url.searchParams.get("openAiPilot")).toBeNull()
    expect(url.searchParams.get("_cb")).toBe("3")
  })

  test("buildPilotUrl includes subSchemaId", () => {
    const url = new URL(
      buildPilotUrl({
        productId: 2,
        subSchemaId: 7,
        mode: "opencode",
      }),
    )
    expect(url.searchParams.get("subSchemaId")).toBe("7")
  })

  test("buildPilotUrl includes openMyProfile", () => {
    const url = new URL(buildPilotUrl({ openMyProfile: true, mode: "cursor" }))
    expect(url.searchParams.get("openMyProfile")).toBe("1")
    expect(url.searchParams.get("openAiPilot")).toBeNull()
  })

  test("source selection prefers sourceCodeNodeId", () => {
    const url = new URL(
      buildPilotUrl({
        sourceId: 99,
        sourceName: "file.ts",
        sourcePath: "src/file.ts",
        nodeId: 1,
        mode: "opencode",
      }),
    )
    expect(url.searchParams.get("sourceCodeNodeId")).toBe("99")
    expect(url.searchParams.get("pfmNodeId")).toBeNull()
    expect(url.searchParams.get("sourceCodeNodePath")).toBe("src/file.ts")
  })

  test("flagsFromAction", () => {
    expect(flagsFromAction({ kind: "find" }).openAiFind).toBe(true)
    expect(flagsFromAction({ kind: "setup" }).openSetupEadMap).toBe(true)
    expect(flagsFromAction({ kind: "setupSource" }).openSetup).toBe(true)
    expect(flagsFromAction({ kind: "mindmap" }).openPfmFilter).toBe(true)
    expect(flagsFromAction({ kind: "dashboard" }).openAiPilot).toBe(true)
    expect(flagsFromAction({ kind: "profile" }).openMyProfile).toBe(true)
    expect(flagsFromAction(undefined).openAiPilot).toBe(true)
  })

  test("handlePluginMessage auth + find + jobs hooks", () => {
    const calls: string[] = []
    let token = ""
    handlePluginMessage({ type: "pluginHeartbeat" }, { setToken: () => {}, noteHeartbeat: () => calls.push("beat") })
    handlePluginMessage(
      { type: "openAiFindWizard", sourceCodeNodeId: 5, sourceCodeNodeName: "x" },
      {
        setToken: () => {},
        queueFind: (opts) => calls.push(`find:${opts?.sourceId}`),
      },
    )
    handlePluginMessage(
      { type: "injectAiCodingJobs", playbook: "hi", requestId: "r1" },
      {
        setToken: () => {},
        codingJobs: (msg) => calls.push(`jobs:${msg.requestId}`),
      },
    )
    handlePluginMessage(
      { type: "injectImproveTestCases", playbook: "pfmNodeId: 9", requestId: "r2" },
      {
        setToken: () => {},
        improveTests: (msg) => calls.push(`improve:${msg.playbook}`),
      },
    )
    handlePluginMessage(
      { type: "pluginSessionSync", token: "stale", productId: 2, productName: "SW" },
      {
        setToken: (t) => {
          token = t
        },
        setProduct: (id, name) => calls.push(`product:${id}:${name}`),
      },
    )
    handlePluginMessage(
      { type: "eadPfmPersistAuthToken", token: "fresh", productId: 9, productName: "X" },
      {
        setToken: (t) => {
          token = t
        },
        setProduct: (id, name) => calls.push(`product:${id}:${name}`),
      },
    )
    expect(calls).toEqual(["beat", "find:5", "jobs:r1", "improve:pfmNodeId: 9"])
    expect(token).toBe("fresh")
  })

  test("hostBridgeReady invokes bridgeReady", () => {
    const calls: string[] = []
    handlePluginMessage(
      { type: "hostBridgeReady" },
      {
        setToken: () => {},
        noteHeartbeat: () => calls.push("beat"),
        bridgeReady: () => calls.push("ready"),
      },
    )
    expect(calls).toEqual(["beat", "ready"])
  })

  test("requestAuthToken syncs host token", () => {
    const calls: string[] = []
    handlePluginMessage(
      { type: "requestAuthToken" },
      {
        setToken: () => {},
        syncAuth: () => calls.push("sync"),
      },
    )
    handlePluginMessage({ type: "closeMyProfile" }, { setToken: () => {} })
    expect(calls).toEqual(["sync"])
  })

  test("map visibility and explore inject ack", () => {
    const calls: string[] = []
    handlePluginMessage(
      { type: "requestEadMapSidebarVisibility" },
      {
        setToken: () => {},
        mapVisible: () => calls.push("map"),
      },
    )
    handlePluginMessage(
      { type: "injectExploreEadFunctions", requestId: "r1", playbook: "" },
      {
        setToken: () => {},
        injectAck: (ack) => calls.push(`empty:${ack.requestId}:${ack.ok}`),
      },
    )
    handlePluginMessage(
      { type: "injectCrawlVisionPfm", handoff: "explore-ead-functions", playbook: "crawl" },
      {
        setToken: () => {},
        inject: () => calls.push("crawl"),
      },
    )
    handlePluginMessage(
      { type: "injectExploreEadFunctions", requestId: "r2", playbook: "find nodes" },
      {
        setToken: () => {},
        inject: (_text, label, requestId) => calls.push(`${label}:${requestId}`),
      },
    )
    expect(calls).toEqual(["map", "empty:r1:false", "injectExploreEadFunctions:r2"])
  })

  test("openExternalUrl and openEadPilotWebApp route to hooks", () => {
    const calls: string[] = []
    handlePluginMessage(
      { type: "openExternalUrl", url: "https://eadfm.com", windowName: "ead" },
      {
        setToken: () => {},
        openExternal: (url, name) => calls.push(`ext:${url}:${name}`),
      },
    )
    handlePluginMessage(
      { type: "openEadPilotWebApp", productId: 2, productName: "SW", openEditProduct: "1" },
      {
        setToken: () => {},
        openWebApp: (opts) => calls.push(`web:${opts?.productId}:${opts?.openEditProduct}`),
      },
    )
    expect(calls).toEqual(["ext:https://eadfm.com:ead", "web:2:true"])
  })

  test("autoImproveStepComplete routes to hook", () => {
    const calls: string[] = []
    handlePluginMessage(
      { type: "autoImproveStepComplete", pfmNodeId: 42, reason: "done", at: "t1" },
      {
        setToken: () => {},
        stepComplete: (msg) => calls.push(`${msg.type}:${msg.pfmNodeId}`),
      },
    )
    handlePluginMessage(
      { type: "aiFindStepComplete", pfmNodeId: 7 },
      {
        setToken: () => {},
        stepComplete: (msg) => calls.push(`${msg.type}:${msg.pfmNodeId}`),
      },
    )
    expect(calls).toEqual(["autoImproveStepComplete:42", "aiFindStepComplete:7"])
  })

  test("writeClipboardText routes to hook", () => {
    const calls: string[] = []
    handlePluginMessage(
      { type: "writeClipboardText", requestId: "w1", text: "hello" },
      {
        setToken: () => {},
        writeClipboard: (id, text) => calls.push(`${id}:${text}`),
      },
    )
    expect(calls).toEqual(["w1:hello"])
  })

  test("aiFindApplied hard-refreshes the map tree", () => {
    const calls: string[] = []
    handlePluginMessage(
      { type: "aiFindApplied", productId: 2 },
      {
        setToken: () => {},
        bumpTree: () => calls.push("tree"),
        bumpMap: () => calls.push("map"),
        findApplied: () => calls.push("echo"),
      },
    )
    expect(calls).toEqual(["tree", "map", "echo"])
  })

  test("selectPfmSubSchema inbound updates Map schema", () => {
    const calls: number[] = []
    handlePluginMessage(
      { type: "selectPfmSubSchema", productId: 2, subSchemaId: 7 },
      {
        setToken: () => {},
        setSchema: (id) => calls.push(id),
      },
    )
    expect(calls).toEqual([7])
  })

  test("focusPfmNavigator opens Map and does not wipe a live token", () => {
    const calls: string[] = []
    handlePluginMessage(
      { type: "focusPfmNavigator", requireSignIn: true },
      {
        setToken: () => {},
        clearToken: () => calls.push("signout"),
        focusMap: () => calls.push("map"),
        needAuth: () => calls.push("auth"),
      },
    )
    expect(calls).toEqual(["map", "auth"])
  })

  test("setupTreeSaved syncs source tree", () => {
    const calls: string[] = []
    handlePluginMessage(
      { type: "setupTreeSaved" },
      {
        setToken: () => {},
        bumpTree: () => calls.push("tree"),
        bumpMap: () => calls.push("map"),
      },
    )
    expect(calls).toEqual(["tree", "map"])
  })

  test("flags include crawl and help", () => {
    expect(flagsFromAction({ kind: "crawl" }).openCrawlVision).toBe(true)
    expect(flagsFromAction({ kind: "help", tipId: "pfm-tree-filter" }).helpTipId).toBe("pfm-tree-filter")
    expect(flagsFromAction({ kind: "pfm" })).toEqual({})
  })

  test("updatePfmSelection / openCrawlVision post host messages", () => {
    const posted: unknown[] = []
    const frame = {
      contentWindow: {
        postMessage: (payload: unknown) => posted.push(payload),
      },
    } as unknown as HTMLIFrameElement
    updatePfmSelection(frame, { productId: 2, nodeId: 128, nodeName: "Login" })
    openCrawlVision(frame, { productId: 2, productName: "SW" })
    openHelpTip(frame, "ead-map-search-setup")
    expect((posted[0] as { type: string }).type).toBe("updatePfmSelection")
    expect((posted[1] as { type: string }).type).toBe("openCrawlVisionWizard")
    expect((posted[2] as { type: string; helpTipId: string }).helpTipId).toBe("ead-map-search-setup")
  })

  test("openFindWizard / openSetupMap post host messages", () => {
    const posted: unknown[] = []
    const frame = {
      contentWindow: {
        postMessage: (payload: unknown) => posted.push(payload),
      },
    } as unknown as HTMLIFrameElement
    openFindWizard(frame, { productId: 2, sourceId: 9, sourceName: "a" })
    openSetupMap(frame, { productId: 2, productName: "SW" })
    expect((posted[0] as { type: string }).type).toBe("openAiFindWizard")
    expect((posted[1] as { type: string }).type).toBe("openSetupEadMap")
  })

  test("openProfile posts openMyProfile", () => {
    const posted: unknown[] = []
    const frame = {
      contentWindow: {
        postMessage: (payload: unknown) => posted.push(payload),
      },
    } as unknown as HTMLIFrameElement
    openProfile(frame)
    expect(posted[0]).toEqual({ source: "ead-pfm-host", type: "openMyProfile" })
  })

  test("selectPfmSubSchema and hostClipboardCommand post host messages", () => {
    const posted: unknown[] = []
    const frame = {
      contentWindow: {
        postMessage: (payload: unknown) => posted.push(payload),
      },
    } as unknown as HTMLIFrameElement
    selectPfmSubSchema(frame, { productId: 2, subSchemaId: 7 })
    hostClipboardCommand(frame, "copy")
    postFindApplied(frame, { productId: 2, sourceId: 9, sourcePath: "src/a.ts", linkedPaths: ["src/a.ts"] })
    expect(posted[0]).toEqual({
      source: "ead-pfm-host",
      type: "selectPfmSubSchema",
      productId: 2,
      subSchemaId: 7,
    })
    expect(posted[1]).toEqual({
      source: "ead-pfm-host",
      type: "hostClipboardCommand",
      command: "copy",
    })
    expect((posted[2] as { type: string; sourceLinkedFilePaths?: string }).type).toBe("aiFindApplied")
    expect((posted[2] as { sourceLinkedFilePaths?: string }).sourceLinkedFilePaths).toBe('["src/a.ts"]')
  })
})

describe("ead context-modal + jobs + filters + actions", () => {
  test("format modal kinds", () => {
    expect(kindLabel("jobs")).toBe("AI Jobs")
    const prompt = formatModal(
      buildModal("prompt", 1, "N", { aiPrompt: "do it", eadScript: "script" }),
    )
    expect(prompt).toContain("do it")
    expect(prompt).toContain("script")
    const jobs = formatModal(buildModal("jobs", 1, "N", {}, [{ jobId: 7, title: "T", description: "D" }]))
    expect(jobs).toContain("#7")
    expect(jobs).toContain("D")
  })

  test("formatJobCounts", () => {
    expect(formatJobCounts({ created: 1, updated: 2, linked: 3, deleted: 0, warnings: 1 })).toContain("1 note")
  })

  test("owner + pfm filters persist per product and keep paths", () => {
    writeOwner(2, { enabled: true, active: true, memberEmail: "a@b.c" })
    expect(ownerSummary(readOwner(2), "en")).toContain("a@b.c")
    expect(readOwner(2).enabled).toBe(true)
    writeOwner(2, { enabled: false })
    expect(readOwner(2).enabled).toBe(true)
    writeOwner(2, { active: false, includeMe: false, memberEmail: "", memberEmails: [] })
    expect(readOwner(2).active).toBe(false)
    expect(ownerSummary(readOwner(2), "en")).toBe("All")
    writePfmFilter([10, 11], true, ["src/a.ts"], 2)
    expect(readPfmFilter(2)).toEqual({ ids: [10, 11], active: true, paths: ["src/a.ts"] })
    writePfmFilter([10, 11], false, undefined, 2)
    expect(readPfmFilter(2).active).toBe(false)
    expect(readPfmFilter(2).paths).toEqual(["src/a.ts"])
    writePfmFilter([], true, ["x"], 2)
    expect(readPfmFilter(2)).toEqual({ ids: [], active: false, paths: ["x"] })
    clearPfmFilter(2)
    expect(readPfmFilter(2).active).toBe(false)
  })

  test("queuePilot take/peek", () => {
    const seen: string[] = []
    const stop = watchPilot((a) => seen.push(a.kind))
    queuePilot({ kind: "setup" })
    expect(peekPilot()?.kind).toBe("setup")
    expect(seen).toEqual(["setup"])
    expect(takePilot()?.kind).toBe("setup")
    expect(takePilot()).toBeUndefined()
    stop()
  })
})

describe("ead api helpers", () => {
  test("collectProducts + authKind + system prompt", () => {
    expect(authKind("a@b.com")).toBe("email")
    expect(authKind("13800138000")).toBe("phone")
    const products = collectProducts([
      { productId: 2, name: "SW Admin", children: [{ productId: 2, name: "dup" }] },
    ])
    expect(products).toEqual([{ productId: 2, name: "SW Admin" }])
    const groups = collectGroups([
      {
        id: "team-1",
        name: "Ops",
        children: [
          { type: "product", productId: 2, name: "SW Admin", supportsSiblingProducts: true },
          { type: "product", productId: 3, name: "SW Twin", baseProductId: 2 },
        ],
      },
    ])
    expect(groups).toEqual([
      {
        id: "team-1",
        name: "Ops",
        products: [
          { productId: 2, name: "SW Admin", siblings: true },
          { productId: 3, name: "SW Twin", baseId: 2 },
        ],
      },
    ])
    expect(productRole(groups[0]!.products[0]!)).toBe("base")
    expect(productRole(groups[0]!.products[1]!)).toBe("sibling")
    const sys = formatSystemPrompt({ name: "Node", aiPrompt: "p", eadScript: "s" })
    expect(sys).toContain("<pfm-node-context>")
    expect(sys).toContain("<ai-prompt>p</ai-prompt>")
  })

  test("parseFilterIds accepts object and array shapes", () => {
    expect(parseFilterIds({ any: [128, 54], open: [128, 126], active: [] }).sort((a, b) => a - b)).toEqual([
      54, 126, 128,
    ])
    expect(parseFilterIds([9, 0, "8"])).toEqual([9, 8])
    expect(parseFilterIds(null)).toEqual([])
  })

  test("parseOpenIds prefers open list", () => {
    expect(parseOpenIds({ any: [1, 2], open: [9, 8] }).sort((a, b) => a - b)).toEqual([8, 9])
    expect(parseOpenIds({ any: [3, 4] }).sort((a, b) => a - b)).toEqual([3, 4])
    expect(parseOpenIds([5, 6])).toEqual([5, 6])
  })

  test("parseFiles accepts json array and csv", () => {
    expect(parseFiles('["a.ts","b.ts"]')).toEqual(["a.ts", "b.ts"])
    expect(parseFiles("a.ts, b.ts")).toEqual(["a.ts", "b.ts"])
    expect(parseFiles("")).toEqual([])
  })
})

describe("ead i18n + env + mcp", () => {
  test("map i18n covers ja and ko", () => {
    expect(t("ja", "title")).toContain("マップ")
    expect(t("ko", "title")).toContain("맵")
    expect(t("zh", "aiPilot")).toBe("AI 领航")
    expect(t("zh", "enableAiCodingPlan")).toContain("启用")
    expect(t("zh", "eadCodingPlanTitle")).toBe("EAD 编码计划")
    expect(t("en", "enableEadCodingPlan")).toContain("Enable")
    expect(t("en", "pfmFilterPrefix", { count: 3 })).toContain("3")
    expect(t("zh", "confirmPassword")).toBe("确认密码")
    expect(t("en", "createTask")).toContain("task")
    expect(t("en", "aiCode")).toBe("AI Code View")
    expect(t("zh", "aiCode")).toBe("AI 代码视图")
    expect(t("en", "groupPfmVsSource")).toBe("PFM vs. Source Code")
    expect(t("zh", "showFilteredOnly")).toBe("仅显示已筛选的 PFM 节点")
    expect(t("zh", "showDebug")).toBe("显示调试消息")
    expect(t("en", "searchPlaceholder")).toBe("Search PFM nodes")
    expect(t("zh", "searchLabel")).toBe("搜索")
    expect(t("en", "scopeFiltered")).toBe("Filtered PFM nodes only")
    expect(t("zh", "sourceWithPfm")).toBe("显示含 PFM 节点的源代码")
    expect(t("zh", "badgePending")).toBe("待创建")
  })

  test("applyEnv switches api and origin", () => {
    applyEnv("localhost")
    expect(eadEnv()).toBe("localhost")
    expect(eadServer()).toContain("127.0.0.1")
    expect(eadApi()).toContain("8081")
    expect(isEadHost(eadOrigin())).toBe(true)
    applyEnv("production")
    expect(eadApi()).toContain("eadfm.com")
    expect(isEadHost("https://eadfm.com")).toBe(true)
    expect(isEadHost("http://localhost:5173")).toBe(true)
  })

  test("mcpCandidates walks to sibling EAD_PFM-Editor", () => {
    const list = mcpCandidates("/Users/me/Projects/TX/KloudCode", "")
    expect(list.some((p) => p.includes("EAD_PFM-Editor/mcp-eadpfm/dist/index.js"))).toBe(true)
  })

  test("mcpCandidates finds a sibling repo named with a space", () => {
    const list = mcpCandidates("/Users/me/Project/KloudCode", "")
    expect(list).toContain("/Users/me/Project/KloudCode/../EAD_PFM Editor/mcp-eadpfm/dist/index.js")
  })

  test("resolveMcpEntry skips missing files and finds the MCP inside the open repo", async () => {
    const root = "/Users/me/Project/EAD_PFM Editor"
    const reads: string[] = []
    const probe = prober(
      {
        mcp: { add: async () => undefined, connect: async () => undefined },
        file: {
          read: async (input) => {
            reads.push(input.path)
            // The server answers missing files with empty content rather than an error.
            return { data: { type: "text", content: input.path === "mcp-eadpfm/dist/index.js" ? "x" : "" } }
          },
        },
      },
      root,
    )
    const entry = await resolveMcpEntry("/Users/me/Project/EAD_PFM-Editor/mcp-eadpfm/dist/index.js", root, probe)
    expect(entry).toBe(`${root}/mcp-eadpfm/dist/index.js`)
    expect(reads.every((path) => !path.startsWith("/"))).toBe(true)
  })

  test("mcpCandidates finds the MCP inside the open EAD repo", () => {
    const list = mcpCandidates("/Users/me/Project/EAD_PFM Editor", "")
    expect(list).toContain("/Users/me/Project/EAD_PFM Editor/mcp-eadpfm/dist/index.js")
  })

  test("loadActiveMap marks common and specific under a dynamic top", async () => {
    const http = (async () =>
      new Response(
        JSON.stringify({
          mapId: 1,
          supportSubSchemas: false,
          rootNode: {
            nodeId: 1,
            nodeName: "Map",
            children: [
              {
                nodeId: 10,
                nodeName: "PPM",
                isDynamicTopLevel: true,
                children: [
                  { nodeId: 11, nodeName: "Overview", ifCommonStatus: 1, supportEadWorkflow: true, children: [] },
                  { nodeId: 12, nodeName: "Spec Type", ifCommonStatus: 0, supportEadWorkflow: true, children: [] },
                ],
              },
            ],
          },
        }),
      )) as unknown as typeof fetch
    const map = await loadActiveMap("token", 2, http)
    const top = map.root?.children.find((n) => n.nodeId === 10)
    expect(top?.isDynamicTopLevel).toBe(true)
    expect(top?.underDynamic).toBeUndefined()
    expect(top?.children.map((n) => [n.nodeId, n.underDynamic, n.ifCommonStatus])).toEqual([
      [11, true, 1],
      [12, true, 0],
    ])
  })

  test("loadPlans reads the effective plan from an older Pilot", async () => {
    const empty = { easy: "", reasoning: "", advanced: "", vision: "" }
    const ok = (async () =>
      new Response(JSON.stringify({ effectivePlan: { name: "EAD 1.2", nameSuffix: "  Plus  " } }))) as unknown as typeof fetch
    expect(await loadPlans("token", ok)).toEqual([
      { name: "EAD 1.2", label: "EAD DP1.2", suffix: "Plus", model: "", slots: empty },
    ])
    const skip = (async () =>
      new Response(JSON.stringify({ effectivePlan: { name: "Premium" } }))) as unknown as typeof fetch
    expect(await loadPlans("token", skip)).toEqual([])
    const fail = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch
    expect(await loadPlans("token", fail)).toEqual([])
  })

  test("loadPlans lists every assigned plan in display order", async () => {
    const multi = (async () =>
      new Response(
        JSON.stringify({
          effectivePlan: { name: "EAD 2.1" },
          assignedPlans: [
            { name: "EAD 3.0", displayOrder: 20, slots: [{ slotKey: "advanced", modelId: "kimi-k2" }] },
            { name: "EAD DP2.1", displayOrder: 10, slots: [{ slotKey: "easy", modelId: "deepseek-chat" }] },
            { name: "EAD 2.1", displayOrder: 30 },
            { name: "Premium", displayOrder: 5 },
          ],
        }),
      )) as unknown as typeof fetch
    const list = await loadPlans("token", multi)
    expect(list.map((plan) => [plan.name, plan.label, plan.model])).toEqual([
      ["EAD 2.1", "EAD DP2.1", "DeepSeek Chat"],
      ["EAD 3.0", "EAD DP3.0", "Kimi K2"],
    ])
  })

  test("plan names match the Pilot rule", () => {
    expect(planName("EAD DP2.1")).toBe("EAD 2.1")
    expect(planName(" EAD 2.1 Plan ")).toBe("EAD 2.1")
    expect(planLabel("EAD 2.1")).toBe("EAD DP2.1")
  })

  test("sendChat drafts and does not auto-submit", async () => {
    const drafts: string[] = []
    const set = (prompt: { type: string; content?: string }[]) => {
      drafts.push(prompt[0]?.content ?? "")
    }
    expect(await sendChat({ text: " playbook ", set })).toBe(true)
    expect(drafts).toEqual(["playbook"])
    expect(await sendChat({ text: "   ", set })).toBe(false)
  })

  test("plan spec is an openai-compatible EAD gateway", () => {
    applyEnv("production")
    expect(PLAN).toBe("ead")
    expect(gateway()).toBe("https://eadfm.com/v1")
    const two = [
      { name: "EAD 2.1", label: "EAD DP2.1" },
      { name: "EAD 3.0", label: "EAD DP3.0" },
    ]
    expect(spec(two)).toEqual({
      npm: "@ai-sdk/openai-compatible",
      name: "EAD",
      options: { baseURL: "https://eadfm.com/v1" },
      models: {
        "EAD 2.1": { name: "EAD DP2.1", attachment: true, modalities: { input: ["text", "image"], output: ["text"] } },
        "EAD 3.0": { name: "EAD DP3.0", attachment: true, modalities: { input: ["text", "image"], output: ["text"] } },
      },
      whitelist: ["EAD 2.1", "EAD 3.0"],
    })
    expect(match(spec(two), two)).toBe(true)
    expect(match(spec(two), two.slice(0, 1))).toBe(false)
    expect(match(spec(two.slice(0, 1)), two)).toBe(false)
    expect(match(spec(two), [two[1], two[0]])).toBe(false)
  })

  test("plan spec carries the plan's token limits, and a change in them rewrites the config", () => {
    applyEnv("production")
    const sized = [{ name: "EAD 3.2", label: "EAD DP3.2", context: 200_000, output: 32_768 }]
    expect(spec(sized).models).toEqual({
      "EAD 3.2": {
        name: "EAD DP3.2",
        attachment: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 200_000, output: 32_768 },
      },
    })
    expect(match(spec(sized), sized)).toBe(true)
    expect(match(spec([{ name: "EAD 3.2", label: "EAD DP3.2" }]), sized)).toBe(false)
    expect(match(spec(sized), [{ ...sized[0]!, context: 128_000 }])).toBe(false)
  })

  test("loadPlans reads one-session plans, which may have any name", async () => {
    const rows = (async () =>
      new Response(
        JSON.stringify({
          assignedPlans: [
            { name: "EAD 3.2", displayOrder: 1 },
            {
              name: "EAD Expert Review 4.0",
              displayOrder: 2,
              usage: "one-session",
              description: "  Architecture and   security review ",
              priceHint: "≈ $0.40 / request",
              policy: { maxRequests: 5 },
            },
            { name: "EAD Vision Pro", displayOrder: 3, usage: "one-session", policy: { maxRequests: 0 } },
            { name: "Premium", displayOrder: 4, usage: "regular" },
            { name: "", displayOrder: 5, usage: "one-session" },
          ],
        }),
      )) as unknown as typeof fetch
    const list = await loadPlans("token", rows)
    expect(list.map((plan) => [plan.name, plan.label, plan.oneSession])).toEqual([
      ["EAD 3.2", "EAD DP3.2", undefined],
      [
        "EAD Expert Review 4.0",
        "EAD Expert Review 4.0",
        { description: "Architecture and security review", price: "≈ $0.40 / request", limit: 5 },
      ],
      ["EAD Vision Pro", "EAD Vision Pro", {}],
    ])
  })

  test("the Pilot panel keeps its embedded mode and tells Pilot it runs in EAD SiCode", () => {
    applyEnv("production")
    const url = new URL(buildPilotShellUrl({ productId: 7, mode: "cursor" }))
    expect(url.searchParams.get("mode")).toBe("cursor")
    expect(url.searchParams.get("host")).toBe("sicode")
    expect(new URL(buildPilotUrl({ mode: "cursor" })).searchParams.get("host")).toBe("sicode")
  })

  test("loadPlans reads Pilot's One Time Only Models after the plans", async () => {
    const rows = (async () =>
      new Response(
        JSON.stringify({
          assignedPlans: [{ name: "EAD 3.2", displayOrder: 1 }],
          oneTimeModels: [
            {
              name: "EAD Expert Review",
              providerId: "anthropic",
              modelId: "claude-opus-5-5",
              description: "Architecture review",
              priceHint: "In/Out: $15/$75",
              maxRequests: 5,
            },
            { name: "Vision Pro", providerId: "openai", modelId: "gpt-5.2", maxRequests: null },
            { name: "", providerId: "openai", modelId: "x" },
          ],
        }),
      )) as unknown as typeof fetch
    const list = await loadPlans("token", rows)
    expect(list.map((plan) => [plan.name, plan.label, plan.oneSession])).toEqual([
      ["EAD 3.2", "EAD DP3.2", undefined],
      ["EAD Expert Review", "EAD Expert Review", { description: "Architecture review", price: "In/Out: $15/$75", limit: 5 }],
      ["Vision Pro", "Vision Pro", {}],
    ])
  })

  test("plan spec marks one-session plans, and a change in that marking rewrites the config", () => {
    applyEnv("production")
    const plans = [
      { name: "EAD 3.2", label: "EAD DP3.2" },
      { name: "EAD Expert Review 4.0", label: "EAD Expert Review 4.0", oneSession: { price: "≈ $0.40", limit: 5 } },
    ]
    const models = spec(plans).models as Record<string, { one_session?: unknown }>
    expect(models["EAD 3.2"]?.one_session).toBeUndefined()
    expect(models["EAD Expert Review 4.0"]?.one_session).toEqual({ price: "≈ $0.40", limit: 5 })
    expect(spec(plans).whitelist).toEqual(["EAD 3.2", "EAD Expert Review 4.0"])
    expect(match(spec(plans), plans)).toBe(true)
    expect(match(spec(plans), [plans[0]!, { ...plans[1]!, oneSession: { price: "≈ $0.40", limit: 3 } }])).toBe(false)
    expect(match(spec(plans), [plans[0]!, { name: plans[1]!.name, label: plans[1]!.label }])).toBe(false)
  })

  test("apply writes the sign-in only when it differs from the one stored", async () => {
    applyEnv("production")
    const keys: string[] = []
    const auth = {
      set: async (input: { providerID: string; auth: { type: "api"; key: string } }) => {
        keys.push(input.auth.key)
      },
      remove: async () => undefined,
    }
    const saves: unknown[] = []
    const save = async (config: unknown) => {
      saves.push(config)
    }
    const plans = [{ name: "EAD 3.2", label: "EAD DP3.2" }]
    // First start: nothing stored yet, so both the sign-in and the plan models are written.
    await apply({ token: "tok1", plans, auth, save })
    // Plan list reloaded with the same sign-in and models: nothing is written.
    await apply({ token: "tok1", plans, auth, save, cfg: spec(plans), stored: "tok1" })
    // A new or renewed sign-in is always written, even when the plan models are unchanged.
    await apply({ token: "tok2", plans, auth, save, cfg: spec(plans), stored: "tok1" })
    expect(keys).toEqual(["tok1", "tok2"])
    expect(saves).toHaveLength(1)
  })

  test("plan models take images, and a saved config without them is rewritten", () => {
    applyEnv("production")
    const plans = [{ name: "EAD 3.2", label: "EAD DP3.2" }]
    const old = { ...spec(plans), models: { "EAD 3.2": { name: "EAD DP3.2" } } }
    expect(match(old, plans)).toBe(false)
    expect(match(spec(plans), plans)).toBe(true)
  })

  test("apply skips save when the plan is already registered", async () => {
    let key = ""
    const auth = {
      set: async (input: { providerID: string; auth: { type: "api"; key: string } }) => {
        key = `${input.providerID}:${input.auth.key}`
      },
      remove: async () => undefined,
    }
    const calls: unknown[] = []
    const save = async (config: unknown) => {
      calls.push(config)
    }
    const plans = [{ name: "EAD 2.1", label: "EAD DP2.1" }]
    await apply({ token: "tok", plans, auth, save })
    expect(key).toBe("ead:tok")
    await apply({ token: "tok", plans, auth, save, cfg: spec(plans) })
    await apply({ token: "tok", plans, auth, save, cfg: spec(plans), disabled: ["ead"] })
    await apply({ token: "tok", plans: [], auth, save })
    expect(calls).toEqual([
      { provider: { ead: spec(plans) }, disabled_providers: [] },
      { provider: { ead: spec(plans) }, disabled_providers: [] },
    ])
  })

  test("drop disables the plan provider", async () => {
    let gone = 0
    const auth = {
      set: async () => undefined,
      remove: async () => {
        gone++
      },
    }
    const calls: unknown[] = []
    const save = async (config: unknown) => {
      calls.push(config)
    }
    await drop({ auth, save })
    expect(gone).toBe(1)
    expect(calls).toEqual([{ disabled_providers: ["ead"] }])
    await drop({ auth, save, disabled: ["ead"] })
    expect(calls).toHaveLength(1)
  })

  test("diag pipeline records ok and fail steps", () => {
    beginDiag()
    noteDiag("Auth", true, "ok")
    noteDiag("Map", false, "timeout")
    expect(formatDiag()).toBe("ok Auth: ok\nfail Map: timeout")
    expect(readStartup()).toEqual({ text: "✗ Map: timeout", kind: "error" })
  })
})

describe("ead step-signal", () => {
  test("parses MCP payload and path", () => {
    const step = parseBody(
      `{"type":"autoImproveStepComplete","pfmNodeId":9,"reason":"ok","at":"2026-09-09T01:00:00.000Z"}`,
    )
    expect(step?.pfmNodeId).toBe(9)
    expect(parseStep({ type: "nope" })).toBeUndefined()
    expect(parseBody("{")).toBeUndefined()
    expect(matches(SIGNAL)).toBe(true)
    expect(matches(`/tmp/${SIGNAL}`)).toBe(true)
    expect(matches(PROGRESS)).toBe(true)
    expect(matches(RESULT)).toBe(true)
    expect(matches("other.json")).toBe(false)
  })

  test("skips leftover then fires on new at", () => {
    const seen = watch()
    const a = parseStep({ type: "autoImproveStepComplete", pfmNodeId: 1, at: "t1", reason: "a" })!
    const b = parseStep({ type: "autoImproveStepComplete", pfmNodeId: 1, at: "t2", reason: "b" })!
    const c = parseStep({ type: "autoImproveStepComplete", pfmNodeId: 1, at: "t3", reason: "c" })!
    expect(seen.hit(a, 1000)).toBe(false)
    expect(seen.hit(a, 3000)).toBe(false)
    expect(seen.hit(b, 3000)).toBe(true)
    expect(seen.hit(c, 3100)).toBe(false)
    expect(seen.hit(c, 3250)).toBe(true)
  })

  test("fires first write after miss", () => {
    const seen = watch()
    seen.miss()
    const a = parseStep({ type: "autoImproveStepComplete", pfmNodeId: null, at: "t1", reason: "new" })!
    expect(seen.hit(a, 1000)).toBe(true)
  })

  test("result watcher has no debounce", () => {
    const seen = watch(0)
    seen.miss()
    expect(seen.hit({ at: "t1" }, 1)).toBe(true)
    expect(seen.hit({ at: "t2" }, 2)).toBe(true)
  })

  test("progress and result payloads", () => {
    const cue = parseCue(`{"type":"improveTestCasesProgress","pfmNodeId":9,"message":"ok","at":"t1"}`)
    expect(progress(cue!).type).toBe("improveTestCasesProgress")
    expect(progress(cue!).pfmNodeId).toBe(9)
    expect(result({ ok: false, pfmNodeId: 3, message: "no" }).ok).toBe(false)
  })
})

describe("ead precheck", () => {
  test("lined requires features and transitions", () => {
    expect(lined("short")).toBe(false)
    const rows = [
      "Feature 1",
      "[Login] {Click} → [Home]",
      "[Home] {Open} → [List]",
      "Feature 2",
      "[List] {Pick} → [Item]",
      "[Item] {Edit} ↔ [Form]",
      "Feature 3",
      "[Form] {Save} → [Done]",
      "[Done] {Back} → [Home]",
    ]
    const pad = `${rows.join("\n")}\n${"x".repeat(280)}`
    expect(lined(pad)).toBe(true)
  })

  test("precheck fails closed without token", async () => {
    const block = await precheck("", 9, null)
    expect(block?.failures).toEqual(["EAD Script not found."])
  })
})

describe("ead cowork client", () => {
  test("sends the sign-in, company and body, and reads Pilot's error codes", async () => {
    applyEnv("production")
    const seen: { url: string; method?: string; headers: Record<string, string>; body?: string }[] = []
    const answers = [
      new Response(JSON.stringify({ projectId: 7, repoId: "1001" }), { status: 200 }),
      new Response(JSON.stringify({ code: "GITHUB_NOT_CONNECTED", message: "Connect GitHub." }), { status: 409 }),
      new Response(null, { status: 204 }),
      new Response(JSON.stringify({ sessions: [], next: null }), { status: 200 }),
    ]
    const http = (async (url: string, init?: RequestInit) => {
      seen.push({ url, method: init?.method, headers: init?.headers as Record<string, string>, body: init?.body as string })
      return answers.shift()!
    }) as typeof fetch
    const api = cowork("tok", 3, http)

    expect((await api.resolve("git@github.com:TechExcel-inc/KloudCode.git")).projectId).toBe(7)
    expect(seen[0].url).toBe("https://eadfm.com/api/cowork/v1/projects/resolve")
    expect(seen[0].method).toBe("POST")
    expect(seen[0].headers.Authorization).toBe("Bearer tok")
    expect(seen[0].headers["X-Tenant-Id"]).toBe("3")
    expect(JSON.parse(seen[0].body!)).toEqual({ repoUrl: "git@github.com:TechExcel-inc/KloudCode.git" })

    const fail = await api.recent({ q: "p1 vp", limit: 10 }).catch((err) => err)
    expect(fail).toBeInstanceOf(CoworkFail)
    expect([fail.status, fail.code, fail.message]).toEqual([409, "GITHUB_NOT_CONNECTED", "Connect GitHub."])
    expect(seen[1].url).toBe("https://eadfm.com/api/cowork/v1/projects/recent?q=p1+vp&limit=10")

    expect(await api.unrelate(7, 9)).toBeUndefined()
    expect(seen[2].url).toBe("https://eadfm.com/api/cowork/v1/projects/7/related/9")

    await api.sessions({ projectIds: [7, 9], state: ["OPEN", "FINISHED"] })
    expect(seen[3].url).toBe("https://eadfm.com/api/cowork/v1/sessions?projectIds=7%2C9&state=OPEN%2CFINISHED")
  })

  test("githubRepo reads owner/name from every GitHub remote form", () => {
    expect(githubRepo("https://github.com/TechExcel-inc/KloudCode.git")).toBe("techexcel-inc/kloudcode")
    expect(githubRepo("https://someone@github.com/TechExcel-inc/P1_VP12")).toBe("techexcel-inc/p1_vp12")
    expect(githubRepo("git@github.com:TechExcel-inc/KloudCode.git")).toBe("techexcel-inc/kloudcode")
    expect(githubRepo("ssh://git@github.com/TechExcel-inc/KloudCode.git")).toBe("techexcel-inc/kloudcode")
    expect(githubRepo("https://gitlab.com/TechExcel-inc/KloudCode.git")).toBeUndefined()
    expect(githubRepo("https://github.com/TechExcel-inc/KloudCode/tree/dev")).toBeUndefined()
    expect(githubRepo(undefined)).toBeUndefined()
  })

  test("offline tells a dropped connection from an answer", () => {
    expect(offline("Load failed")).toBe(true)
    expect(offline("Failed to fetch")).toBe(true)
    expect(offline("Unable to connect. Is the computer able to access the url?")).toBe(true)
    expect(offline("The network connection was lost.")).toBe(true)
    expect(offline("HTTP 500")).toBe(false)
    expect(offline("AUTH_EXPIRED")).toBe(false)
  })

  test("usage totals assistant tokens and cost in millionths", () => {
    const turn = (input: number, cost: number) => ({
      role: "assistant",
      cost,
      tokens: { input, output: 10, reasoning: 5, cache: { read: 2, write: 1 } },
    })
    expect(usage([{ role: "user" }, turn(100, 0.0123), turn(50, 0.0001)])).toEqual({
      messageCount: 3,
      inputTokens: 150,
      outputTokens: 30,
      cacheReadTokens: 4,
      cacheWriteTokens: 2,
      costMicroUsd: 12400,
    })
  })
})

describe("modelUsage", () => {
  const reply = (modelID: string, created: string, input: number, cost: number) => ({
    role: "assistant",
    providerID: "deepseek",
    modelID,
    cost,
    time: { created: Date.parse(created) },
    tokens: { input, output: 10, reasoning: 2, cache: { read: 100, write: 1 } },
  })

  test("keeps each model and UTC day apart", () => {
    const rows = modelUsage([
      { role: "user" },
      reply("v4-pro", "2026-10-20T01:00:00Z", 5, 0.001),
      reply("v4-pro", "2026-10-20T23:00:00Z", 7, 0.002),
      reply("v4-flash", "2026-10-20T02:00:00Z", 1, 0),
      reply("v4-pro", "2026-10-21T00:30:00Z", 3, 0.0005),
    ])
    expect(rows).toEqual([
      {
        usageDate: "2026-10-20",
        providerId: "deepseek",
        modelId: "v4-pro",
        messageCount: 2,
        inputTokens: 12,
        outputTokens: 20,
        reasoningTokens: 4,
        cacheReadTokens: 200,
        cacheWriteTokens: 2,
        listCostMicroUsd: 3000,
      },
      expect.objectContaining({ usageDate: "2026-10-20", modelId: "v4-flash", messageCount: 1, inputTokens: 1 }),
      expect.objectContaining({ usageDate: "2026-10-21", modelId: "v4-pro", messageCount: 1, listCostMicroUsd: 500 }),
    ])
  })
})
