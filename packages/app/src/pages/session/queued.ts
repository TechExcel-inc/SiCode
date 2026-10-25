import { createStore } from "solid-js/store"

/**
 * How many requests wait in each session's queue, by session id, for the sidebar's "N queued". The
 * queue is stored per project folder and read by the session page, which keeps these counts current,
 * so a project's counts are known once one of its sessions has been opened.
 */
export const [queued, setQueued] = createStore<Record<string, number | undefined>>({})
