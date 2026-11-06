import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack, type JSX } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { showToast } from "@opencode-ai/ui/toast"
import { useLayout } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useCowork } from "@/context/cowork"
import type { Sizing } from "@/pages/session/helpers"
import { resizeEadPanel } from "@/pages/session/helpers"
import { useSessionLayout } from "@/pages/session/session-layout"
import { queuePilot } from "@/ead/actions"
import "@/ead/navigator.css"
import {
  loadActiveMap,
  loadCatalog,
  loadContext,
  loadLinkPaths,
  loadLinkedBundle,
  loadFullBundle,
  loadOpenFilterNodeIds,
  loadPfmEadCounts,
  loadPfmJobCounts,
  loadPfmTestCounts,
  loadPlans,
  type Plan,
  loadRunPrefs,
  loadSourceExpanded,
  loadSourceSchema,
  loadSubtreePaths,
  loadTeamMembers,
  me,
  productRole,
  saveRunPrefs,
  saveSourceExpanded,
  selectSourcePath,
  suggestProduct,
  type Group,
  type PfmNode,
  type Product,
  type SubSchema,
  type TeamMember,
} from "@/ead/api"
import { openPilot } from "@/ead/bridge"
import { beginDiag, markStartup, noteDiag, readDiag, readStartup } from "@/ead/diag"
import { clearEadMcp, ensureEadMcp } from "@/ead/ensure-mcp"
import { ownerSummary, readOwner, readPfmFilter, writeOwner, writePfmFilter } from "@/ead/filters"
import { type TipId } from "@/ead/help-tips"
import { t, type Lang } from "@/ead/i18n"
import { expandKey, useEad, type EadNodeHit } from "@/ead/settings"
import { eadHttp, offline } from "@/ead/http"
import {
  ancestorPaths,
  buildTree,
  collectIds,
  computeExpanded,
  cue,
  filterByCount,
  filterByIds,
  filterDisplay,
  filterLinked,
  filterLinkedTree,
  filterPfm,
  filterSource,
  tops,
  filteredCounts,
  idCounts,
  mergeExpanded,
  parseRows,
  pathIds,
  pathTrail,
  pruneExpanded,
  rollupCounts,
  type SourceNode,
} from "@/ead/source-tree"
import { tokenExpired } from "@/ead/auth"
import { EadSignInCard } from "@/components/ead-sign-in"
import { EAD_MAP_ID, EAD_MAP_MAX, EAD_MAP_MIN, EAD_MAP_WIDTH, EAD_PILOT_ID, eadApi } from "@/ead/urls"

type Hint = { productId: number; name: string }
type Banner = { kind: "loading" | "ok" | "error"; text: string }
type Menu =
  | ""
  | "user"
  | "lang"
  | "coding"
  | "product"
  | "schema"
  | "setup"
  | "job"
  | "run"
  | "view"
  | "scope"
  | "owner"

const SOFT_GAP = 120_000

const drop = "ead-drop"

const IconSpark = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    <path d="M20 3v4" />
    <path d="M22 5h-4" />
    <path d="M4 17v2" />
    <path d="M5 18H3" />
  </svg>
)
const IconChip = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect width="16" height="16" x="4" y="4" rx="2" />
    <rect width="6" height="6" x="9" y="9" rx="1" />
    <path d="M15 2v2" />
    <path d="M15 20v2" />
    <path d="M2 15h2" />
    <path d="M2 9h2" />
    <path d="M20 15h2" />
    <path d="M20 9h2" />
    <path d="M9 2v2" />
    <path d="M9 20v2" />
  </svg>
)
const IconMenu = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <path d="M4 6h16" />
    <path d="M4 12h16" />
    <path d="M4 18h16" />
  </svg>
)
const IconOwnerSingle = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
)
const IconOwnerMulti = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
)
const IconSwap = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M8 3 4 7l4 4" />
    <path d="M4 7h16" />
    <path d="m16 21 4-4-4-4" />
    <path d="M20 17H4" />
  </svg>
)
const IconEdit = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 0L7 19l-4 1 1-4Z" />
  </svg>
)
const IconDots = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </svg>
)
const IconFilter = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
  </svg>
)
const IconFile = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-5-5Z" />
    <path d="M14 2v5h5" />
    <path d="M9 13h6" />
    <path d="M9 17h6" />
  </svg>
)
const IconLayers = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
    <path d="m22 12.57-8.58 3.91a2 2 0 0 1-1.66 0L2.6 12.57" />
    <path d="m22 17.57-8.58 3.91a2 2 0 0 1-1.66 0L2.6 17.57" />
  </svg>
)
const IconCheck = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
    <path d="m5 12 4 4 10-10" />
  </svg>
)
const IconEad = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="M8 3h8" />
    <path d="M12 3v7" />
    <rect x="5" y="10" width="14" height="11" rx="2" />
    <path d="M9 15h6" />
  </svg>
)
const IconJobs = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H9l2 2h6.5A2.5 2.5 0 0 1 20 9.5V10" />
    <path d="M4 10h16l-1.4 7.2A2.2 2.2 0 0 1 16.45 19H7.55a2.2 2.2 0 0 1-2.15-1.8L4 10Z" />
    <path d="M12 13v3" />
    <path d="M10.5 14.5h3" />
  </svg>
)
const IconTests = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="M8 2v4" />
    <path d="M16 2v4" />
    <path d="M3 10h18" />
    <rect x="3" y="4" width="18" height="18" rx="3" />
    <path d="m9 16 2 2 4-5" />
  </svg>
)
const IconCaret = () => (
  <svg class="filter-caret" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
)
const IconChevron = (props: { open: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    style={{
      transform: props.open ? "rotate(90deg)" : "none",
      transition: "transform 0.15s ease",
    }}
  >
    <path d="m9 6 6 6-6 6" />
  </svg>
)
const IconClose = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
)

function seedOpen(nodes: PfmNode[], depth = 0): number[] {
  return nodes.flatMap((node) => {
    if (depth >= 2) return []
    return [node.nodeId, ...seedOpen(node.children, depth + 1)]
  })
}

function badgeLabel(lang: Lang, kind: "ead" | "job" | "test", count: number) {
  if (kind === "ead") return count === 1 ? t(lang, "badgeEad", { count }) : t(lang, "badgeEads", { count })
  if (kind === "job") return count === 1 ? t(lang, "badgeJob", { count }) : t(lang, "badgeJobs", { count })
  return count === 1 ? t(lang, "badgeTest", { count }) : t(lang, "badgeTests", { count })
}

function Empty(props: { title: string; hint?: string; children?: JSX.Element }) {
  return (
    <div class="empty-rich">
      <div class="empty-title">{props.title}</div>
      <Show when={props.hint}>
        <div class="empty-hint">{props.hint}</div>
      </Show>
      {props.children}
    </div>
  )
}

const IconHelp = () => (
  <svg
    class="nav-menu-help-icon"
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <path d="M12 17h.01" />
  </svg>
)

function HelpMenu(props: { lang: Lang; onClick: () => void }) {
  const label = () => t(props.lang, "help")
  return (
    <div class="nav-menu-help">
      <button
        type="button"
        class="nav-menu-help-btn"
        title={label()}
        aria-label={label()}
        onClick={props.onClick}
      >
        <IconHelp />
        <span>{label()}</span>
      </button>
    </div>
  )
}

function Tree(props: {
  nodes: PfmNode[]
  selected: number
  onSelect: (node: PfmNode) => void
  depth?: number
  badge?: "ead" | "jobs" | "tests" | "none"
  counts?: Record<string, number>
  work?: number
  force?: number[]
  pulse?: number
  lang: Lang
  expanded?: number[]
  onToggle?: (id: number, open: boolean) => void
  schemas?: SubSchema[]
  subId?: number
  schemaOpen?: number
  onSchemaOpen?: (id: number) => void
  onSchema?: (id: number) => void
  schemaLabel?: string
  loadName?: string
}) {
  const depth = () => props.depth ?? 0
  return (
    <For each={props.nodes}>
      {(node) => {
        const controlled = () => Array.isArray(props.expanded)
        const [local, setLocal] = createSignal(depth() < 2)
        const open = () => (controlled() ? props.expanded!.includes(node.nodeId) : local())
        const dyn = () => !!node.isDynamicTopLevel
        const loading = () => dyn() && !!props.loadName
        const kids = () => node.children.length > 0 || loading()
        const on = () => props.selected === node.nodeId
        const work = () => !!props.work && props.work === node.nodeId && !on()
        const shown = () => loading() || !!props.force?.includes(node.nodeId) || open()
        const flash = () => !!props.pulse && props.pulse === node.nodeId
        const canSchema = () => dyn() && (props.schemas?.length ?? 0) > 0
        const count = () => Number(props.counts?.[String(node.nodeId)] || 0)
        const label = () => {
          const n = count()
          if (n <= 0 || !props.badge || props.badge === "none") return ""
          if (props.badge === "ead") return badgeLabel(props.lang, "ead", n)
          if (props.badge === "jobs") return badgeLabel(props.lang, "job", n)
          return badgeLabel(props.lang, "test", n)
        }
        const badgeCls = () => {
          if (props.badge === "jobs") return "ead-jobs-badge"
          if (props.badge === "tests") return "ead-tests-badge"
          return "ead-count-badge"
        }
        const title = () => {
          if (canSchema() && props.schemaLabel) return props.schemaLabel
          return node.name
        }
        const toggle = (e: MouseEvent) => {
          e.stopPropagation()
          const next = !open()
          if (controlled() && props.onToggle) {
            props.onToggle(node.nodeId, next)
            return
          }
          setLocal(next)
        }
        return (
          <div>
            <div
              class="ead-row group"
              classList={{
                "is-actual": on(),
                "is-work": work(),
                "is-dynamic-top": dyn(),
                "refresh-flash": flash(),
              }}
              style={{ "padding-left": `${8 + depth() * 18}px` }}
              title={title()}
              data-ead-node={node.nodeId}
              data-ead-pfm={node.nodeId}
            >
              <Show when={kids()} fallback={<span class="ead-chevron" />}>
                <button type="button" class="ead-chevron is-toggle" onClick={toggle}>
                  <IconChevron open={shown()} />
                </button>
              </Show>
              <Show when={work()}>
                <span class="ead-work-dot" aria-hidden="true" />
              </Show>
              <button
                type="button"
                class="ead-row-icon"
                classList={{
                  dynamic: dyn(),
                  functional: node.workType === "functional",
                  common: !dyn() && !!node.underDynamic && node.supportEadWorkflow !== false && !node.isHub && node.ifCommonStatus === 1,
                  specific: !dyn() && !!node.underDynamic && node.supportEadWorkflow !== false && !node.isHub && node.ifCommonStatus === 0,
                  "is-toggle": kids(),
                }}
                onClick={(e) => {
                  if (!kids()) {
                    props.onSelect(node)
                    return
                  }
                  toggle(e)
                }}
              >
                <Show when={dyn()} fallback={kids() || depth() === 0 || work() ? <IconFolder /> : <IconFile />}>
                  <IconLayers />
                </Show>
              </button>
              <button type="button" class="ead-row-name" onClick={() => props.onSelect(node)}>
                {title()}
              </button>
              <Show when={label()}>
                <span class="pfm-badges">
                  <span class={badgeCls()}>{label()}</span>
                </span>
              </Show>
              <Show when={canSchema()}>
                <span class="dyn-switch-wrap" data-ead-menu>
                  <button
                    type="button"
                    class="generate-dyn-btn"
                    classList={{ "is-open": props.schemaOpen === node.nodeId }}
                    title={t(props.lang, "switchDyn")}
                    aria-label={t(props.lang, "switchDyn")}
                    onClick={(e) => {
                      e.stopPropagation()
                      props.onSchemaOpen?.(props.schemaOpen === node.nodeId ? 0 : node.nodeId)
                    }}
                  >
                    ›
                  </button>
                  <Show when={props.schemaOpen === node.nodeId}>
                    <div class="node-menu">
                      <div class="node-menu-label">{t(props.lang, "switchDyn")}</div>
                      <For each={props.schemas || []}>
                        {(s) => (
                          <button
                            type="button"
                            class="node-menu-item"
                            classList={{ "is-selected": props.subId === s.id }}
                            onClick={(e) => {
                              e.stopPropagation()
                              props.onSchema?.(s.id)
                              props.onSchemaOpen?.(0)
                            }}
                          >
                            {props.subId === s.id ? "✓ " : ""}
                            {s.name}
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </span>
              </Show>
            </div>
            <Show when={loading() && shown()}>
              <div
                class="dyn-subschema-loading"
                style={{ "padding-left": `${8 + (depth() + 1) * 18}px` }}
                role="status"
                aria-live="polite"
              >
                <span class="dyn-subschema-spin" aria-hidden="true" />
                <span class="dyn-subschema-loading-label">
                  {t(props.lang, "loadingSubSchemaForType", { name: props.loadName || "" })}
                </span>
              </div>
            </Show>
            <Show when={node.children.length > 0 && shown() && !loading()}>
              <Tree
                nodes={node.children}
                selected={props.selected}
                onSelect={props.onSelect}
                depth={depth() + 1}
                badge={props.badge}
                counts={props.counts}
                work={props.work}
                force={props.force}
                pulse={props.pulse}
                lang={props.lang}
                expanded={props.expanded}
                onToggle={props.onToggle}
                schemas={props.schemas}
                subId={props.subId}
                schemaOpen={props.schemaOpen}
                onSchemaOpen={props.onSchemaOpen}
                onSchema={props.onSchema}
                schemaLabel={props.schemaLabel}
                loadName={props.loadName}
              />
            </Show>
          </div>
        )
      }}
    </For>
  )
}

function SourceTree(props: {
  nodes: SourceNode[]
  selected: number
  onSelect: (node: SourceNode) => void
  depth?: number
  eads?: Record<string, number>
  jobs?: Record<string, number>
  tests?: Record<string, number>
  mode?: "ead" | "jobs" | "tests" | "none"
  pending?: Record<string, boolean>
  expanded?: string[]
  onExpand?: (path: string, open: boolean) => void
  pulse?: number
  lang: Lang
}) {
  const depth = () => props.depth ?? 0
  const mode = () => props.mode ?? "ead"
  return (
    <For each={props.nodes}>
      {(node) => {
        const controlled = () => Array.isArray(props.expanded)
        const [local, setLocal] = createSignal(depth() < 1)
        const open = () => (controlled() ? props.expanded!.includes(node.nodePath) : local())
        const kids = () => node.children.length > 0
        const ead = () => Number(props.eads?.[String(node.nodeId)] || 0)
        const jobs = () => Number(props.jobs?.[String(node.nodeId)] || 0)
        const tests = () => Number(props.tests?.[String(node.nodeId)] || 0)
        const pending = () => !!props.pending?.[node.nodePath]
        const on = () => props.selected === node.nodeId
        const flash = () => !!props.pulse && props.pulse === node.nodeId
        const toggle = (e: MouseEvent) => {
          e.stopPropagation()
          const next = !open()
          if (controlled() && props.onExpand) {
            props.onExpand(node.nodePath, next)
            return
          }
          setLocal(next)
        }
        return (
          <div>
            <div
              class="source-tree-row"
              classList={{
                actual: on(),
                pending: pending(),
                "refresh-flash": flash(),
              }}
              style={{ "padding-left": `${depth() * 18}px` }}
              title={node.nodePath}
              data-ead-source={node.nodeId}
            >
              <Show when={kids()} fallback={<span class="source-tree-expand-spacer" />}>
                <button type="button" class="source-tree-expand" onClick={toggle}>
                  <IconChevron open={open()} />
                </button>
              </Show>
              <button type="button" class="source-tree-body" onClick={() => props.onSelect(node)}>
                <span class="ead-row-icon">
                  {kids() || depth() === 0 ? <IconFolder /> : <IconFile />}
                </span>
                <span class="name">{node.nodeName}</span>
                <span class="source-tree-badges">
                  <Show when={mode() === "ead"}>
                    <Show when={ead() > 0}>
                      <span class="ead-count-badge">{badgeLabel(props.lang, "ead", ead())}</span>
                    </Show>
                    <Show when={ead() <= 0 && pending()}>
                      <span class="ead-pending-badge">{t(props.lang, "badgePending")}</span>
                    </Show>
                  </Show>
                  <Show when={mode() === "jobs" && jobs() > 0}>
                    <span class="open-job-count-badge">{badgeLabel(props.lang, "job", jobs())}</span>
                  </Show>
                  <Show when={mode() === "tests" && tests() > 0}>
                    <span class="open-test-count-badge">{badgeLabel(props.lang, "test", tests())}</span>
                  </Show>
                </span>
              </button>
            </div>
            <Show when={kids() && open()}>
              <SourceTree
                nodes={node.children}
                selected={props.selected}
                onSelect={props.onSelect}
                depth={depth() + 1}
                eads={props.eads}
                jobs={props.jobs}
                tests={props.tests}
                mode={props.mode}
                pending={props.pending}
                expanded={props.expanded}
                onExpand={props.onExpand}
                pulse={props.pulse}
                lang={props.lang}
              />
            </Show>
          </div>
        )
      }}
    </For>
  )
}

const IconBox = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
    <path d="m3.3 7 8.7 5 8.7-5" />
    <path d="M12 22V12" />
  </svg>
)
const IconFolder = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6A2 2 0 0 1 18.46 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9L11 6h5a2 2 0 0 1 2 2v2" />
  </svg>
)
const IconFolders = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2 2h7.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-10Z" />
    <path d="M7 11h10" />
    <path d="M7 15h6" />
  </svg>
)

function mark(role: ReturnType<typeof productRole>, lang: Lang) {
  if (role === "sibling") {
    return { cls: "product-icon--sibling", title: t(lang, "siblingProduct") }
  }
  if (role === "base") {
    return { cls: "product-icon--base-siblings", title: t(lang, "baseSiblings") }
  }
  return { cls: "product-icon--normal", title: "" }
}

function Choice(props: {
  product: Product
  active: boolean
  lang: Lang
  onPick: (product: Product) => void
}) {
  const role = () => productRole(props.product)
  const meta = () => mark(role(), props.lang)
  return (
    <button
      type="button"
      class={`product-option ${props.active ? "active" : ""}`}
      title={meta().title || undefined}
      onClick={() => props.onPick(props.product)}
    >
      <span class={`product-option-icon ${meta().cls}`} aria-hidden="true">
        <IconBox />
      </span>
      <span class="product-option-label">{props.product.name}</span>
    </button>
  )
}

export function EadMapPanel(props: { sizing: Sizing }) {
  const layout = useLayout()
  const { view } = useSessionLayout()
  const language = useLanguage()
  const ead = useEad()
  const sdk = useSDK()
  const cowork = useCowork()
  const isDesktop = createMediaQuery("(min-width: 768px)")
  const http = () => eadHttp()
  const lang = () => ead.language()
  const tx = (key: Parameters<typeof t>[1], vars?: Record<string, string | number>) => t(lang(), key, vars)

  const opened = layout.pluginPanel.opened(EAD_MAP_ID)
  const width = layout.pluginPanel.width(EAD_MAP_ID)
  const panelOpen = createMemo(() => isDesktop() && opened())
  const reviewOpen = createMemo(() => isDesktop() && view().reviewPanel.opened())
  const panelWidth = createMemo(() => (panelOpen() ? `${width()}px` : "0px"))

  const [products, setProducts] = createSignal<Product[]>([])
  const [groups, setGroups] = createSignal<Group[]>([])
  const [root, setRoot] = createSignal<PfmNode | undefined>()
  const [source, setSource] = createSignal<SourceNode[]>([])
  const [schemas, setSchemas] = createSignal<SubSchema[]>([])
  const [jobIds, setJobIds] = createSignal<Set<number> | undefined>()
  const [baseMapId, setBaseMapId] = createSignal(0)
  const [mapName, setMapName] = createSignal("")
  const [eadCounts, setEadCounts] = createSignal<Record<string, number>>({})
  const [jobCounts, setJobCounts] = createSignal<Record<string, number>>({})
  const [testCounts, setTestCounts] = createSignal<Record<string, number>>({})
  const [pendingPaths, setPendingPaths] = createSignal<Record<string, boolean>>({})
  const [pfmEad, setPfmEad] = createSignal<Record<string, number>>({})
  const [pfmJobs, setPfmJobs] = createSignal<Record<string, number>>({})
  const [pfmTests, setPfmTests] = createSignal<Record<string, number>>({})
  const [hint, setHint] = createSignal<Hint | undefined>()
  const [banner, setBanner] = createSignal<Banner | null>(null)
  const [diag, setDiag] = createSignal(false)
  const [query, setQuery] = createSignal("")
  const [schemaLoad, setSchemaLoad] = createSignal("")
  const [pq, setPq] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [err, setErr] = createSignal("")
  const [user, setUser] = createSignal("")
  const [email, setEmail] = createSignal("")
  const [plans, setPlans] = createSignal<Plan[]>([])
  const [planOn, setPlanOn] = createSignal(true)
  const [userId, setUserId] = createSignal(0)
  const [tenantId, setTenantId] = createSignal(0)
  const [pipelineTick, setPipelineTick] = createSignal(0)
  const [startup, setStartup] = createSignal(readStartup())
  const [menu, setMenu] = createSignal<Menu>("")
  const [dynMenu, setDynMenu] = createSignal(0)
  const [members, setMembers] = createSignal<TeamMember[]>([])
  const [ownerBusy, setOwnerBusy] = createSignal(false)
  const [ownerErr, setOwnerErr] = createSignal("")
  const [pendingOwner, setPendingOwner] = createSignal(false)
  const [multi, setMulti] = createSignal(false)
  const [draftEmails, setDraftEmails] = createSignal<string[]>([])
  const [draftMe, setDraftMe] = createSignal(false)
  const [oq, setOq] = createSignal("")
  const [pulse, setPulse] = createSignal(0)
  const [overlay, setOverlay] = createSignal(false)

  let flashTimer: ReturnType<typeof setTimeout> | undefined
  let pulseTimer: ReturnType<typeof setTimeout> | undefined

  const bumpPipeline = () => {
    setStartup(readStartup())
    setPipelineTick((n) => n + 1)
  }

  const menuOpen = () => !!menu() || dynMenu() > 0

  const pfmBadgeCounts = createMemo(() => {
    const mode = ead.badge()
    if (mode === "jobs") return pfmJobs()
    if (mode === "tests") return pfmTests()
    if (mode === "none") return {} as Record<string, number>
    return pfmEad()
  })

  const pfmFilter = createMemo(() => {
    void ead.mapTick()
    return readPfmFilter(ead.productId())
  })

  const owner = createMemo(() => {
    void ead.mapTick()
    return readOwner(ead.productId())
  })

  const countIds = (counts: Record<string, number>) =>
    new Set(
      Object.entries(counts)
        .filter(([, n]) => n > 0)
        .map(([k]) => Number(k))
        .filter((n) => Number.isFinite(n) && n > 0),
    )

  const pfmVisible = createMemo(() => {
    void ead.mapTick()
    const node = root()
    if (!node) return [] as PfmNode[]
    let nodes = tops(node)
    const jobs = jobIds()
    if (ead.jobsOnly()) {
      const mode = ead.badge()
      if (mode === "ead") {
        const ids = countIds(pfmEad())
        nodes = ids.size ? filterByIds(nodes, ids) : []
      } else if (mode === "tests") {
        const ids = countIds(pfmTests())
        nodes = ids.size ? filterByIds(nodes, ids) : []
      } else if (jobs) {
        nodes = filterByIds(nodes, jobs)
      }
    }
    const filter = readPfmFilter(ead.productId())
    if (filter.active && filter.ids.length) nodes = filterByIds(nodes, new Set(filter.ids))
    return filterPfm(nodes, query())
  })

  const openPath = createMemo(() => pathIds(pfmVisible(), ead.workContextId()))

  const sourceVisible = createMemo(() => {
    void ead.mapTick()
    const filter = readPfmFilter(ead.productId())
    const base = ead.eadsOnly()
      ? filterByCount(source(), eadCounts(), pendingPaths(), true)
      : source()
    const nodes = filter.active ? filterLinkedTree(base, filter.paths) : base
    return filterSource(nodes, query())
  })

  const filtered = createMemo(() => {
    const q = pq().trim().toLowerCase()
    if (!q) return products()
    return products().filter((p) => p.name.toLowerCase().includes(q) || String(p.productId).includes(q))
  })

  const grouped = createMemo(() => {
    const q = pq().trim().toLowerCase()
    return groups().flatMap((g) => {
      const list = q
        ? g.products.filter((p) => p.name.toLowerCase().includes(q) || String(p.productId).includes(q))
        : g.products
      if (!list.length) return []
      return [{ ...g, products: list }]
    })
  })

  const ownerMembers = createMemo(() => {
    const q = oq().trim().toLowerCase()
    if (!q) return members()
    return members().filter(
      (m) => m.label.toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
    )
  })

  const ownerSearchEmpty = () => !!oq().trim() && !ownerMembers().length && members().length > 0

  const ownerMemberGap = () =>
    ownerBusy() || ead.productId() <= 0 || !members().length || !ead.token() || !!ownerErr()

  const ownerEmptyMsg = () => {
    if (ownerBusy()) return tx("loading")
    if (ead.productId() <= 0) return tx("ownerNoProduct")
    if (!ead.token()) return tx("ownerAuthRequired")
    if (ownerErr()) return ownerErr()
    return tx("ownerNoMembers")
  }

  const ownerAllSelected = () => {
    const all = members().map((m) => m.email)
    return (
      draftMe() &&
      draftEmails().length === all.length &&
      all.every((e) => draftEmails().includes(e))
    )
  }

  const diagSteps = createMemo(() => {
    void pipelineTick()
    return readDiag()
  })

  const diagFail = createMemo(() => !!err() || diagSteps().some((s) => !s.ok))

  const diagOk = createMemo(() => diagSteps().length > 0 && diagSteps().every((s) => s.ok) && !err())

  const schemaType = createMemo(() => {
    const sid = ead.subSchemaId()
    if (sid <= 0) return ""
    return schemas().find((s) => s.id === sid)?.name || `#${sid}`
  })

  const hasSource = createMemo(() => ead.schemaId() > 0)

  const sourceOpts = () => ({
    productId: ead.productId() || undefined,
    productName: ead.productName() || undefined,
    sourceId: ead.sourceId() || undefined,
    sourcePath: ead.sourcePath() || undefined,
    sourceName: ead.sourceName() || undefined,
  })

  const linkedUnder = (paths: string[], folder: string) => {
    const root = folder.replace(/\/+$/, "")
    if (!root) return []
    return paths.filter((p) => p === root || p.startsWith(`${root}/`))
  }

  const folder = () => {
    const dir = String(sdk.directory || "").replace(/[/\\]+$/, "")
    const parts = dir.split(/[/\\]/).filter(Boolean)
    return parts[parts.length - 1] || ""
  }

  const flash = (kind: Banner["kind"], text: string) => {
    setBanner({ kind, text })
    if (flashTimer) clearTimeout(flashTimer)
    if (kind !== "ok") return
    flashTimer = setTimeout(() => setBanner(null), 2500)
  }

  const closeMenus = () => {
    setMenu("")
    setDynMenu(0)
  }

  const bump = () => {
    ead.bumpMap()
  }

  const launch = (action: Parameters<typeof queuePilot>[0]) => {
    queuePilot(action)
    openPilot(layout.pluginPanel)
  }

  const clearCounts = () => {
    setEadCounts({})
    setJobCounts({})
    setTestCounts({})
    setPendingPaths({})
    setPfmEad({})
    setPfmJobs({})
    setPfmTests({})
  }

  const persistRun = () => {
    const token = ead.token()
    const sid = ead.schemaId()
    if (!token || sid <= 0 || userId() <= 0 || tenantId() <= 0) return
    void saveRunPrefs(
      token,
      userId(),
      tenantId(),
      sid,
      {
        showEadCount: ead.badge() === "ead",
        showOpenJobs: ead.badge() === "jobs",
        showOpenTests: ead.badge() === "tests",
        eadsOnlyFilter: ead.eadsOnly(),
      },
      http(),
    )
  }

  const toggleBadge = (next: "ead" | "jobs" | "tests") => {
    ead.setBadge(ead.badge() === next ? "none" : next)
    persistRun()
    setMenu("")
  }

  const jobTitle = () => {
    const badge =
      ead.badge() === "ead"
        ? tx("badgeEadCount")
        : ead.badge() === "jobs"
          ? tx("badgeOpenJobs")
          : ead.badge() === "tests"
            ? tx("badgeOpenTests")
            : tx("badgeNone")
    const scope = ead.jobsOnly() ? tx("scopeFiltered") : tx("scopeAll")
    return `${tx("jobFilterPrefix")}${badge} · ${scope}`
  }

  const fillPaths = async (ids: number[], pid: number) => {
    const token = ead.token()
    if (!token || !ids.length) return [] as string[]
    const paths = await loadSubtreePaths(token, ids, http())
    writePfmFilter(ids, true, paths, pid)
    bump()
    return paths
  }

  const hydrateSourcePref = async (sid: number, token: string) => {
    const cached = ead.sourcePref(sid)
    if (cached) {
      if (sid === ead.schemaId() || ead.schemaId() <= 0) {
        ead.setBadge(cached.badge)
        ead.setEadsOnly(cached.eadsOnly)
      }
      return cached.eadsOnly
    }
    if (userId() > 0 && tenantId() > 0) {
      const remote = await loadRunPrefs(token, userId(), tenantId(), sid, http())
      if (remote) {
        const badge = remote.showOpenJobs ? "jobs" : remote.showOpenTests ? "tests" : "ead"
        const only = remote.eadsOnlyFilter !== false
        ead.setSourcePref(sid, { badge, eadsOnly: only })
        if (sid === ead.schemaId() || ead.schemaId() <= 0) {
          ead.setBadge(badge)
          ead.setEadsOnly(only)
        }
        return only
      }
    }
    return ead.eadsOnly()
  }

  const fetchSourceBundle = (token: string, pid: number, sid: number, only: boolean, syncFlag: boolean) =>
    only ? loadLinkedBundle(token, pid, sid, http(), syncFlag) : loadFullBundle(token, pid, sid, http(), syncFlag)

  const loadSource = async (sync = false) => {
    const token = ead.token()
    const pid = ead.productId()
    if (!token || pid <= 0) {
      setSource([])
      clearCounts()
      loadedSchema = 0
      return
    }
    const schema = await loadSourceSchema(token, pid, http())
    if (!schema) {
      setSource([])
      clearCounts()
      ead.setSchema(0, "")
      loadedSchema = 0
      return
    }
    ead.setSchema(schema.schemaId, schema.name)
    let rows: Array<Record<string, unknown>> = []
    let used = schema.schemaId
    let eads: Record<string, number> = {}
    let jobs: Record<string, number> = {}
    let tests: Record<string, number> = {}
    let pending: Record<string, boolean> = {}
    let defaults: string[] = []
    let only = ead.eadsOnly()
    for (const sid of schema.candidates) {
      only = await hydrateSourcePref(sid, token)
      const bundle = await fetchSourceBundle(token, pid, sid, only, sync)
      if (bundle.nodes.length) {
        used = sid
        rows = bundle.nodes
        eads = bundle.eadCountByNodeId
        jobs = bundle.openJobCountByNodeId
        tests = bundle.openTestCaseCountByNodeId
        pending = bundle.pendingEadByNodePath
        defaults = bundle.expandByDefaultPaths
        break
      }
    }
    if (!rows.length && !sync) {
      for (const sid of schema.candidates) {
        only = ead.sourcePref(sid)?.eadsOnly ?? ead.eadsOnly()
        const bundle = await fetchSourceBundle(token, pid, sid, only, true)
        if (bundle.nodes.length) {
          used = sid
          rows = bundle.nodes
          eads = bundle.eadCountByNodeId
          jobs = bundle.openJobCountByNodeId
          tests = bundle.openTestCaseCountByNodeId
          pending = bundle.pendingEadByNodePath
          defaults = bundle.expandByDefaultPaths
          break
        }
      }
    }
    if (used !== schema.schemaId) ead.setSchema(used, schema.name)
    const filter = readPfmFilter(pid)
    if (filter.active && filter.ids.length && !filter.paths.length) {
      const paths = await loadSubtreePaths(token, filter.ids, http())
      writePfmFilter(filter.ids, true, paths, pid)
    }
    const active = readPfmFilter(pid)
    if (active.active && active.ids.length) {
      const parsed = parseRows(rows)
      const linked = await Promise.all(
        active.ids.map(async (nid) => ({ nodeId: nid, paths: await loadLinkPaths(token, nid, http()) })),
      )
      const raw = await loadPfmEadCounts(token, active.ids, http())
      const byPfm: Record<number, number> = {}
      for (const [key, value] of Object.entries(raw)) {
        const n = Number(key)
        if (Number.isFinite(n) && n > 0) byPfm[n] = value
      }
      const byPath = filteredCounts(
        parsed.map((row) => row.nodePath),
        linked.filter((n) => n.paths.length),
        byPfm,
      )
      if (Object.keys(byPath).length) {
        eads = idCounts(parsed, byPath)
      } else {
        const kept = filterLinked(parsed, active.paths)
        const fallback: Record<string, number> = {}
        for (const row of kept) {
          const n = eads[String(row.nodeId)]
          if (n > 0) fallback[row.nodePath] = n
        }
        eads = idCounts(kept, fallback)
      }
    }
    setEadCounts(eads)
    setJobCounts(jobs)
    setTestCounts(tests)
    setPendingPaths(pending)
    const tree = buildTree(filterDisplay(parseRows(rows)))
    setSource(tree)
    const schemaChanged = used !== loadedSchema
    if (schemaChanged && userId() > 0 && tenantId() > 0) {
      const remote = await loadSourceExpanded(token, userId(), tenantId(), used, http())
      if (remote?.length) ead.setExpanded(used, pruneExpanded(remote, tree))
    }
    const selected = ead.sourcePath()
    let paths = computeExpanded({
      saved: ead.expanded(used),
      roots: tree,
      expandByDefaultPaths: only ? defaults : undefined,
      selectedPath: selected,
      eadCountByNodeId: eads,
    })
    if (selected) {
      paths = mergeExpanded(paths, tree, [...ancestorPaths(selected), selected])
    }
    if (schemaChanged || !ead.expanded(used).length) ead.setExpanded(used, paths)
    loadedSchema = used
  }

  const scopeSource = (only: boolean) => {
    ead.setEadsOnly(only)
    persistRun()
    closeMenus()
    void loadSource(only)
  }

  let gen = 0
  let lastCue = ""
  let lastAt = 0
  let loadedSchema = 0
  let expandTimer: ReturnType<typeof setTimeout> | undefined

  let retries = 0
  let retrying: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(retrying))
  // Coming back online after a dropped connection reloads a map that failed to load.
  const online = () => {
    if (!panelOpen() || !err() || !offline(err())) return
    retries = 0
    void refresh({ soft: true })
  }
  window.addEventListener("online", online)
  onCleanup(() => window.removeEventListener("online", online))

  const refresh = async (opts?: { soft?: boolean; syncLinked?: boolean }) => {
    const soft = opts?.soft === true
    // Soft poll must not cancel an in-flight full refresh (that left the loading banner stuck).
    if (soft && (busy() || schemaLoad())) return
    const run = ++gen
    const live = () => run === gen
    const token = ead.token()
    beginDiag()
    noteDiag("Startup", true, soft ? "Soft refresh" : "Loading product list from API")
    if (!token) {
      if (!overlay()) {
        setProducts([])
        setGroups([])
        setRoot(undefined)
        setSource([])
        setSchemas([])
        setJobIds(undefined)
        setBaseMapId(0)
        setMapName("")
        clearCounts()
        setUser("")
        setEmail("")
        setPlans([])
        setUserId(0)
        setTenantId(0)
        setHint(undefined)
        setBanner(null)
      }
      lastCue = ""
      lastAt = Date.now()
      bumpPipeline()
      return
    }
    if (!soft) {
      if (!schemaLoad()) {
        setBusy(true)
        setErr("")
        flash("loading", tx("refreshing"))
      }
    }
    try {
      const fetcher = http()
      const profile = await me(token, fetcher)
      if (!live()) return
      setEmail(String(profile?.email || ""))
      setUser(String(profile?.name || profile?.userName || profile?.email || tx("signedIn")))
      setUserId(profile.userId)
      setTenantId(profile.tenantId)
      noteDiag("Auth", true, profile.email || profile.userName || "ok")
      void loadPlans(token, fetcher).then((list) => {
        if (!live()) return
        const before = plans().map((item) => item.name).join(",")
        setPlans(list)
        // A plan added or removed on the team account reaches the model picker without signing in again.
        if (list.map((item) => item.name).join(",") !== before) ead.refreshPlans()
      })
      const catalog = await loadCatalog(token, fetcher)
      if (!live()) return
      setProducts(catalog.products)
      setGroups(catalog.groups)
      noteDiag("Products", true, `${catalog.products.length} products, ${catalog.groups.length} groups`)
      const pid = ead.productId()
      if (pid <= 0) {
        setRoot(undefined)
        setSource([])
        setSchemas([])
        setJobIds(undefined)
        setBaseMapId(0)
        setMapName("")
        clearCounts()
        const hit = await suggestProduct(token, catalog.products, folder(), fetcher)
        if (!live()) return
        setHint(hit ? { productId: hit.productId, name: hit.name } : undefined)
        noteDiag("Load complete", true, "No product selected")
        lastCue = ""
        lastAt = Date.now()
        bumpPipeline()
        if (!soft) flash("ok", tx("refreshed"))
        return
      }
      setHint(undefined)
      const selected = catalog.products.find((p) => p.productId === pid)
      if (!selected) {
        setRoot(undefined)
        setSource([])
        setSchemas([])
        setJobIds(undefined)
        setBaseMapId(0)
        setMapName("")
        clearCounts()
        noteDiag("Load complete", true, "Selected product missing")
        lastCue = ""
        lastAt = Date.now()
        bumpPipeline()
        if (!soft) flash("ok", tx("refreshed"))
        return
      }
      if (selected.name && selected.name !== ead.productName()) {
        ead.setProduct(selected.productId, selected.name)
      }
      const sub = ead.subSchemaId()
      const map = await loadActiveMap(token, selected.productId, fetcher, sub > 0 ? sub : undefined)
      if (!live()) return
      let openIds: Set<number> | undefined
      if (map.mapId > 0) {
        openIds = new Set(await loadOpenFilterNodeIds(token, map.mapId, fetcher))
        if (!live()) return
      }
      let eads: Record<string, number> = {}
      let jobs: Record<string, number> = {}
      let tests: Record<string, number> = {}
      if (map.root) {
        const ids = collectIds([map.root])
        const [a, b, c] = await Promise.all([
          loadPfmEadCounts(token, ids, fetcher),
          loadPfmJobCounts(token, ids, fetcher),
          loadPfmTestCounts(token, ids, fetcher),
        ])
        if (!live()) return
        eads = rollupCounts([map.root], a)
        jobs = rollupCounts([map.root], b)
        tests = rollupCounts([map.root], c)
      }
      if (ead.view() === "source" || opts?.syncLinked === true) {
        await loadSource(opts?.syncLinked === true)
      } else {
        const schema = await loadSourceSchema(token, selected.productId, fetcher).catch(() => undefined)
        if (!live()) return
        if (schema) ead.setSchema(schema.schemaId, schema.name)
        else ead.setSchema(0, "")
      }
      if (!live()) return
      const filter = readPfmFilter(selected.productId)
      const next = cue({
        pid: selected.productId,
        schema: ead.schemaId(),
        view: ead.view(),
        map: map.mapName || map.root?.name || "",
        sibling: map.baseMapId > 0,
        support: map.supportSubSchemas,
        sub: ead.subSchemaId(),
        types: map.schemas,
        filter: filter.active ? filter.ids : [],
        paths: filter.paths,
        eadsOnly: ead.eadsOnly(),
        nodes: map.root ? tops(map.root) : [],
        files: source(),
        products: catalog.products,
      })
      lastAt = Date.now()
      if (soft && next === lastCue) {
        noteDiag("Load complete", true, "unchanged")
        bumpPipeline()
        return
      }
      lastCue = next
      ead.setMapId(map.mapId)
      setRoot(map.root)
      setBaseMapId(map.baseMapId)
      setMapName(map.mapName || map.root?.name || (map.mapId > 0 ? `Map ${map.mapId}` : ""))
      noteDiag("Map", true, `mapId=${map.mapId} name=${map.mapName || map.root?.name || "-"}`)
      setSchemas(map.schemas)
      setJobIds(openIds)
      setPfmEad(eads)
      setPfmJobs(jobs)
      setPfmTests(tests)
      noteDiag(
        "Load complete",
        true,
        `PFM nodes: ${map.root ? collectIds([map.root]).length : 0}, view: ${ead.view()}`,
      )
      const count =
        ead.view() === "source"
          ? source().length
          : map.root
            ? collectIds([map.root]).length
            : 0
      retries = 0
      markStartup(tx("refreshComplete", { count: String(count) }), "ok")
      bumpPipeline()
      if (!soft) flash("ok", tx("refreshed"))
    } catch (e) {
      if (!live()) return
      const msg = e instanceof Error ? e.message : String(e)
      noteDiag("Error", false, msg)
      bumpPipeline()
      lastCue = ""
      lastAt = Date.now()
      if (msg === "AUTH_EXPIRED") {
        // An expired-but-renewable login comes back with a new token, which reruns this load.
        if (tokenExpired(token) && (await ead.renew(token))) return
        if (!live()) return
        ead.clearToken()
        setOverlay(true)
        setUser("")
        setEmail("")
        setPlans([])
        setUserId(0)
        setTenantId(0)
        setHint(undefined)
        setErr(tx("expired"))
        if (!soft) flash("error", tx("expired"))
        return
      }
      setErr(msg)
      if (!soft) flash("error", msg)
      // A dropped connection is retried soon instead of leaving "Load failed" up until the next click.
      if (offline(msg) && retries < 5) {
        retries++
        clearTimeout(retrying)
        retrying = setTimeout(() => {
          if (panelOpen()) void refresh({ soft: true })
        }, 2000 * retries)
      }
      if (!schemaLoad()) {
        setRoot(undefined)
        setSource([])
        setSchemas([])
        setJobIds(undefined)
        setBaseMapId(0)
        setMapName("")
        clearCounts()
      }
    } finally {
      if (!live()) return
      if (!soft) setBusy(false)
      if (schemaLoad()) setSchemaLoad("")
      // Soft refresh bumps gen and can supersede a non-soft run that left the loading banner up.
      if (banner()?.kind === "loading") setBanner(null)
    }
  }

  createEffect(() => {
    if (!panelOpen()) return
    void ead.token()
    void ead.productId()
    void ead.subSchemaId()
    void refresh()
  })

  let linked = ""
  createEffect(() => {
    const token = ead.token().trim()
    const dir = sdk.directory
    if (!token || !dir) {
      linked = ""
      return
    }
    const key = `${dir}\0${token}`
    if (linked === key) return
    linked = key
    const entry = untrack(() => ead.mcpEntry())
    void (async () => {
      let err: unknown
      for (let i = 0; i < 4; i++) {
        if (linked !== key) return
        try {
          const path = await ensureEadMcp({
            client: sdk.client,
            token,
            entry,
            worktree: dir,
          })
          if (linked !== key) return
          if (path) ead.setMcpEntry(path)
          return
        } catch (e) {
          err = e
          if (i < 3) await new Promise((r) => setTimeout(r, 800))
        }
      }
      if (linked !== key) return
      showToast({
        title: "MCP",
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      })
    })()
  })

  createEffect(() => {
    if (!panelOpen()) return
    const n = ead.treeTick()
    if (!(n > 0)) return
    void refresh({ syncLinked: true })
  })

  createEffect(() => {
    if (!panelOpen()) return
    const tick = () => {
      if (!ead.token()) return
      if (Date.now() - lastAt < SOFT_GAP) return
      void refresh({ soft: true })
    }
    const timer = window.setInterval(tick, SOFT_GAP)
    onCleanup(() => window.clearInterval(timer))
  })

  createEffect(() => {
    const open = menu()
    const dyn = dynMenu()
    if (!open && !dyn) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      closeMenus()
    }
    document.addEventListener("keydown", onKey)
    if (open === "coding") {
      onCleanup(() => document.removeEventListener("keydown", onKey))
      return
    }
    const onDoc = (e: Event) => {
      const el = e.target
      if (!(el instanceof Element)) return
      if (el.closest("[data-ead-menu]")) return
      closeMenus()
    }
    document.addEventListener("pointerdown", onDoc, true)
    onCleanup(() => {
      document.removeEventListener("pointerdown", onDoc, true)
      document.removeEventListener("keydown", onKey)
    })
  })

  onCleanup(() => {
    if (flashTimer) clearTimeout(flashTimer)
    if (pulseTimer) clearTimeout(pulseTimer)
  })

  const applyContext = async (nodeId: number, nodeName: string, type: "pfm" | "source") => {
    const token = ead.token()
    if (!token) return
    setBusy(true)
    setErr("")
    try {
      const ctx = await loadContext(token, nodeId, nodeName, http(), type)
      ead.setContext({
        nodeName: ctx.nodeName,
        eadScript: ctx.eadScript,
        aiPrompt: ctx.aiPrompt,
        markdown: ctx.markdown,
      })
    } catch (e) {
      ead.clearContext()
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Shares the loaded map with global search, and selects nodes it asks for.
  createEffect(() => {
    const node = root()
    if (!node) {
      ead.setNodes([])
      return
    }
    const walk = (list: PfmNode[], trail: string[]): EadNodeHit[] =>
      list.flatMap((item) => [
        ...(item.nodeId > 0 ? [{ id: item.nodeId, name: item.name, path: trail.join(" / ") }] : []),
        ...walk(item.children, [...trail, item.name]),
      ])
    ead.setNodes(walk(node.children, []))
  })

  createEffect(() => {
    const jump = ead.jump()
    const node = root()
    if (!jump || !node) return
    untrack(() => {
      const find = (list: PfmNode[]): PfmNode | undefined =>
        list.reduce<PfmNode | undefined>((hit, item) => hit ?? (item.nodeId === jump.id ? item : find(item.children)), undefined)
      const hit = find([node])
      if (!hit) return
      selectNode(hit)
      ead.bumpMap()
    })
  })

  const selectNode = (node: PfmNode) => {
    closeMenus()
    ead.setNode(node.nodeId, node.name)
    if (layout.pluginPanel.opened(EAD_PILOT_ID)()) {
      queuePilot({
        kind: "pfm",
        nodeId: node.nodeId,
        nodeName: node.name,
      })
    }
    void applyContext(node.nodeId, node.name, "pfm")
  }

  const selectSource = (node: SourceNode) => {
    closeMenus()
    ead.setSource(node.nodeId, node.nodeName, node.nodePath)
    const token = ead.token()
    const sid = ead.schemaId()
    if (token && sid > 0) void selectSourcePath(token, sid, node.nodePath, http())
    if (layout.pluginPanel.opened(EAD_PILOT_ID)()) {
      queuePilot({
        kind: "source",
        sourceId: node.nodeId,
        sourcePath: node.nodePath,
        sourceName: node.nodeName,
        linkedPaths: linkedUnder(pfmFilter().paths, node.nodePath),
      })
    }
    void applyContext(node.nodeId, node.nodeName, "source")
  }

  const onExpand = (path: string, open: boolean) => {
    const sid = ead.schemaId()
    if (sid <= 0) return
    const prev = ead.expanded(sid)
    const next = open ? [...new Set([...prev, path])] : prev.filter((p) => p !== path)
    ead.setExpanded(sid, next)
    if (expandTimer) clearTimeout(expandTimer)
    expandTimer = setTimeout(() => {
      const token = ead.token()
      if (!token || userId() <= 0 || tenantId() <= 0) return
      void saveSourceExpanded(token, userId(), tenantId(), sid, ead.expanded(sid), http())
    }, 400)
  }

  const pfmExpandKey = () => expandKey(ead.productId(), ead.mapId(), ead.subSchemaId())

  const pfmExpandedIds = createMemo(() => {
    const key = pfmExpandKey()
    const saved = ead.pfmExpanded(key)
    if (saved !== undefined) return saved
    const nodes = pfmVisible()
    return nodes.length ? seedOpen(nodes) : []
  })

  const onPfmToggle = (id: number, open: boolean) => {
    const key = pfmExpandKey()
    const prev = ead.pfmExpanded(key) ?? seedOpen(pfmVisible())
    const next = open ? [...new Set([...prev, id])] : prev.filter((n) => n !== id)
    ead.setPfmExpanded(key, next)
  }

  const ring = (id: number) => {
    setPulse(id)
    if (pulseTimer) clearTimeout(pulseTimer)
    pulseTimer = setTimeout(() => {
      setPulse((cur) => (cur === id ? 0 : cur))
    }, 1600)
  }

  createEffect(() => {
    if (!panelOpen()) return
    const tick = ead.mapTick()
    if (!(tick > 0)) return
    const nid = ead.nodeId()
    const sid = ead.sourceId()
    untrack(() => {
      if (nid > 0) {
        if (ead.view() !== "pfm") ead.setView("pfm")
        const nodes = pfmVisible()
        const trail = pathIds(nodes, nid)
        const key = pfmExpandKey()
        const prev = ead.pfmExpanded(key) ?? seedOpen(nodes)
        const next = [...new Set([...prev, ...trail, nid])]
        if (next.length !== prev.length || next.some((id) => !prev.includes(id))) {
          ead.setPfmExpanded(key, next)
        }
        ring(nid)
        queueMicrotask(() => {
          document.querySelector(`[data-ead-node="${nid}"]`)?.scrollIntoView({ block: "nearest" })
        })
        return
      }
      if (!(sid > 0)) return
      if (ead.view() !== "source") ead.setView("source")
      const schema = ead.schemaId()
      const trail = pathTrail(sourceVisible(), sid)
      if (schema > 0 && trail.length) {
        const prev = ead.expanded(schema)
        const next = [...new Set([...prev, ...trail])]
        if (next.length !== prev.length || next.some((path) => !prev.includes(path))) {
          ead.setExpanded(schema, next)
        }
      }
      ring(sid)
      queueMicrotask(() => {
        document.querySelector(`[data-ead-source="${sid}"]`)?.scrollIntoView({ block: "nearest" })
      })
    })
  })

  const openHelp = (tipId: TipId) => {
    closeMenus()
    launch({ kind: "help", tipId })
  }

  const pickSchema = (id: number) => {
    if (!(id > 0) || id === ead.subSchemaId()) return
    const name = schemas().find((s) => s.id === id)?.name || ""
    setSchemaLoad(name)
    const next = (() => {
      const cur = root()
      if (!cur) return cur
      return {
        ...cur,
        children: (cur.children || []).map((n) =>
          n.isDynamicTopLevel ? { ...n, name: name || n.name, children: [] } : n,
        ),
      }
    })()
    if (next) {
      setRoot(next)
      const dyn = next.children.find((n) => n.isDynamicTopLevel)
      if (dyn) {
        const key = pfmExpandKey()
        const prev = ead.pfmExpanded(key) ?? seedOpen(pfmVisible())
        ead.setPfmExpanded(key, [...new Set([...prev, dyn.nodeId])])
      }
    }
    ead.setSubSchema(id)
    closeMenus()
  }

  const afterAuth = async (token: string) => {
    ead.setToken(token)
    setOverlay(false)
    await refresh()
    const entry = await ensureEadMcp({
      client: sdk.client,
      token,
      entry: ead.mcpEntry(),
      worktree: sdk.directory,
    }).catch((e) => {
      showToast({
        title: "MCP",
        description: e instanceof Error ? e.message : String(e),
        variant: "error",
      })
      return ""
    })
    if (entry) ead.setMcpEntry(entry)
    ead.bumpPilot()
    if (!pendingOwner()) return
    setPendingOwner(false)
    if (!readOwner(ead.productId()).enabled) return
    setMenu("owner")
    const cur = readOwner(ead.productId())
    setMulti(false)
    setOq("")
    setDraftMe(!!cur.includeMe && cur.active)
    setDraftEmails(
      cur.memberEmails.length ? [...cur.memberEmails] : cur.memberEmail ? [cur.memberEmail] : [],
    )
    await loadOwnerMembers()
  }

  const onSignOut = () => {
    void clearEadMcp({
      client: sdk.client,
      entry: ead.mcpEntry(),
      worktree: sdk.directory,
    }).catch(() => undefined)
    ead.signOut()
    ead.bumpPilot()
    setOverlay(false)
    setProducts([])
    setGroups([])
    setRoot(undefined)
    setSource([])
    setSchemas([])
    setJobIds(undefined)
    setBaseMapId(0)
    setMapName("")
    clearCounts()
    setUser("")
    setEmail("")
    setPlans([])
    setHint(undefined)
    setBanner(null)
    setQuery("")
    setErr("")
    closeMenus()
  }

  const switchView = async (view: "pfm" | "source") => {
    if (view === "source") {
      if (!hasSource()) {
        const token = ead.token()
        const pid = ead.productId()
        if (token && pid > 0) {
          const schema = await loadSourceSchema(token, pid, http()).catch(() => undefined)
          if (schema) ead.setSchema(schema.schemaId, schema.name)
        }
      }
      if (!hasSource()) return
    }
    ead.setView(view)
    setQuery("")
    closeMenus()
    if (view !== "source") return
    setBusy(true)
    setErr("")
    try {
      await loadSource()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setSource([])
      clearCounts()
    } finally {
      setBusy(false)
    }
  }

  const askEdit = () => {
    closeMenus()
    launch({ kind: "editProduct" })
  }

  const askProfile = () => {
    closeMenus()
    launch({ kind: "profile" })
  }

  const loadOwnerMembers = async () => {
    setOwnerBusy(true)
    setOwnerErr("")
    const token = ead.token()
    const pid = ead.productId()
    if (!token) {
      setMembers([])
      setOwnerBusy(false)
      return
    }
    if (pid <= 0) {
      setMembers([])
      setOwnerBusy(false)
      return
    }
    try {
      setMembers(await loadTeamMembers(token, pid, http()))
    } catch (e) {
      setOwnerErr(e instanceof Error ? e.message : String(e))
      setMembers([])
    } finally {
      setOwnerBusy(false)
    }
  }

  const openOwner = async () => {
    const next = menu() === "owner" ? "" : "owner"
    setMenu(next)
    if (next !== "owner") return
    const cur = owner()
    setMulti(false)
    setOq("")
    setDraftMe(!!cur.includeMe && cur.active)
    setDraftEmails(cur.memberEmails.length ? [...cur.memberEmails] : cur.memberEmail ? [cur.memberEmail] : [])
    await loadOwnerMembers()
  }

  const openOwnerSignIn = () => {
    setPendingOwner(true)
    closeMenus()
    setOverlay(true)
  }

  const writeOwnerChoice = (next: Parameters<typeof writeOwner>[1]) => {
    const pid = ead.productId()
    if (pid <= 0) return
    writeOwner(pid, next)
    bump()
  }

  const applyOwner = () => {
    const mails = draftEmails()
    const meOn = draftMe()
    if (!mails.length && !meOn) {
      writeOwnerChoice({
        active: false,
        memberEmail: "",
        memberLabel: "",
        memberEmails: [],
        includeMe: false,
      })
    } else if (!mails.length && meOn) {
      writeOwnerChoice({
        active: true,
        memberEmail: "",
        memberLabel: "",
        memberEmails: [],
        includeMe: true,
      })
    } else if (mails.length === 1 && !meOn) {
      const mail = mails[0]!
      const hit = members().find((m) => m.email === mail)
      writeOwnerChoice({
        active: true,
        memberEmail: mail,
        memberLabel: hit?.label || mail,
        memberEmails: [mail],
        includeMe: false,
      })
    } else {
      const first = mails[0] || ""
      const hit = members().find((m) => m.email === first)
      writeOwnerChoice({
        active: true,
        memberEmail: first,
        memberLabel: hit?.label || first,
        memberEmails: mails,
        includeMe: meOn,
      })
    }
    closeMenus()
  }

  const pickProduct = (product: Product) => {
    setHint(undefined)
    ead.setProduct(product.productId, product.name)
    setMenu("")
    setPq("")
    void refresh()
  }

  // The product follows the current project repo: when the chosen product doesn't have the repo, switch to the one
  // that does (the product Pilot links to the project first).
  createEffect(() => {
    const found = ead.place(cowork.repoOf(sdk.directory), [ead.productId(), cowork.productOf(sdk.directory) ?? 0])
    if (!found || found.product.productId === ead.productId()) return
    untrack(() => pickProduct({ productId: found.product.productId, name: found.product.name }))
  })

  const planName = (item: Plan) => {
    const extra = item.model.trim() || item.suffix.trim()
    return extra ? `${item.label} · ${extra}` : item.label
  }

  const planTip = (item: Plan) => {
    const blank = tx("eadCodingPlanSlotEmpty")
    const row = item.slots
    return [
      `${tx("eadCodingPlanSlotEasy")}: ${row.easy || blank}`,
      `${tx("eadCodingPlanSlotReasoning")}: ${row.reasoning || blank}`,
      `${tx("eadCodingPlanSlotAdvanced")}: ${row.advanced || blank}`,
      `${tx("eadCodingPlanSlotVision")}: ${row.vision || blank}`,
    ].join("\n")
  }

  const submitPlan = () => {
    if (!ead.token() || planOn() === ead.coding()) return
    ead.setCoding(planOn())
    closeMenus()
  }

  return (
    <Show when={isDesktop()}>
      <aside
        data-ead-map
        aria-label="EAD Map"
        aria-hidden={!panelOpen()}
        inert={!panelOpen()}
        class="relative min-w-0 h-full flex shrink-0 overflow-hidden"
        classList={{
          "pointer-events-none": !panelOpen(),
          "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
            !props.sizing.active(),
        }}
        style={{ width: panelWidth() }}
      >
        <div class="ead-shell size-full flex flex-col min-h-0">
          <div class="ead-titlebar">
            <span class="ead-titlebar-title truncate">{tx("title")}</span>
            <div class="ead-titlebar-actions">
              <button
                type="button"
                class="ead-icon-btn"
                onClick={() => layout.pluginPanel.close(EAD_MAP_ID)}
                aria-label={language.t("common.close")}
              >
                <IconClose />
              </button>
            </div>
          </div>

          <div class="navigator-content">
            <Show when={menu() === "product"}>
              <div class="product-menu-scrim" onClick={() => closeMenus()} />
            </Show>
            <Show when={!ead.token()}>
              <div class="login-panel" classList={{ "login-panel--overlay": overlay() }}>
                <EadSignInCard onSignedIn={afterAuth} message={err()} />
              </div>
            </Show>
            <Show when={ead.token() || overlay()}>
              <div class="navigator-chrome" classList={{ "is-product-open": menu() === "product" }}>
                <div
                  class="product-wrap"
                  classList={{
                    "product-wrap--menu-open": menu() === "product" || menu() === "schema",
                    "product-wrap--user-menu-open": menu() === "user" || menu() === "lang",
                    "product-wrap--ead-plan-open": menu() === "coding",
                  }}
                >
                  <div class="product-label-row">
                    <span class="ead-label">{tx("selectProduct")}</span>
                    <div class="product-label-actions" data-ead-menu>
                      <button
                        type="button"
                        class="ead-map-icon-btn"
                        disabled={ead.productId() <= 0 || ead.mapId() <= 0}
                        title={
                          ead.productId() > 0 && ead.mapId() > 0 ? tx("aiPilotDashboardTooltip") : tx("aiPilotDisabled")
                        }
                        aria-label={tx("aiPilotDashboard")}
                        onClick={() => {
                          closeMenus()
                          launch({ kind: "dashboard" })
                        }}
                      >
                        <IconSpark />
                      </button>
                      <div class="ead-plan-menu-wrap">
                        <button
                          type="button"
                          class="ead-map-icon-btn ead-plan-btn"
                          classList={{ open: menu() === "coding", "is-on": ead.coding() }}
                          title={tx("eadCodingPlanTitle")}
                          aria-label={tx("eadCodingPlanTitle")}
                          aria-haspopup="dialog"
                          aria-expanded={menu() === "coding"}
                          aria-controls="ead-plan-modal"
                          onClick={() => {
                            if (menu() === "coding") {
                              closeMenus()
                              return
                            }
                            setPlanOn(ead.coding())
                            setMenu("coding")
                          }}
                        >
                          <IconChip />
                        </button>
                      </div>
                      <div
                        class="nav-user-menu-wrap"
                        classList={{ "is-open": menu() === "user" || menu() === "lang" }}
                        data-ead-menu
                      >
                        <button
                          type="button"
                          class="ead-icon-btn nav-user-menu-btn"
                          classList={{ open: menu() === "user" || menu() === "lang" }}
                          aria-label={tx("menu")}
                          aria-haspopup="menu"
                          aria-expanded={menu() === "user" || menu() === "lang"}
                          onClick={() => setMenu(menu() === "user" ? "" : "user")}
                        >
                          <IconMenu />
                        </button>
                        <Show when={menu() === "user" || menu() === "lang"}>
                          <ul class="nav-user-menu" role="menu">
                            <li role="none">
                              <button
                                type="button"
                                role="menuitem"
                                class="nav-user-menu-item"
                                onClick={() => {
                                  closeMenus()
                                  void refresh({ syncLinked: true })
                                }}
                              >
                                {tx("refreshMap")}
                              </button>
                            </li>
                            <li role="none" class="nav-user-menu-sep" aria-hidden="true" />
                            <li role="none">
                              <button
                                type="button"
                                role="menuitem"
                                class="nav-user-menu-item"
                                disabled={ead.productId() <= 0}
                                onClick={askEdit}
                              >
                                {tx("editProduct")}
                              </button>
                            </li>
                            <li role="none" class="nav-user-menu-sep" aria-hidden="true" />
                            <li role="none">
                              <button
                                type="button"
                                role="menuitem"
                                class="nav-user-menu-item"
                                onClick={askProfile}
                              >
                                {tx("profile")}
                              </button>
                            </li>
                            <li role="none" class="nav-user-menu-sep" aria-hidden="true" />
                            <li role="none">
                              <button
                                type="button"
                                role="menuitem"
                                class="nav-user-menu-item"
                                aria-haspopup="menu"
                                aria-expanded={menu() === "lang"}
                                onClick={() => setMenu(menu() === "lang" ? "user" : "lang")}
                              >
                                <span>{tx("language")}</span>
                                <span class="nav-user-menu-item-meta">
                                  <span>
                                    {tx(
                                      lang() === "en"
                                        ? "langEn"
                                        : lang() === "zh"
                                          ? "langZh"
                                          : lang() === "ja"
                                            ? "langJa"
                                            : "langKo",
                                    )}
                                  </span>
                                  <span class="nav-user-menu-caret" aria-hidden="true">
                                    ▼
                                  </span>
                                </span>
                              </button>
                            </li>
                            <Show when={menu() === "lang"}>
                              <li role="none">
                                <div class="nav-lang-menu">
                                  <div class="nav-lang-menu-header">{tx("selectLang")}</div>
                                  <For each={["en", "zh", "ja", "ko"] as Lang[]}>
                                    {(code) => (
                                      <button
                                        type="button"
                                        class="nav-lang-menu-item"
                                        classList={{ "is-active": ead.language() === code }}
                                        onClick={() => {
                                          ead.setLanguage(code)
                                          closeMenus()
                                        }}
                                      >
                                        {tx(
                                          code === "en"
                                            ? "langEn"
                                            : code === "zh"
                                              ? "langZh"
                                              : code === "ja"
                                                ? "langJa"
                                                : "langKo",
                                        )}
                                        <span class="nav-lang-menu-check">
                                          {ead.language() === code ? "✓" : ""}
                                        </span>
                                      </button>
                                    )}
                                  </For>
                                </div>
                              </li>
                            </Show>
                            <li role="none" class="nav-user-menu-sep" aria-hidden="true" />
                            <li role="none">
                              <button
                                type="button"
                                role="menuitemcheckbox"
                                aria-checked={diag()}
                                class="nav-user-menu-item is-check"
                                onClick={() => {
                                  setDiag((v) => !v)
                                  closeMenus()
                                }}
                              >
                                <span class="nav-user-menu-check" aria-hidden="true">
                                  {diag() ? "✓" : ""}
                                </span>
                                <span>{tx("showDebug")}</span>
                              </button>
                            </li>
                            <li role="none" class="nav-user-menu-sep" aria-hidden="true" />
                            <li role="none">
                              <button type="button" role="menuitem" class="nav-user-menu-item is-logout" onClick={onSignOut}>
                                {tx("logout")}
                              </button>
                            </li>
                          </ul>
                        </Show>
                      </div>
                    </div>
                  </div>

                  <div class="product-row" classList={{ "is-open": menu() === "product" }} data-ead-menu>
                  <div class="relative flex-1 min-w-0">
                    <button
                      type="button"
                      class="product-select"
                      aria-expanded={menu() === "product"}
                      onClick={() => {
                        setMenu(menu() === "product" ? "" : "product")
                        setPq("")
                      }}
                    >
                      <span class="product-select-label">
                        {ead.productName() || tx("selectProductHint")}
                      </span>
                      <span class="product-select-switch" aria-hidden="true">
                        <IconSwap />
                      </span>
                    </button>
                    <Show when={menu() === "product"}>
                      <div class={`${drop} is-product`}>
                        <div class="product-menu-search-wrap">
                          <input
                            class="product-menu-search"
                            placeholder={tx("searchProduct")}
                            value={pq()}
                            onInput={(e) => setPq(e.currentTarget.value)}
                            autofocus
                          />
                        </div>
                        <div class="product-menu-list">
                          <Show
                            when={grouped().length}
                            fallback={
                              <For each={filtered()} fallback={<div class="product-empty">{tx("noProducts")}</div>}>
                                {(p) => (
                                  <Choice
                                    product={p}
                                    active={ead.productId() === p.productId}
                                    lang={lang()}
                                    onPick={pickProduct}
                                  />
                                )}
                              </For>
                            }
                          >
                            <For each={grouped()}>
                              {(g) => (
                                <div class="product-menu-group">
                                  <div class="product-menu-team">
                                    <span class="product-menu-team-icon">
                                      <IconFolder />
                                    </span>
                                    <span class="product-menu-team-label">{g.name || tx("teamFallback")}</span>
                                  </div>
                                  <div class="product-menu-children">
                                    <For each={g.products}>
                                      {(p) => (
                                        <Choice
                                          product={p}
                                          active={ead.productId() === p.productId}
                                          lang={lang()}
                                          onPick={pickProduct}
                                        />
                                      )}
                                    </For>
                                  </div>
                                </div>
                              )}
                            </For>
                          </Show>
                        </div>
                      </div>
                    </Show>
                  </div>
                  <button
                    type="button"
                    class="ead-icon-btn product-edit-btn"
                    disabled={ead.productId() <= 0}
                    onClick={askEdit}
                    title={tx("editProduct")}
                  >
                    <IconEdit />
                  </button>
                </div>

                <Show when={ead.mapId() > 0}>
                  <div class="active-pfm-wrap" classList={{ "is-open": menu() === "schema" }} data-ead-menu>
                    <button
                      type="button"
                      class="active-pfm-btn"
                      disabled={!schemas().length}
                      onClick={() => {
                        if (!schemas().length) return
                        setMenu(menu() === "schema" ? "" : "schema")
                      }}
                    >
                      <span class="active-pfm-prefix">{tx("pfmPrefix")}</span>
                      <span class="active-pfm-value-map">
                        <bdi>{mapName() || `Map ${ead.mapId()}`}</bdi>
                      </span>
                      <Show when={ead.subSchemaId() > 0 && schemaType()}>
                        <span class="active-pfm-value-sep">–</span>
                        <span class="active-pfm-value-type">{schemaType()}</span>
                        <span class="job-owner-filter-caret">▾</span>
                      </Show>
                    </button>
                    <Show when={baseMapId() > 0}>
                      <span class="active-pfm-badge">{tx("siblingPfm")}</span>
                    </Show>
                    <Show when={menu() === "schema"}>
                      <div class="pfm-schema-filter-menu">
                        <For each={schemas()}>
                          {(s) => (
                            <button
                              type="button"
                              class="pfm-schema-filter-option"
                              classList={{ "is-selected": ead.subSchemaId() === s.id }}
                              onClick={() => pickSchema(s.id)}
                            >
                              <span class="pfm-schema-filter-check">{ead.subSchemaId() === s.id ? "✓" : ""}</span>
                              {`${mapName() || `Map ${ead.mapId()}`} – ${s.name}`}
                            </button>
                          )}
                        </For>
                        <HelpMenu lang={lang()} onClick={() => openHelp("pfm-schema-filter")} />
                      </div>
                    </Show>
                  </div>
                </Show>
                </div>

                <Show when={hint() && ead.productId() <= 0}>
                  <div class="product-suggestion">
                    <span class="min-w-0 flex-1 truncate">
                      {tx("suggested")} <strong>{hint()!.name}</strong>
                    </span>
                    <button
                      type="button"
                      class="product-suggestion-btn"
                      onClick={() => {
                        const hit = hint()
                        if (!hit) return
                        pickProduct({ productId: hit.productId, name: hit.name })
                      }}
                    >
                      {tx("use")}
                    </button>
                    <button type="button" class="product-suggestion-dismiss" onClick={() => setHint(undefined)}>
                      {tx("dismiss")}
                    </button>
                  </div>
                </Show>

                <div class="search-toolbar-row">
                  <span class="search-toolbar-label">{tx("searchLabel")}</span>
                  <div class="search-input-wrap" classList={{ "has-value": !!query().trim() }}>
                    <input
                      class="search"
                      placeholder={tx("searchPlaceholder")}
                      aria-label={tx("searchLabel")}
                      value={query()}
                      onInput={(e) => setQuery(e.currentTarget.value)}
                    />
                    <button
                      type="button"
                      class="search-clear-btn"
                      title={tx("searchClear")}
                      aria-label={tx("searchClear")}
                      hidden={!query().trim()}
                      onClick={() => setQuery("")}
                    >
                      ×
                    </button>
                  </div>
                </div>

                <Show when={pfmFilter().ids.length > 0}>
                  <div class="pfm-filter-status">
                    <span class="pfm-filter-status-line">
                      <span class="pfm-filter-status-text">
                        {tx("pfmFilterPrefix", { count: pfmFilter().ids.length })}
                      </span>
                      <button
                        type="button"
                        class="pfm-filter-state"
                        classList={{ "is-off": !pfmFilter().active }}
                        onClick={() => {
                          const cur = pfmFilter()
                          const pid = ead.productId()
                          const next = !cur.active
                          writePfmFilter(cur.ids, next, cur.paths, pid)
                          bump()
                          if (next && !cur.paths.length) void fillPaths(cur.ids, pid)
                        }}
                      >
                        {pfmFilter().active ? tx("on") : tx("off")}
                      </button>
                    </span>
                  </div>
                </Show>

                <div class="job-owner-row" classList={{ "is-open": menu() === "owner" }} data-ead-menu>
                    <span class="job-owner-filter-label">{tx("jobOwner")}</span>
                    <button
                      type="button"
                      class="job-owner-filter-trigger"
                      classList={{ open: menu() === "owner" }}
                      onClick={() => void openOwner()}
                    >
                      <span class="job-owner-filter-value-text">{ownerSummary(owner(), lang())}</span>
                      <span class="job-owner-filter-caret">▾</span>
                    </button>
                    <Show when={menu() === "owner"}>
                      <div class="job-owner-filter-scrim" onClick={() => closeMenus()} />
                      <div class="job-owner-filter-menu">
                        <div class="job-owner-filter-search-row">
                          <input
                            class="job-owner-filter-search"
                            placeholder={tx("searchMembers")}
                            value={oq()}
                            onInput={(e) => setOq(e.currentTarget.value)}
                          />
                          <button
                            type="button"
                            class="job-owner-filter-mode-toggle"
                            classList={{ "is-multi": multi() }}
                            title={multi() ? tx("ownerSingleMode") : tx("ownerMultiMode")}
                            aria-label={multi() ? tx("ownerSingleMode") : tx("ownerMultiMode")}
                            aria-pressed={multi()}
                            onClick={() => {
                              const next = !multi()
                              setMulti(next)
                              if (!next) return
                              const cur = owner()
                              setDraftMe(!!cur.includeMe && cur.active)
                              setDraftEmails(
                                cur.memberEmails.length
                                  ? [...cur.memberEmails]
                                  : cur.memberEmail
                                    ? [cur.memberEmail]
                                    : [],
                              )
                            }}
                          >
                            {multi() ? <IconOwnerSingle /> : <IconOwnerMulti />}
                          </button>
                        </div>

                        <Show
                          when={multi()}
                          fallback={
                            <div class="job-owner-filter-list">
                              <button
                                type="button"
                                class="job-owner-filter-option"
                                classList={{ "is-selected": !owner().active }}
                                onClick={() => {
                                  writeOwnerChoice({
                                    active: false,
                                    memberEmail: "",
                                    memberLabel: "",
                                    memberEmails: [],
                                    includeMe: false,
                                  })
                                  closeMenus()
                                }}
                              >
                                {tx("all")}
                              </button>
                              <Show when={email()}>
                                <button
                                  type="button"
                                  class="job-owner-filter-option"
                                  classList={{
                                    "is-selected":
                                      owner().active && owner().includeMe && !owner().memberEmails.length,
                                  }}
                                  onClick={() => {
                                    writeOwnerChoice({
                                      active: true,
                                      includeMe: true,
                                      memberEmail: "",
                                      memberLabel: "",
                                      memberEmails: [],
                                    })
                                    closeMenus()
                                  }}
                                >
                                  {tx("me")}
                                </button>
                              </Show>
                              <Show
                                when={ownerSearchEmpty()}
                                fallback={
                                  <Show
                                    when={ownerMemberGap()}
                                    fallback={
                                      <For each={ownerMembers()}>
                                        {(m) => (
                                          <button
                                            type="button"
                                            class="job-owner-filter-option"
                                            classList={{
                                              "is-selected": owner().memberEmail === m.email && !owner().includeMe,
                                            }}
                                            onClick={() => {
                                              writeOwnerChoice({
                                                active: true,
                                                memberEmail: m.email,
                                                memberLabel: m.label,
                                                memberEmails: [m.email],
                                                includeMe: false,
                                              })
                                              closeMenus()
                                            }}
                                          >
                                            {m.label}
                                          </button>
                                        )}
                                      </For>
                                    }
                                  >
                                    <Show
                                      when={!ead.token()}
                                      fallback={<div class="job-owner-filter-empty">{ownerEmptyMsg()}</div>}
                                    >
                                      <div class="job-owner-filter-empty job-owner-filter-empty--auth">
                                        <div>{ownerEmptyMsg()}</div>
                                        <button
                                          type="button"
                                          class="job-owner-filter-signin-btn"
                                          onClick={openOwnerSignIn}
                                        >
                                          {tx("ownerSignIn")}
                                        </button>
                                      </div>
                                    </Show>
                                  </Show>
                                }
                              >
                                <div class="job-owner-filter-empty">{tx("ownerNoMembers")}</div>
                              </Show>
                            </div>
                          }
                        >
                          <div class="job-owner-filter-multi-toolbar">
                            <button
                              type="button"
                              class="job-owner-filter-check-row"
                              classList={{ "is-checked": ownerAllSelected() }}
                              onClick={() => {
                                const all = members().map((m) => m.email)
                                if (ownerAllSelected()) {
                                  setDraftMe(false)
                                  setDraftEmails([])
                                  return
                                }
                                setDraftMe(true)
                                setDraftEmails(all)
                              }}
                            >
                              <span class="job-owner-filter-box" />
                              <span>{tx("selectAll")}</span>
                            </button>
                            <div class="job-owner-filter-multi-actions">
                              <button
                                type="button"
                                class="job-owner-filter-icon-btn"
                                aria-label={tx("cancel")}
                                onClick={() => closeMenus()}
                              >
                                ✕
                              </button>
                              <button
                                type="button"
                                class="job-owner-filter-icon-btn is-primary"
                                aria-label={tx("apply")}
                                onClick={applyOwner}
                              >
                                ✓
                              </button>
                            </div>
                          </div>
                          <div class="job-owner-filter-list">
                            <button
                              type="button"
                              class="job-owner-filter-check-row"
                              classList={{ "is-checked": draftMe() }}
                              onClick={() => setDraftMe((v) => !v)}
                            >
                              <span class="job-owner-filter-box" />
                              <span>
                                {tx("includeMe")}
                                {email() ? ` (${email()})` : ""}
                              </span>
                            </button>
                            <Show
                              when={ownerSearchEmpty()}
                              fallback={
                                <Show
                                  when={ownerMemberGap()}
                                  fallback={
                                    <For each={ownerMembers()}>
                                      {(m) => (
                                        <button
                                          type="button"
                                          class="job-owner-filter-check-row"
                                          classList={{ "is-checked": draftEmails().includes(m.email) }}
                                          onClick={() => {
                                            const on = !draftEmails().includes(m.email)
                                            setDraftEmails((prev) =>
                                              on ? [...new Set([...prev, m.email])] : prev.filter((x) => x !== m.email),
                                            )
                                          }}
                                        >
                                          <span class="job-owner-filter-box" />
                                          <span class="truncate">{m.label}</span>
                                        </button>
                                      )}
                                    </For>
                                  }
                                >
                                  <Show
                                    when={!ead.token()}
                                    fallback={<div class="job-owner-filter-empty">{ownerEmptyMsg()}</div>}
                                  >
                                    <div class="job-owner-filter-empty job-owner-filter-empty--auth">
                                      <div>{ownerEmptyMsg()}</div>
                                      <button
                                        type="button"
                                        class="job-owner-filter-signin-btn"
                                        onClick={openOwnerSignIn}
                                      >
                                        {tx("ownerSignIn")}
                                      </button>
                                    </div>
                                  </Show>
                                </Show>
                              }
                            >
                              <div class="job-owner-filter-empty">{tx("ownerNoMembers")}</div>
                            </Show>
                          </div>
                        </Show>
                        <HelpMenu lang={lang()} onClick={() => openHelp("job-owner-filter")} />
                      </div>
                    </Show>
                  </div>
                <div class="tree-toolbar-row">
                  <div class="tree-view-switch-wrap" data-ead-menu>
                    <button
                      type="button"
                      class="tree-view-select"
                      classList={{ open: menu() === "view" }}
                      disabled={ead.productId() <= 0}
                      title={ead.productId() <= 0 ? tx("selectProductHint") : !hasSource() ? tx("noSourceSchema") : undefined}
                      onClick={() => {
                        if (ead.productId() <= 0) return
                        const next = menu() === "view" ? "" : "view"
                        setMenu(next)
                        if (next !== "view" || hasSource()) return
                        const token = ead.token()
                        const pid = ead.productId()
                        if (!token || pid <= 0) return
                        void loadSourceSchema(token, pid, http())
                          .then((schema) => {
                            if (schema) ead.setSchema(schema.schemaId, schema.name)
                          })
                          .catch(() => undefined)
                      }}
                    >
                      <span class="tree-view-select-label">
                        {ead.view() === "source" ? tx("aiCode") : tx("pfmTree")}
                      </span>
                      <span class="tree-view-select-caret" aria-hidden="true">&gt;</span>
                    </button>
                    <Show when={menu() === "view"}>
                      <div class="tree-view-menu">
                        <button
                          type="button"
                          class="tree-view-menu-item"
                          classList={{ active: ead.view() === "pfm" }}
                          onClick={() => void switchView("pfm")}
                        >
                          <span class="tree-view-menu-check">{ead.view() === "pfm" ? <IconCheck /> : null}</span>
                          {tx("pfmTree")}
                        </button>
                        <button
                          type="button"
                          class="tree-view-menu-item"
                          classList={{ active: ead.view() === "source" }}
                          disabled={!hasSource()}
                          onClick={() => void switchView("source")}
                        >
                          <span class="tree-view-menu-check">{ead.view() === "source" ? <IconCheck /> : null}</span>
                          {tx("aiCode")}
                        </button>
                        <HelpMenu lang={lang()} onClick={() => openHelp("navigator-view-mode")} />
                      </div>
                    </Show>
                  </div>

                  <Show when={ead.view() === "pfm"}>
                    <div
                      class="job-filter-wrap"
                      classList={{ "is-open": menu() === "job" }}
                      data-ead-menu
                      onPointerDown={(e) => {
                        e.preventDefault()
                        setMenu(menu() === "job" ? "" : "job")
                      }}
                    >
                      <button
                        type="button"
                        class="job-filter-button"
                        classList={{ open: menu() === "job" }}
                        tabindex="-1"
                        title={jobTitle()}
                      >
                        <span class="job-filter-icon">
                          <Show
                            when={!ead.jobsOnly()}
                            fallback={
                              <Show when={ead.badge() === "ead"} fallback={
                                <Show when={ead.badge() === "tests"} fallback={<IconJobs />}>
                                  <IconTests />
                                </Show>
                              }>
                                <IconEad />
                              </Show>
                            }
                          >
                            <IconFolders />
                          </Show>
                        </span>
                        <IconCaret />
                      </button>
                      <Show when={menu() === "job"}>
                        <div class="job-filter-menu" onPointerDown={(e) => e.stopPropagation()}>
                          <div class="job-filter-group-label">{tx("groupPfmVsSource")}</div>
                          <button
                            type="button"
                            class="job-filter-option"
                            classList={{ active: ead.view() === "pfm" }}
                            onClick={() => void switchView("pfm")}
                          >
                            <span class="job-filter-icon"><IconFolders /></span>
                            <span>{tx("pfmTree")}</span>
                            <span class="job-filter-check">{ead.view() === "pfm" ? <IconCheck /> : null}</span>
                          </button>
                          <button
                            type="button"
                            class="job-filter-option"
                            classList={{ active: ead.view() === "source" }}
                            disabled={!hasSource()}
                            onClick={() => void switchView("source")}
                          >
                            <span class="job-filter-icon"><IconFile /></span>
                            <span>{tx("aiCode")}</span>
                            <span class="job-filter-check">{ead.view() === "source" ? <IconCheck /> : null}</span>
                          </button>
                          <div class="job-filter-separator" />
                          <div class="job-filter-group-label">{tx("groupEadJobs")}</div>
                          <button
                            type="button"
                            class="job-filter-option"
                            classList={{ active: ead.badge() === "ead" }}
                            onClick={() => toggleBadge("ead")}
                          >
                            <span class="job-filter-icon"><IconEad /></span>
                            <span>{tx("showEadCount")}</span>
                            <span class="job-filter-check">{ead.badge() === "ead" ? <IconCheck /> : null}</span>
                          </button>
                          <button
                            type="button"
                            class="job-filter-option"
                            classList={{ active: ead.badge() === "jobs" }}
                            onClick={() => toggleBadge("jobs")}
                          >
                            <span class="job-filter-icon"><IconJobs /></span>
                            <span>{tx("showOpenJobs")}</span>
                            <span class="job-filter-check">{ead.badge() === "jobs" ? <IconCheck /> : null}</span>
                          </button>
                          <button
                            type="button"
                            class="job-filter-option"
                            classList={{ active: ead.badge() === "tests" }}
                            onClick={() => toggleBadge("tests")}
                          >
                            <span class="job-filter-icon"><IconTests /></span>
                            <span>{tx("showOpenTests")}</span>
                            <span class="job-filter-check">{ead.badge() === "tests" ? <IconCheck /> : null}</span>
                          </button>
                          <div class="job-filter-separator" />
                          <div class="job-filter-group-label">{tx("groupTreeView")}</div>
                          <button
                            type="button"
                            class="job-filter-option"
                            classList={{ active: !ead.jobsOnly() }}
                            onClick={() => {
                              ead.setJobsOnly(false)
                              setMenu("")
                            }}
                          >
                            <span class="job-filter-icon"><IconFolders /></span>
                            <span>{tx("showAllNodes")}</span>
                            <span class="job-filter-check">{!ead.jobsOnly() ? <IconCheck /> : null}</span>
                          </button>
                          <button
                            type="button"
                            class="job-filter-option"
                            classList={{ active: ead.jobsOnly() }}
                            onClick={() => {
                              ead.setJobsOnly(true)
                              setMenu("")
                            }}
                          >
                            <span class="job-filter-icon"><IconFilter /></span>
                            <span>{tx("showFilteredOnly")}</span>
                            <span class="job-filter-check">{ead.jobsOnly() ? <IconCheck /> : null}</span>
                          </button>
                          <div class="job-filter-separator" />
                          <HelpMenu lang={lang()} onClick={() => openHelp("pfm-tree-filter")} />
                        </div>
                      </Show>
                    </div>
                  </Show>

                  <Show when={ead.view() === "source"}>
                    <div class="ead-run-menu-wrap" data-ead-menu>
                      <button
                        type="button"
                        class="ead-run-menu-btn"
                        classList={{ open: menu() === "run" }}
                        aria-label="EAD run"
                        onClick={() => setMenu(menu() === "run" ? "" : "run")}
                      >
                        <IconDots />
                      </button>
                      <Show when={menu() === "run"}>
                        <div class="ead-run-menu">
                          <div class="ead-run-menu-group-label">{tx("sourceTreeBadges")}</div>
                          <button
                            type="button"
                            class="ead-run-menu-item"
                            classList={{ active: ead.badge() === "ead" }}
                            onClick={() => toggleBadge("ead")}
                          >
                            <span class="ead-run-menu-check">{ead.badge() === "ead" ? <IconCheck /> : null}</span>
                            {tx("sourceShowEadCount")}
                          </button>
                          <button
                            type="button"
                            class="ead-run-menu-item"
                            classList={{ active: ead.badge() === "jobs" }}
                            onClick={() => toggleBadge("jobs")}
                          >
                            <span class="ead-run-menu-check">{ead.badge() === "jobs" ? <IconCheck /> : null}</span>
                            {tx("sourceShowOpenJobs")}
                          </button>
                          <button
                            type="button"
                            class="ead-run-menu-item"
                            classList={{ active: ead.badge() === "tests" }}
                            onClick={() => toggleBadge("tests")}
                          >
                            <span class="ead-run-menu-check">{ead.badge() === "tests" ? <IconCheck /> : null}</span>
                            {tx("sourceShowOpenTests")}
                          </button>
                          <div class="ead-run-menu-separator" />
                          <div class="ead-run-menu-group-label">{tx("sourceTreeGroup")}</div>
                          <button
                            type="button"
                            class="ead-run-menu-item"
                            classList={{ active: !ead.eadsOnly() }}
                            onClick={() => scopeSource(false)}
                          >
                            <span class="ead-run-menu-check">{!ead.eadsOnly() ? <IconCheck /> : null}</span>
                            {tx("showAllSource")}
                          </button>
                          <button
                            type="button"
                            class="ead-run-menu-item"
                            classList={{ active: ead.eadsOnly() }}
                            onClick={() => scopeSource(true)}
                          >
                            <span class="ead-run-menu-check">{ead.eadsOnly() ? <IconCheck /> : null}</span>
                            {tx("showWithEads")}
                          </button>
                          <div class="ead-run-menu-separator" />
                          <button
                            type="button"
                            class="ead-run-menu-item"
                            disabled={ead.productId() <= 0}
                            onClick={() => {
                              closeMenus()
                              launch({ kind: "setupSource" })
                            }}
                          >
                            <span class="ead-run-menu-check is-action">⚙</span>
                            {tx("setupSource")}
                          </button>
                          <button
                            type="button"
                            class="ead-run-menu-item"
                            disabled={ead.productId() <= 0}
                            onClick={() => {
                              closeMenus()
                              launch({ kind: "find", ...sourceOpts() })
                            }}
                          >
                            <span class="ead-run-menu-check is-action">⌕</span>
                            {tx("aiFind")}
                          </button>
                        </div>
                      </Show>
                    </div>
                  </Show>
                </div>

              </div>

              <div class="navigator-scroll" classList={{ "is-locked": menuOpen() }}>
                <Show when={diag() && banner()}>
                  <div
                    class="refresh-banner"
                    classList={{
                      "is-loading": banner()!.kind === "loading",
                      "is-ok": banner()!.kind === "ok",
                      "is-error": banner()!.kind === "error",
                    }}
                  >
                    {banner()!.text}
                  </div>
                </Show>

                <Show when={diag() && startup().text}>
                  <div
                    class="startup-status"
                    classList={{
                      "is-ok": startup().kind === "ok",
                      "is-error": startup().kind === "error",
                    }}
                  >
                    {startup().text}
                  </div>
                </Show>

                <Show when={diag()}>
                  <div
                    class="diag-panel"
                    classList={{
                      "is-ok": diagOk(),
                      "is-error": diagFail(),
                    }}
                  >
                    <div class="diag-title">{tx("diagTitle")}</div>
                    <div class="diag-line">{`env=${ead.env()}`}</div>
                    <div class="diag-line">{`api=${eadApi()}`}</div>
                    <div class="diag-line">{`auth=${ead.token() ? "yes" : "no"}`}</div>
                    <div class="diag-line">{`mcp=${ead.mcpEntry() || "-"}`}</div>
                    <div class="diag-line">{`productId=${ead.productId()}`}</div>
                    <div class="diag-line">{`mapId=${ead.mapId()} schemaId=${ead.schemaId()} subSchemaId=${ead.subSchemaId()}`}</div>
                    <div class="diag-line">{`nodeId=${ead.nodeId()} sourceId=${ead.sourceId()}`}</div>
                    <div class="diag-line">{`view=${ead.view()} badge=${ead.badge()} jobsOnly=${ead.jobsOnly()}`}</div>
                    <div class="diag-line">{`workContextId=${ead.workContextId()}`}</div>
                    <div class="diag-line">{`pfmFilter=${pfmFilter().active ? "on" : "off"} ids=${pfmFilter().ids.length} paths=${pfmFilter().paths.length}`}</div>
                    <div class="diag-line">{`owner=${owner().enabled ? ownerSummary(owner(), lang()) : "off"}`}</div>
                    <Show when={err()}>
                      <div class="diag-line fail">{`err=${err()}`}</div>
                    </Show>
                    <For each={diagSteps()}>
                      {(s) => (
                        <div class="diag-line" classList={{ fail: !s.ok }}>
                          {`${s.ok ? "✓" : "✗"} ${s.name}: ${s.detail}`}
                        </div>
                      )}
                    </For>
                  </div>
                </Show>

                <Show when={ead.view() === "source"}>
                  <div class="source-scope-bar" data-ead-menu>
                    <button
                      type="button"
                      class="source-scope-select"
                      classList={{ open: menu() === "scope" }}
                      onClick={() => setMenu(menu() === "scope" ? "" : "scope")}
                    >
                      <span class="source-scope-select-label">
                        {ead.eadsOnly() ? tx("sourceWithPfm") : tx("showAllSourceCode")}
                      </span>
                      <span class="source-scope-select-caret">&gt;</span>
                    </button>
                    <Show when={menu() === "scope"}>
                      <div class="source-scope-menu">
                        <button
                          type="button"
                          class="source-scope-menu-item"
                          classList={{ active: !ead.eadsOnly() }}
                          onClick={() => scopeSource(false)}
                        >
                          <span class="job-filter-check">{!ead.eadsOnly() ? <IconCheck /> : null}</span>
                          {tx("showAllSourceCode")}
                        </button>
                        <button
                          type="button"
                          class="source-scope-menu-item"
                          classList={{ active: ead.eadsOnly() }}
                          onClick={() => scopeSource(true)}
                        >
                          <span class="job-filter-check">{ead.eadsOnly() ? <IconCheck /> : null}</span>
                          {tx("sourceWithPfm")}
                        </button>
                      </div>
                    </Show>
                  </div>
                </Show>

                <Show when={busy() && !banner()}>
                  <span class="text-12-regular text-text-weak">{tx("loading")}</span>
                </Show>

                <Show when={ead.view() === "pfm"}>
                  <Show when={pfmVisible().length}>
                    <div class="tree">
                      <Tree
                        nodes={pfmVisible()}
                        selected={ead.nodeId()}
                        onSelect={selectNode}
                        badge={ead.badge()}
                        counts={pfmBadgeCounts()}
                        work={ead.workContextId()}
                        force={openPath()}
                        pulse={pulse()}
                        lang={lang()}
                        expanded={pfmExpandedIds()}
                        onToggle={onPfmToggle}
                        schemas={schemas()}
                        subId={ead.subSchemaId()}
                        schemaOpen={dynMenu()}
                        onSchemaOpen={setDynMenu}
                        onSchema={pickSchema}
                        schemaLabel={schemas().length ? schemaType() : undefined}
                        loadName={schemaLoad()}
                      />
                    </div>
                  </Show>
                  <Show when={!busy() && ead.productId() > 0 && !root()}>
                    <Empty title={tx("noMap")} />
                  </Show>
                  <Show
                    when={
                      !busy() &&
                      !!root() &&
                      pfmVisible().length === 0 &&
                      !query().trim() &&
                      !ead.jobsOnly() &&
                      !pfmFilter().active &&
                      schemas().length > 0
                    }
                  >
                    <Empty title={tx("emptyDynamic")} hint={tx("crawlVisionHint")}>
                      <button
                        type="button"
                        class="product-suggestion-btn"
                        onClick={() => launch({ kind: "crawl" })}
                        title={tx("crawlVisionHint")}
                      >
                        {tx("crawlVision")}
                      </button>
                    </Empty>
                  </Show>
                  <Show when={!busy() && root() && pfmVisible().length === 0 && (query().trim() || ead.jobsOnly() || pfmFilter().active)}>
                    <div class="empty">{tx("noMatch")}</div>
                  </Show>
                </Show>

                <Show when={ead.view() === "source"}>
                  <Show when={sourceVisible().length}>
                    <div class="tree">
                      <SourceTree
                        nodes={sourceVisible()}
                        selected={ead.sourceId()}
                        onSelect={selectSource}
                        eads={eadCounts()}
                        jobs={jobCounts()}
                        tests={testCounts()}
                        mode={ead.badge()}
                        pending={pendingPaths()}
                        expanded={ead.expanded(ead.schemaId())}
                        onExpand={onExpand}
                        pulse={pulse()}
                        lang={lang()}
                      />
                    </div>
                  </Show>
                  <Show when={!busy() && ead.productId() > 0 && source().length === 0}>
                    <Empty title={tx("noSource")}>
                      <button
                        type="button"
                        class="product-suggestion-btn"
                        disabled={busy()}
                        onClick={() => {
                          setBusy(true)
                          setErr("")
                          void loadSource(true)
                            .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
                            .finally(() => setBusy(false))
                        }}
                      >
                        {tx("syncSource")}
                      </button>
                    </Empty>
                  </Show>
                  <Show when={!busy() && source().length > 0 && sourceVisible().length === 0 && (query().trim() || ead.eadsOnly() || pfmFilter().active)}>
                    <div class="empty">{tx("noMatchSource")}</div>
                  </Show>
                </Show>

                <Show when={err()}>
                  <p class="error break-words">{err()}</p>
                </Show>
              </div>

              <Show when={menu() === "coding"}>
                <div class="ead-plan-modal-backdrop" onClick={() => closeMenus()}>
                  <div
                    id="ead-plan-modal"
                    class="project-cute-popup ead-plan-modal"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="ead-plan-modal-title"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p class="project-cute-popup-title" id="ead-plan-modal-title">
                      {tx("eadCodingPlanTitle")}
                    </p>
                    <For each={plans()}>
                      {(item) => (
                        <p class="ead-plan-modal-name" title={planTip(item)}>
                          {planName(item)}
                        </p>
                      )}
                    </For>
                    <p class="project-cute-popup-text">{tx("eadCodingPlanBody")}</p>
                    <label class="ead-plan-modal-check">
                      <input
                        type="checkbox"
                        checked={planOn()}
                        disabled={!ead.token()}
                        onChange={(e) => setPlanOn(e.currentTarget.checked)}
                      />
                      <span>{tx("enableEadCodingPlan")}</span>
                    </label>
                    <div class="project-cute-popup-actions">
                      <button type="button" class="context-btn" onClick={() => closeMenus()}>
                        {tx("eadCodingPlanCancel")}
                      </button>
                      <button
                        type="button"
                        class="context-btn primary"
                        disabled={!ead.token() || planOn() === ead.coding()}
                        onClick={submitPlan}
                      >
                        {tx("eadCodingPlanSubmit")}
                      </button>
                    </div>
                  </div>
                </div>
              </Show>
            </Show>
          </div>
        </div>

        <Show when={panelOpen()}>
          <ResizeHandle
            direction="horizontal"
            edge="end"
            size={width()}
            min={EAD_MAP_MIN}
            max={EAD_MAP_MAX}
            onDragStart={() => props.sizing.begin()}
            onDragEnd={() => props.sizing.end()}
            onResize={(w) => {
              resizeEadPanel(layout, { id: EAD_MAP_ID, width: w, review: reviewOpen() })
            }}
          />
        </Show>
      </aside>
    </Show>
  )
}

export function openEadMap(layout: ReturnType<typeof useLayout>) {
  layout.pluginPanel.open(EAD_MAP_ID, EAD_MAP_WIDTH)
}
