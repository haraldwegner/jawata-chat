#!/bin/bash
# What the smoke scripts share (ledger 28i-C7-4): finding the window, one step (focus, a keybinding, a wait, a screenshot) and the
# verdict against R1. Sourced by host-smoke.sh and theia-smoke.sh after they set OUT and CONTRACT. It drives the desktop by keys and
# never by a click at a fixed position (test/smoke-scripts.test.mjs holds that), and it is never part of npm test.

# Refuse when a window of this name is open: an earlier run's window would be found instead of the new one.
smoke_refuse_open() {
  if xdotool search --name "$1" >/dev/null 2>&1; then echo "RESULT: a $1 window is already open; close it first"; exit 1; fi
}

# Wait up to $2 seconds for a visible window named $1, let it settle $3 seconds and screenshot it; sets WIN. Fails when none appears.
smoke_wait_window() {
  WIN=""
  for i in $(seq 1 "$2"); do
    WIN=$(xdotool search --onlyvisible --name "$1" 2>/dev/null | head -1)
    [ -n "$WIN" ] && break
    sleep 1
  done
  [ -z "$WIN" ] && return 1
  echo "window $WIN"
  sleep "$3"
  import -window "$WIN" "$OUT/1-opened.png"
}

# Answer the editor's own dialogs before a step; a script whose editor opens such dialogs defines it again.
smoke_dismiss() { :; }

# One step: focus the window, answer dialogs, press the keybinding $1, wait $2 seconds, screenshot as $3.png.
smoke_step() {
  xdotool windowactivate --sync "$WIN"; sleep 0.5
  smoke_dismiss
  xdotool key --clearmodifiers "$1"; sleep "$2"
  import -window "$WIN" "$OUT/$3.png"
}

# Close the window the run opened.
smoke_close_window() {
  PID=$(xdotool getwindowpid "$WIN" 2>/dev/null)
  [ -n "$PID" ] && kill "$PID" 2>/dev/null
}

# The recording the run kept, compared with R1.
smoke_verdict() {
  echo "== verdict"
  REC=$(ls "$OUT"/*.jsonl 2>/dev/null | head -1)
  [ -z "$REC" ] && { echo "RESULT: no recording was written"; exit 1; }
  node "$CONTRACT/dist/bin/compare.js" "$REC" "$CONTRACT/sessions/R1.jsonl"
}
