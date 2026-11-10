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
