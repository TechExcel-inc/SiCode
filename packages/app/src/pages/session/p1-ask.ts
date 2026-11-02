import { useParams } from "@solidjs/router"
import type { Part } from "@opencode-ai/sdk/v2"
import { useSDK } from "@/context/sdk"

/** Asks the AI one question in a hidden session under the current one, and gives back its reply's text. */
export function useAsk() {
  const sdk = useSDK()
  const params = useParams()
  return async (prompt: string, system: string) => {
    const child = await sdk.client.session.create({ parentID: params.id, title: "p1" })
    const id = child.data!.id
    const res = await sdk.client.session
      .prompt({ sessionID: id, agent: "plan", system, parts: [{ type: "text", text: prompt }] })
      .finally(() => sdk.client.session.delete({ sessionID: id }).catch(() => undefined))
    return words(res.data?.parts ?? [])
  }
}

/** The text of a reply, without any thinking it shows. */
function words(parts: Part[]) {
  return parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
    .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
    .trim()
}
