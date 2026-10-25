# Task box and requests sent while a task runs

Status: draft for review, 2026-10-24.

## Goal

Each request the user sends is a **task**. The box above the composer names the task it tracks, and a
request sent while a task is running is either queued behind it in the same session or started at once
as a new session. Queued requests start on their own when the current task ends.

## What SiCode has today

| Piece | Today |
|---|---|
| Box above the composer | Titled "Checklist", with "1/4 steps" (`TurnChecklist`, `session-todo-dock.tsx`). It says nothing about which request the steps belong to |
| Sending while the agent works | Always **Steer** (sent into the running task). The queue code is still there, but upstream commit ae7e2eb3f ("remove queued follow-ups for now") forces the Follow-up behavior setting to Steer and the row is not in Settings. Step 2 turns queueing back on |
| Queued messages | A "N queued messages" dock with Send now and Edit (`session-followup-dock.tsx`). Stored per workspace on this computer |
| New session for a different task | The agent may call `suggest_session` after reading the message, which costs a turn and interrupts the running task |
| Request for another project | The new-project card: Switch to xxyyz or Add xxyyz as a related project (done 2026-10-24, under review) |

## What the user sees

### 1. The task box

- The title becomes **Task: name**, for example "Task: Restore Play tag and add Private tag". The step
  count stays on the right ("1/4 steps") and the box folds and unfolds as today.
- The name is the request's own short title: the title model already names sessions, and it names each
  request the same way when the request is sent. Until the name arrives, the first line of the request
  is shown, cut to about 60 characters.
- When requests are queued, one plain line at the bottom of the box says **Next: name** (with "+2 more"
  when there are several). Clicking it opens the queued list.

### 2. Sending while a task runs

When the agent is working, the composer's send button becomes two always-visible buttons, with no
pop-up and no red:

- **Queue** (primary, and what Enter does): the request waits in this session and starts by itself when
  the current task ends. It appears as "Next: name" in the task box, and as "1 queued" beside the
  session in the sidebar.
- **New session**: the request starts now in a new session in the same project, which runs alongside
  this one. The new session opens in the sidebar under the same project, and this session stays on
  screen.

Steer is no longer the default. It stays available as a third choice in the queued list (**Send now**,
which already exists), for a correction meant for the running task. The Follow-up behavior setting is
removed: Queue and New session are offered on every message instead.

When the agent is idle, the composer looks and works as today.

### 3. The queued list

The existing queued-messages dock, renamed **Queued tasks**. Each row shows the task name with three
actions: **Send now** (steer into the running task), **New session** (take it out of the queue and run
it now in its own session) and **Edit**. Removing a row is Edit, then clear the text.

When a task ends:

- The first queued request starts in the same session, with the full conversation as context. The task
  box switches to its name.
- If the task ended waiting for the user (a question or a permission prompt), the queue waits too.
- If the task failed or was stopped, the queue pauses and the box says **Queue paused** with
  **Continue** to start the next one. This uses the existing `followup.paused` state.

### 4. A queued or new-session request for another project

The queue and the new session both go through the same check as any first request. If the agent finds
the request is for a project that is neither the current one nor a related one, the new-project card
appears in the session where it runs (Switch to xxyyz / Add xxyyz as a related project). For a queued
request, that happens when it starts, not when it is queued.

## What to build

1. **Task names (server).** When a user message is created, ask the title model for a short name, as
   for session titles, and keep it on the message (`summary.title` already exists on user messages; use
   it; the field is in the message type but nothing fills it yet). The app reads it for the box.
2. **Task box (ui).** `TurnChecklist` takes a `name` and shows "Task: name". `session-todo-dock.tsx`
   passes the name of the user message the todos belong to, and the "Next: name" line from the queue.
3. **Composer (app).** While `busy()`, show Queue and New session instead of the send button. Queue is
   today's queue path. New session creates a session in the same directory and sends the request there,
   using the same create-and-send code as the new-project card (`session-project-dock.tsx`). Then remove
   the Follow-up behavior setting; an existing "steer" choice falls back to Queue.
4. **Sidebar (app).** "N queued" next to a session that has queued requests. It is read from the same
   follow-up store, so it is only known on this computer.
5. **Queued list (app).** Rename it, add New session on each row, and show task names. The queued text
   is not named by the server until it is sent, so queued rows show the first line of the text.

## Open questions

- Should the queue live on the server instead of on this computer, so it survives closing SiCode and
  can be seen from another device? Today it is stored locally per workspace. Recommended: keep it local
  for the first version.
- Should the agent still call `suggest_session` for unrelated requests, now that the user chooses New
  session up front? Recommended: keep it only for requests sent while the agent is idle.

## Order of work

1. Task box name and the "Next" line.
2. Queue and New session buttons, and removing the Follow-up behavior setting.
3. The queued list's New session action and the sidebar's "N queued".

Each step is built, tested and checked on screen separately.
