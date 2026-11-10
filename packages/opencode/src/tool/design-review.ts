import z from "zod"
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Tool } from "./tool"
import { Provider } from "../provider/provider"
import { ProviderID } from "../provider/schema"
import type { MessageV2 } from "../session/message-v2"
import DESCRIPTION from "./design-review.txt"

/** The EAD Pilot provider SiCode sends its model requests to. */
export const EAD_PROVIDER = "ead"

const parameters = z.object({
  request: z.string().describe("What the person asked for, in a sentence or two"),
  options: z
    .array(
      z.object({
        label: z.string().describe('The option\'s label, such as "A. Node tree"'),
        svg: z.string().describe("The option's complete <svg>...</svg>"),
      }),
    )
    .min(1)
    .max(12)
    .describe("The design options to check"),
})

type Verdict = { label?: string; verdict?: string; problems?: string[]; fixes?: string[] }
type Review = { available?: boolean; reason?: string; reviewer?: string; options?: Verdict[]; summary?: string; error?: string }

/** Images the person attached to their latest message, as data URLs: the reference the designs must fit. */
export function referenceImages(messages: MessageV2.WithParts[]): string[] {
  const user = messages.findLast((message) => message.info.role === "user")
  if (!user) return []
  return user.parts
    .filter((part): part is MessageV2.FilePart => part.type === "file" && part.mime.startsWith("image/"))
    .map((part) => part.url)
    .slice(0, 4)
}

/** The text of the person's latest message: the reviewer judges against it, not an earlier handed-over brief. */
export function latestRequest(messages: MessageV2.WithParts[]): string {
  const user = messages.findLast((message) => message.info.role === "user")
  if (!user) return ""
  return user.parts
    .filter((part): part is MessageV2.TextPart => part.type === "text" && !part.synthetic)
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n")
}

/** The review draws options at 20 to 160 px: an SVG wider than this is a whole screen, not an icon. */
export function screen(svg: string): boolean {
  const box = svg.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)/i)
  const width = svg.match(/<svg[^>]*\swidth\s*=\s*["']([\d.]+)/i)
  return Number(box?.[1] ?? width?.[1] ?? 0) > 800
}

/** Pilot's review endpoint, from the EAD provider's base URL (which ends in /v1). */
export function reviewEndpoint(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, "")}/design/review`
}

/** The review as text the designing model acts on: each option's verdict, then what to change. */
export function formatReview(review: Review): string {
  if (review.error) return `Design review failed: ${review.error}`
  if (review.available === false) return `Design review is not available: ${review.reason ?? "no model can see images"}`
  const options = review.options ?? []
  if (options.length === 0) return "Design review returned no verdicts; present the options as they are."
  const lines = options.map((option) => {
    const head = `${option.label ?? "?"}: ${option.verdict === "pass" ? "PASS" : "FIX"}`
    const problems = (option.problems ?? []).map((p) => `  - problem: ${p}`)
    const fixes = (option.fixes ?? []).map((f) => `  - fix: ${f}`)
    return [head, ...problems, ...fixes].join("\n")
  })
  const passed = options.filter((option) => option.verdict === "pass").length
  return [
    `Reviewed by ${review.reviewer ?? "a model that can see"}: ${passed} of ${options.length} pass.`,
    ...lines,
    review.summary ? `Summary: ${review.summary}` : "",
  ]
    .filter(Boolean)
    .join("\n")
}

export const DesignReviewTool = Tool.define(
  "design_review",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const provider = yield* Provider.Service
    return {
      description: DESCRIPTION,
      parameters,
      execute: (params: z.infer<typeof parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ead = yield* provider.getProvider(ProviderID.make(EAD_PROVIDER))
          const base = typeof ead?.options?.baseURL === "string" ? ead.options.baseURL : ""
          const model = ctx.extra?.model as { id?: string; providerID?: string } | undefined
          const plan = model?.providerID === EAD_PROVIDER && model.id ? model.id : ""
          if (!ead || !base || !ead.key || !plan) {
            return {
              title: "Design review",
              metadata: {},
              output: formatReview({ available: false, reason: "this session is not using an EAD Pilot plan" }),
            }
          }
          if (params.options.some((option) => screen(option.svg))) {
            return {
              title: "Design review",
              metadata: {},
              output:
                "These are full screens, which design_review cannot judge: it checks small SVG pieces drawn at 20 to 160 px. Make the screens a UI design in design/<Name>.design/ (canvas.json plus one HTML file per screen), look at them with design_shot, and show the person the result.",
            }
          }
          const latest = latestRequest(ctx.messages)
          yield* ctx.metadata({ title: `Checking ${params.options.length} designs against your screenshot` })
          const review = yield* HttpClientRequest.post(reviewEndpoint(base)).pipe(
            HttpClientRequest.setHeaders({ Authorization: `Bearer ${ead.key}` }),
            HttpClientRequest.bodyJson({
              model: plan,
              request: latest && latest !== params.request ? `${latest}\n\n(In short: ${params.request})` : params.request,
              options: params.options,
              images: referenceImages(ctx.messages),
            }),
            Effect.flatMap((request) => http.execute(request)),
            Effect.flatMap((response) => response.json),
            Effect.map((json) => json as Review),
            Effect.timeoutOrElse({ duration: "3 minutes", orElse: () => Effect.succeed({ error: "timed out" } as Review) }),
            // A failed review never stops the design work; the model is told and presents the options as they are.
            Effect.catch((error) => Effect.succeed({ error: String(error) } as Review)),
          )
          return { title: "Design review", metadata: {}, output: formatReview(review) }
        }),
    }
  }),
)
