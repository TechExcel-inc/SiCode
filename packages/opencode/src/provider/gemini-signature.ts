/**
 * Gemini 3 thought signatures over OpenAI-compatible chat completions.
 *
 * Gemini puts an encrypted `thought_signature` on the first tool call of each step, at
 * `tool_calls[].extra_content.google.thought_signature`, and answers the next request with a 400 when
 * that tool call comes back without it. `@ai-sdk/openai-compatible` drops `extra_content`, so the
 * provider fetch keeps each signature by tool call id from the response and puts it back on the
 * request. For a Gemini model whose signature is gone, the first call of the step gets Google's
 * documented placeholder. https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures
 */
export namespace GeminiSignature {
  export const SKIP = "skip_thought_signature_validator"
  const LIMIT = 20_000
  const seen = new Map<string, string>()

  type Call = { id?: string; extra_content?: { google?: { thought_signature?: string } } }
  type Message = { role?: string; tool_calls?: Call[] }

  export function remember(id: string | undefined, signature: string | undefined) {
    if (!id || !signature) return
    seen.delete(id)
    seen.set(id, signature)
    if (seen.size > LIMIT) seen.delete(seen.keys().next().value!)
  }

  export const recall = (id: string | undefined) => (id ? seen.get(id) : undefined)

  /** Request body with signatures back on assistant tool calls that lost theirs. Unchanged when nothing applies. */
  export function outgoing(raw: string) {
    if (!raw.trimStart().startsWith("{")) return raw
    const body = JSON.parse(raw) as { model?: string; messages?: Message[] }
    if (!Array.isArray(body.messages)) return raw
    const gemini = typeof body.model === "string" && body.model.toLowerCase().includes("gemini")
    const changed = body.messages
      .filter((msg) => msg.role === "assistant" && Array.isArray(msg.tool_calls))
      .flatMap((msg) =>
        msg.tool_calls!.map((call, i) => {
          if (call.extra_content?.google?.thought_signature) return false
          const value = recall(call.id) ?? (gemini && i === 0 ? SKIP : undefined)
          if (!value) return false
          call.extra_content = { ...call.extra_content, google: { ...call.extra_content?.google, thought_signature: value } }
          return true
        }),
      )
      .some(Boolean)
    return changed ? JSON.stringify(body) : raw
  }

  /** Remembers signatures from one chunk (`delta.tool_calls`) or one full answer (`message.tool_calls`). */
  export function capture(chunk: unknown, ids: Map<number, string>) {
    const choices = (chunk as { choices?: unknown[] } | null)?.choices
    if (!Array.isArray(choices)) return
    choices.forEach((choice) => {
      const item = choice as { delta?: { tool_calls?: unknown }; message?: { tool_calls?: unknown } }
      const calls = item.delta?.tool_calls ?? item.message?.tool_calls
      if (!Array.isArray(calls)) return
      calls.forEach((raw, position) => {
        const call = raw as Call & { index?: number }
        const index = typeof call.index === "number" ? call.index : position
        if (call.id) ids.set(index, call.id)
        remember(ids.get(index), call.extra_content?.google?.thought_signature)
      })
    })
  }

  const parse = (data: string) => {
    if (!data.startsWith("{")) return
    try {
      return JSON.parse(data) as unknown
    } catch {
      return
    }
  }

  /**
   * One stream line, with its signatures remembered. Gemini sometimes sends an event cut off part way
   * and the next event on the same line (`data: {...data: {...}`), which the SDK cannot parse. Such a
   * line keeps only its whole events, one per line.
   */
  export function repair(line: string, ids: Map<number, string>) {
    if (!line.startsWith("data:")) return line
    const json = parse(line.slice(5).trim())
    if (json !== undefined) {
      capture(json, ids)
      return line
    }
    const whole = line
      .slice(5)
      .split(/data: ?(?=\{)/)
      .map((part) => part.trim())
      .flatMap((part) => {
        const item = parse(part)
        return item === undefined ? [] : [{ part, item }]
      })
    if (whole.length === 0) return line
    whole.forEach((x) => capture(x.item, ids))
    return whole.map((x) => "data: " + x.part).join("\n\n")
  }

  /** The same response, with signatures remembered and cut-off events dropped as it streams to the SDK. */
  export function incoming(res: Response) {
    if (!res.ok || !res.body) return res
    const ids = new Map<number, string>()
    if (!(res.headers.get("content-type") ?? "").includes("event-stream")) {
      void res
        .clone()
        .json()
        .then((json) => capture(json, ids))
        .catch(() => undefined)
      return res
    }
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    const state = { rest: "" }
    const body = res.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          const lines = (state.rest + decoder.decode(chunk, { stream: true })).split("\n")
          state.rest = lines.pop() ?? ""
          if (lines.length > 0) controller.enqueue(encoder.encode(lines.map((line) => repair(line, ids)).join("\n") + "\n"))
        },
        flush(controller) {
          const last = state.rest + decoder.decode()
          if (last) controller.enqueue(encoder.encode(repair(last, ids)))
        },
      }),
    )
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers })
  }
}
