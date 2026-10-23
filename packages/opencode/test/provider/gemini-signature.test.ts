import { describe, expect, test } from "bun:test"
import { GeminiSignature } from "../../src/provider/gemini-signature"

const sse = (chunks: unknown[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)))
        controller.enqueue(encoder.encode("data: [DONE]\n\n"))
        controller.close()
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  )

const request = (model: string, ids: string[], extra?: Record<string, unknown>) =>
  JSON.stringify({
    model,
    messages: [
      { role: "user", content: "find files" },
      {
        role: "assistant",
        content: "",
        tool_calls: ids.map((id) => ({
          id,
          type: "function",
          function: { name: "glob", arguments: "{}" },
          ...extra,
        })),
      },
      { role: "tool", tool_call_id: ids[0], content: "a.ts" },
    ],
  })

const signatures = (raw: string) =>
  (JSON.parse(raw) as { messages: { tool_calls?: { extra_content?: { google?: { thought_signature?: string } } }[] }[] })
    .messages[1].tool_calls!.map((call) => call.extra_content?.google?.thought_signature)

describe("gemini thought signatures", () => {
  test("a signature streamed with a tool call goes back on the next request", async () => {
    const id = `call-${crypto.randomUUID()}`
    // the id comes on the call's first chunk, the signature on a later one by index
    const res = GeminiSignature.incoming(
      sse([
        { choices: [{ delta: { tool_calls: [{ index: 0, id, type: "function", function: { name: "glob", arguments: "" } }] } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, extra_content: { google: { thought_signature: "SIG-A" } }, function: { arguments: "{}" } },
                ],
              },
            },
          ],
        },
      ]),
    )
    // the SDK still gets the whole stream unchanged
    expect(await res.text()).toContain("SIG-A")
    await Promise.resolve()
    expect(signatures(GeminiSignature.outgoing(request("EAD 2.1", [id])))).toEqual(["SIG-A"])
  })

  test("a Gemini model with a lost signature gets the placeholder on the first call only", () => {
    const sent = GeminiSignature.outgoing(request("gemini-3.8-flash", [`a-${crypto.randomUUID()}`, `b-${crypto.randomUUID()}`]))
    expect(signatures(sent)).toEqual([GeminiSignature.SKIP, undefined])
  })

  test("other models are left alone", () => {
    const raw = request("deepseek-chat", [`c-${crypto.randomUUID()}`])
    expect(GeminiSignature.outgoing(raw)).toBe(raw)
  })

  test("a signature already on the request is kept", () => {
    const id = `d-${crypto.randomUUID()}`
    GeminiSignature.remember(id, "SIG-OLD")
    const sent = GeminiSignature.outgoing(
      request("gemini-3.8-flash", [id], { extra_content: { google: { thought_signature: "SIG-CLIENT" } } }),
    )
    expect(signatures(sent)).toEqual(["SIG-CLIENT"])
  })

  test("a full JSON answer is read too", async () => {
    const id = `e-${crypto.randomUUID()}`
    GeminiSignature.incoming(
      Response.json({ choices: [{ message: { tool_calls: [{ id, extra_content: { google: { thought_signature: "SIG-B" } } }] } }] }),
    )
    await Bun.sleep(10)
    expect(GeminiSignature.recall(id)).toBe("SIG-B")
  })

  test("an event cut off by the next one on the same line is dropped", async () => {
    const id = `e-${crypto.randomUUID()}`
    const good = {
      choices: [
        {
          delta: {
            role: "assistant",
            tool_calls: [
              { index: 0, id, type: "function", function: { name: "question", arguments: "{}" }, extra_content: { google: { thought_signature: "SIG-E" } } },
            ],
          },
        },
      ],
    }
    const text = `data: {"choices":[{"delta":{"role":"assistant","tool_calls":[{"extra_content":{"google":{"thought_signature":"CUT data: ${JSON.stringify(good)}\n\ndata: [DONE]\n\n`
    const bytes = new TextEncoder().encode(text)
    const res = GeminiSignature.incoming(
      new Response(
        new ReadableStream({
          start(controller) {
            // split mid-line, the way the network does
            controller.enqueue(bytes.slice(0, 40))
            controller.enqueue(bytes.slice(40))
            controller.close()
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
    )
    const events = (await res.text())
      .split("\n")
      .filter((line) => line.startsWith("data: {"))
      .map((line) => JSON.parse(line.slice(6)))
    expect(events).toEqual([good])
    expect(GeminiSignature.recall(id)).toBe("SIG-E")
  })

  test("a whole event that mentions data: is not split", () => {
    const line = `data: ${JSON.stringify({ choices: [{ delta: { content: 'send "data: {}"' } }] })}`
    expect(GeminiSignature.repair(line, new Map())).toBe(line)
  })
})
