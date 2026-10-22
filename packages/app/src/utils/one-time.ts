// Plain helpers for one-time sessions, kept apart from the components so they can be tested.

/** The readable part of an error, including the server's `{ name, data: { message } }` errors. */
export function errorText(err: unknown) {
  if (err instanceof Error) return err.message
  if (err && typeof err === "object") {
    const item = err as { name?: unknown; data?: { message?: unknown }; message?: unknown }
    if (typeof item.data?.message === "string") return item.data.message
    if (typeof item.message === "string") return item.message
    if (typeof item.name === "string") return item.name
  }
  return String(err ?? "")
}

type OnceSession = {
  id: string
  oneTime?: { originSessionID?: string; status: string; model: { providerID: string; modelID: string } }
}

/** The open one-time session a parent session already has on this model, if any. */
export function findOpenOnce<T extends OnceSession>(
  sessions: T[],
  origin: string,
  model: { providerID: string; modelID: string },
) {
  return sessions.find(
    (s) =>
      s.oneTime?.status === "open" &&
      s.oneTime.originSessionID === origin &&
      s.oneTime.model.providerID === model.providerID &&
      s.oneTime.model.modelID === model.modelID,
  )
}
