/** The key a session's remote-coding choice is kept under: the session, or its folder before the session exists. */
export function placeKey(session: string | undefined, dir: string) {
  return session ?? `dir:${dir}`
}
