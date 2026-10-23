#!/bin/bash
# A named smoke run for phase A, A4: our .vsix in the Theia IDE, isolated from the user's own Theia
# (its own HOME). The extension is unpacked into a plugins folder Theia loads with
# --plugins=local-dir:. It connects to the replay agent playing R1 through the command palette,
# sends a prompt through a keybinding that passes text to jawataChat.sendPrompt, screenshots the
# window and keeps the recording. It drives the desktop (xdotool), so it is never part of npm test.
# Usage: theia-smoke.sh <TheiaIDE.AppImage> <out-dir> <vsix> <contract-dir>
set -u
APP=$1; OUT=$2; VSIX=$3; CONTRACT=$4
H=$OUT/home
mkdir -p "$H/.theia-ide" "$OUT/plugins/jawata-chat" "$OUT/jawata-theia-smoke"
unzip -q -o "$VSIX" 'extension/*' -d "$OUT/unpacked" && cp -r "$OUT/unpacked/extension/." "$OUT/plugins/jawata-chat/"
NODE=$(command -v node)
# SMOKE_AGENT (a JSON {command,args}), SMOKE_PROMPT and SMOKE_PROMPT_WAIT (seconds to wait for the answer) override the replay agent and the greeting, to run against a real agent
AGENT_JSON=${SMOKE_AGENT:-"{ \"command\": \"$NODE\", \"args\": [\"$CONTRACT/dist/bin/replay.js\", \"$CONTRACT/sessions/R1.jsonl\"] }"}
PROMPT=${SMOKE_PROMPT:-"hello from Theia"}
cat > "$H/.theia-ide/settings.json" <<EOF
{
  "jawataChat.agent": $AGENT_JSON,
  "jawataChat.recordSessions": true
}
EOF
cat > "$H/.theia-ide/keymaps.json" <<EOF
[ { "keybinding": "ctrl+alt+7", "command": "jawataChat.openChat" },
  { "keybinding": "ctrl+alt+8", "command": "jawataChat.connectAgent", "args": "agent" },
  { "keybinding": "ctrl+alt+9", "command": "jawataChat.sendPrompt", "args": "$PROMPT" } ]
EOF

# a window left from an earlier run would be found instead of the new one
. "$(dirname "$0")/smoke-lib.sh"
smoke_refuse_open "jawata-theia-smoke"
echo "== launch"
# a caller running inside an Electron editor passes ELECTRON_RUN_AS_NODE=1, which makes Theia start as plain Node
env -u ELECTRON_RUN_AS_NODE -u VSCODE_IPC_HOOK HOME="$H" "$APP" --appimage-extract-and-run --plugins=local-dir:"$OUT/plugins" "$OUT/jawata-theia-smoke" > "$OUT/theia.log" 2>&1 &
APP_PID=$!
smoke_wait_window "jawata-theia-smoke" 90 15 || { echo "RESULT: no Theia window appeared"; tail -20 "$OUT/theia.log"; kill $APP_PID 2>/dev/null; exit 1; }

# Theia opens modal dialogs of its own (create a launcher, create a .desktop file) that take the
# keyboard; Escape answers each "no"
smoke_dismiss() { for i in 1 2 3; do xdotool key --clearmodifiers Escape; sleep 1; done; }

echo "== connect"
# synthetic typing does not reach Theia's palette input, so connect through a keybinding
smoke_step ctrl+alt+8 10 2-connected
# the chat view is opened by its own command; a connected agent alone does not show the page
smoke_step ctrl+alt+7 4 2b-chat-open

echo "== prompt"
smoke_step ctrl+alt+9 "${SMOKE_PROMPT_WAIT:-10}" 3-prompted

echo "== recording"
find "$H" -path '*jawata*recordings*' -name '*.jsonl' 2>/dev/null
find "$H" -path '*jawata*recordings*' -name '*.jsonl' -exec cp {} "$OUT/" \; 2>/dev/null
grep -iE "jawata|error" "$OUT/theia.log" | head -20

smoke_close_window
kill $APP_PID 2>/dev/null
smoke_verdict
