import fs from "fs"
import path from "path"
import { Global } from "../global"
import { Instance } from "../project/instance"

/**
 * Lets SiCode install a new build of a desktop app, including itself, and come back afterwards.
 * Quitting the app ends its server and its jobs, so the last step runs in a helper outside it: the
 * helper detaches, asks the app to quit normally, waits for it (never forcing it: a forced quit once
 * lost the EAD Pilot sign-in while settings were being saved), swaps in the new build, reopens it and
 * leaves a note. On the next start, the note goes to the session that asked, which then continues.
 */
export namespace Reinstall {
  export const SCRIPT = `#!/bin/sh
# SiCode's installer helper: replaces a desktop app with a new build and reopens it.
# Usage: "$SICODE_REINSTALL" <new .app> [installed .app]
set -u
NEW="$1"
case "$NEW" in /*) ;; *) NEW="$PWD/$NEW" ;; esac
NAME=$(basename "$NEW" .app)
TARGET="\${2:-\${SICODE_APPLICATIONS:-/Applications}/$NAME.app}"
NOTE="\${SICODE_NOTE:-}"
note() {
  [ -n "$NOTE" ] || return 0
  printf '{"session":"%s","directory":"%s","app":"%s","status":"%s","version":"%s","detail":"%s"}\\n' \\
    "\${SICODE_SESSION:-}" "\${SICODE_DIRECTORY:-}" "$NAME" "$1" "$2" "$3" > "$NOTE"
}
if [ "\${SICODE_DETACHED:-}" != 1 ]; then
  [ -d "$NEW" ] || { echo "There is no app at $NEW. Build it first."; exit 1; }
  LOG="\${NOTE:-/tmp/sicode-reinstall}.log"
  # In its own session, so it outlives the app it is about to quit.
  SICODE_DETACHED=1 perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' -- /bin/sh "$0" "$NEW" "$TARGET" > "$LOG" 2>&1 < /dev/null &
  echo "Installing $NAME: it quits, is replaced by the new build and reopens by itself. Log: $LOG"
  exit 0
fi
sleep 2
EXE=$(defaults read "$TARGET/Contents/Info" CFBundleExecutable 2>/dev/null || echo "$NAME")
running() { pgrep -f "$TARGET/Contents/MacOS/$EXE" > /dev/null 2>&1; }
if running; then
  if [ -n "\${SICODE_QUIT:-}" ]; then sh -c "$SICODE_QUIT"; else osascript -e "tell application \\"$TARGET\\" to quit" > /dev/null 2>&1; fi
  i=0
  while running && [ $i -lt 60 ]; do sleep 1; i=$((i+1)); done
  if running; then note failed "" "$NAME did not quit within 60 seconds, so nothing was replaced"; exit 1; fi
  # The app has saved its settings and quit; what it started from its bundle (its server) can go now.
  pkill -f "$TARGET/Contents/MacOS/" > /dev/null 2>&1
  sleep 1
fi
rm -rf "$TARGET.previous"
[ -d "$TARGET" ] && mv "$TARGET" "$TARGET.previous"
if ! cp -R "$NEW" "$TARGET"; then
  rm -rf "$TARGET"
  [ -d "$TARGET.previous" ] && mv "$TARGET.previous" "$TARGET"
  note failed "" "copying the new build failed, so the previous version was put back"
  [ "\${SICODE_NO_OPEN:-}" = 1 ] || open "$TARGET"
  exit 1
fi
rm -rf "$TARGET.previous"
xattr -dr com.apple.quarantine "$TARGET" > /dev/null 2>&1
VERSION=$(defaults read "$TARGET/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo "")
note done "$VERSION" ""
[ "\${SICODE_NO_OPEN:-}" = 1 ] || open "$TARGET"
`

  const dir = () => path.join(Global.Path.data, "reinstall")
  export const note = () => path.join(dir(), "note.json")

  /** Writes the helper (again when SiCode changed it) and returns its path. */
  export function script() {
    const file = path.join(dir(), "reinstall.sh")
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== SCRIPT) {
      fs.mkdirSync(dir(), { recursive: true })
      fs.writeFileSync(file, SCRIPT, { mode: 0o755 })
    }
    return file
  }

  /** What every background job gets, so an install command can call the helper. */
  export function env(sessionID: string) {
    return {
      SICODE_REINSTALL: script(),
      SICODE_NOTE: note(),
      SICODE_SESSION: sessionID,
      SICODE_DIRECTORY: Instance.directory,
    }
  }

  type Note = { session: string; directory: string; app: string; status: "done" | "failed"; version: string; detail: string }

  /** The note the helper left for this project, removed once read. */
  export function take() {
    const file = note()
    if (!fs.existsSync(file)) return
    const data = (() => {
      try {
        return JSON.parse(fs.readFileSync(file, "utf8")) as Note
      } catch {
        return
      }
    })()
    if (!data || (data.directory && data.directory !== Instance.directory)) return
    fs.rmSync(file, { force: true })
    return data
  }

  export function message(data: Note) {
    if (data.status === "done")
      return `${data.app} was installed and reopened${data.version ? `: it is now version ${data.version}` : ""}. Continue the work that was waiting on this update, and tell the user it is done.`
    return `Installing ${data.app} did not finish: ${data.detail}. Tell the user, and what they can do.`
  }

  /** On start: tells the session that asked for the install how it went, which continues its work. */
  export async function resume() {
    const data = take()
    if (!data?.session) return
    const { SessionPrompt } = await import("../session/prompt")
    await SessionPrompt.prompt({
      sessionID: data.session as never,
      parts: [
        {
          type: "text",
          synthetic: true,
          text: message(data),
          metadata: { update: { app: data.app, version: data.version, status: data.status } },
        },
      ],
    }).catch(() => undefined)
  }
}
