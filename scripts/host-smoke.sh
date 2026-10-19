#!/bin/bash
# A named smoke run for phase A (A3 in VS Code, A5 in Cursor): our .vsix installed into a fresh
# profile of a VS Code-family editor, isolated from the user's own (its own user-data and
# extensions folders). It connects to the replay agent playing R1 through the command palette,
# sends a prompt through a keybinding that passes text to jawataChat.sendPrompt, screenshots the
# window and keeps the recording. It drives the desktop (xdotool), so it is never part of npm test.
# Usage: host-smoke.sh <editor-command> <out-dir> <vsix> <contract-dir>
set -u
EDITOR_CMD=$1; OUT=$2; VSIX=$3; CONTRACT=$4
X=$OUT/profile
mkdir -p "$X/data/User" "$X/ext" "$OUT/jawata-host-smoke"
NODE=$(command -v node)
# SMOKE_AGENT (a JSON {command,args}), SMOKE_PROMPT and SMOKE_PROMPT_WAIT (seconds to wait for the answer) override the replay agent and the greeting, to run against a real agent
AGENT_JSON=${SMOKE_AGENT:-"{ \"command\": \"$NODE\", \"args\": [\"$CONTRACT/dist/bin/replay.js\", \"$CONTRACT/sessions/R1.jsonl\"] }"}
PROMPT=${SMOKE_PROMPT:-"hello from $EDITOR_CMD"}
cat > "$X/data/User/settings.json" <<EOF
{
  "jawataChat.agent": $AGENT_JSON,
  "jawataChat.recordSessions": true,
  "security.workspace.trust.enabled": false,
  "window.restoreWindows": "none",
  "update.mode": "none",
  "chat.disableAIFeatures": true,
  "workbench.startupEditor": "none",
  "workbench.tips.enabled": false
}
EOF
cat > "$X/data/User/keybindings.json" <<EOF
[ { "key": "ctrl+alt+8", "command": "jawataChat.connectAgent", "args": "agent" },
  { "key": "ctrl+alt+9", "command": "jawataChat.sendPrompt", "args": "$PROMPT" } ]
EOF

echo "== install"
"$EDITOR_CMD" --user-data-dir "$X/data" --extensions-dir "$X/ext" --install-extension "$VSIX" 2>&1 | grep -v DeprecationWarning
"$EDITOR_CMD" --user-data-dir "$X/data" --extensions-dir "$X/ext" --list-extensions --show-versions 2>/dev/null

# a window left from an earlier run would be found instead of the new one
if xdotool search --name "jawata-host-smoke" >/dev/null 2>&1; then echo "RESULT: a jawata-host-smoke window is already open; close it first"; exit 1; fi
echo "== launch"
"$EDITOR_CMD" --user-data-dir "$X/data" --extensions-dir "$X/ext" --new-window "$OUT/jawata-host-smoke" >/dev/null 2>&1 &
WIN=""
for i in $(seq 1 60); do
  WIN=$(xdotool search --onlyvisible --name "jawata-host-smoke" 2>/dev/null | head -1)
  [ -n "$WIN" ] && break
  sleep 1
done
[ -z "$WIN" ] && { echo "RESULT: no window appeared"; exit 1; }
echo "window $WIN"
sleep 8
import -window "$WIN" "$OUT/1-opened.png"

echo "== connect"
xdotool windowactivate --sync "$WIN"; sleep 0.5
# a fresh profile may open a first-run dialog; Escape closes it without choosing anything
xdotool key --clearmodifiers Escape; sleep 1; xdotool key --clearmodifiers Escape; sleep 1
import -window "$WIN" "$OUT/1b-dismissed.png"
# connect through a keybinding: a command palette cannot always be driven by synthetic typing
xdotool key --clearmodifiers ctrl+alt+8; sleep 6
import -window "$WIN" "$OUT/2-connected.png"

# the chat view is opened by its own command (bound to ctrl+alt+j); a connected agent alone does not show the page
xdotool windowactivate --sync "$WIN"; sleep 0.5
xdotool key --clearmodifiers ctrl+alt+j; sleep 4
import -window "$WIN" "$OUT/2b-chat-open.png"

echo "== prompt"
xdotool windowactivate --sync "$WIN"; sleep 0.5
xdotool key --clearmodifiers ctrl+alt+9; sleep ${SMOKE_PROMPT_WAIT:-6}
import -window "$WIN" "$OUT/3-prompted.png"

echo "== recording"
ls -la "$X/data/User/globalStorage/jawata.jawata-chat/recordings/" 2>&1
cp "$X"/data/User/globalStorage/jawata.jawata-chat/recordings/*.jsonl "$OUT/" 2>/dev/null

PID=$(xdotool getwindowpid "$WIN" 2>/dev/null)
[ -n "$PID" ] && kill "$PID" 2>/dev/null

echo "== verdict"
REC=$(ls "$OUT"/*.jsonl 2>/dev/null | head -1)
[ -z "$REC" ] && { echo "RESULT: no recording was written"; exit 1; }
node "$CONTRACT/dist/bin/compare.js" "$REC" "$CONTRACT/sessions/R1.jsonl"
