# UX report: the chat view after S12b (proposal only; nothing was edited by this report)

Seat: `/ux`. Subject: `packages/chat-view/src/*.tsx` and its stylesheet as rebuilt in S12b, seen in the real VS Code screenshots `s12b-vscode-turn-r2.png`, `s12b-vscode-slash-r3.png` and `s12b-vscode-empty-state.png` in this folder.
`jawata-project.md` does not exist in this repository, so the project's own four facts could not be quoted. Assumed, not declared: stack TypeScript, React 19, jsdom tests; source roots `packages/*/src`; green means `npm test` at the repository root passes.
Store: `experience(nominate)` returned 8 candidates, none applied (`decide` with none selected).

## 1. Reachability, measured

On a real screen at the side-bar width (about 375 px): the banner, the message area, the picker row, the text field and Send are all on screen at once (`s12b-vscode-turn-r2.png`). The picker row wraps to a second line instead of overflowing. The message area scrolls (`.messages { overflow-y: auto; min-height: 0 }`), the input area does not shrink (`flex: none`), the text field grows with its text to 240 px and then scrolls. The `/` list is 200 px high and scrolls (`s12b-vscode-slash-r3.png`). With no agent connected the sentence and both buttons are on screen (`s12b-vscode-empty-state.png`).
Not measured: an open picker list (opens upward, 240 px scroll), the view in a pane narrower than the side bar, a light theme.

## 2. Census: 29 blocks rendered; 29 judged by reading the source; 16 of the 29 seen on a real screen

Seen on a real screen: 1, 2, 4, 7, 8, 9, 10, 14, 15, 16, 17, 20, 21, 24, 27, 28. Not seen: 3, 5, 6, 11, 12, 13, 18, 19, 22, 23, 25, 26, 29 (they were exercised in jsdom, which has no layout, so how they look or whether they fit is not claimed).

## 3. One row per block

"Asked for by" quotes the plan (the sprint plan, the S12b deliverables) or his words in this session. *The reader and the decision are mine; where I could not write the second kind of sentence the block is flagged.*

| # | Block | Reader, in which situation | What they decide or change | Asked for by |
|---|---|---|---|---|
| 1 | Banner: status dot (mouseover "Connected to X") | person who has a chat open | whether the agent is still there | asked for by nothing as its own block; kept as part of the banner line |
| 2 | Banner: agent name or session title (mouseover: the working folder) | person with several workspaces | whether the agent is in the right project | S12b: "the /ux report's removals and mouseovers" (the folder line became a mouseover) |
| 3 | Banner: spinner while a turn runs | person waiting for an answer | nothing, except to stop it with Stop | asked for by nothing; the /ux report proposed removing it, withdrawn on his words (see section 5) |
| 4 | Banner: Disconnect button | person who wants to end the agent | end it, or then connect again | S12b criterion 5: "the chat view's banner offers the agent choice" (my reading: see section 5) |
| 5 | Load overlay spinner | person who just opened an old session | waits | asked for by nothing as its own block |
| 6 | Load overlay text "Loading the conversation…" | same | waits; typing is blocked so nothing is lost | asked for by nothing |
| 7 | Empty state: "No agent is connected." | person with no agent | whether to connect or configure | S12b: "the /ux report's removals" (icon, title, hint removed; one sentence kept) |
| 8 | Button "Connect" (mouseover: starts the program in `jawataChat.agent` and opens a session) | same | connect | S11: "named intents (open settings, connect, and so on)" |
| 9 | Button "Configure" (mouseover: opens the setting) | person with no agent set | open the setting | same |
| 10 | User message | person reading the conversation back | nothing, it is the record | S12 criterion 7: "the view renders a `userPrompt`" |
| 11 | Error message (mouseover: sending again tries again) | person whose action failed | retry or reconnect | asked for by nothing (the core posts `error`; no sentence asks for it to show) |
| 12 | Plan title "Plan" | person following a multi-step answer | nothing | S13 P14: "the current stage and its checkpoint stay on screen" (not yet built) |
| 13 | Plan entry with status icon | same | whether to let it continue or stop it | same |
| 14 | Assistant text (plain while it streams, markdown after) | person reading the answer | everything | S12 criterion 1: "the answer text" |
| 15 | Tool summary "▾ N tool calls" (mouseover: show or fold) | person scanning a long turn | expand or fold the calls | S13 B2/P1: "the folded tool line" |
| 16 | Tool line: status icon (mouseover: running, completed, failed) | person checking what the agent did | trust or stop it | S12 criterion 1 and S13 B2/P1: "its status" |
| 17 | Tool line: title | same | same | S12 criterion 1: "the tool call's title" |
| 18 | Thought summary "Thinking…" / "Thought" (mouseover: click to read the reasoning) | person watching the agent | open it, or stop an agent that is off track | S13 P2: "thinking as one folded line"; Claude sends at most a summary, so this line may stay empty (his words, 2026-10-19) |
| 19 | Thought content | same | judge the reasoning | same |
| 20 | `/` list item: name | person choosing a command | which one to run | S12 criterion 1: "the `/` entries" |
| 21 | `/` list item: purpose | same | which one to run | S13 B3/P7: "each entry with its purpose" |
| 22 | Attached-file chip: name (mouseover: the path) | person who attached a file | nothing, it is the record | S12 criterion 7: "the view renders a ... `file-attached`" |
| 23 | Attached-file chip: × (mouseover: take this file out of the next prompt) | same | remove it | S12b: "a way to remove an attached-file chip" |
| 24 | Picker button (icon, label, arrow; mouseover: what the value means) | person choosing mode, model or effort | what the next answer uses | S14 B6 "one model selector per seat"; S13 B4 says the mode control must NOT show (held: see section 5) |
| 25 | Picker group heading | person choosing among grouped options | the group | asked for by nothing (shown only when the agent sends groups) |
| 26 | Picker item: check, name (mouseover: its description) | same | the value | same as 24 |
| 27 | Text field and its placeholder (grows with the text) | person writing | the prompt | S12 criterion 1 (the `/` entries); S12b: the resize handle is replaced by growth |
| 28 | Send (mouseover "Send (Enter)") | person sending | send | asked for by nothing as a block; the intent is in the contract |
| 29 | Stop (mouseover "Stop the running answer (Esc)") | person interrupting | stop | same; the Escape key now works because the page sets `jawataChat.turnInProgress` |

## 4. The view as it now is

Kept, with text and mouseover as in the table. Removed in S12b, with the reason: robot icon, title "ACP Chat", subtitle, hint "or press Ctrl+Alt+J" (no reader decides with them); header "Commands" above the `/` list (the list is obviously commands); the resize handle (replaced by a field that grows); the separate working-folder line (now the mouseover of the name). Flagged but kept: 3 (spinner, until S13's waiting line replaces it), 5 and 6 (the overlay: one block would do, a 2-block overlay is cosmetic), 25 (shown only when the agent sends groups).

## 5. Decisions owed to him (self-approving deviations and contradictions)

1. **The banner's Disconnect button is my reading of "the agent choice".** With one agent set in `jawataChat.agent` there is nothing to choose between; connecting is the empty state's button, ending is the banner's. If he meant something else (a list of agents, a restart), say what.
2. **Two intents and one message were added to the view contract** (`disconnectAgent`, `detachFile`, and `file-detached`). Every host that relays the contract (Theia, Eclipse, a relay) must carry them. I cannot see consumers outside this workspace; the question "is every consumer inside this workspace?" is his.
3. **The conversation is now cleared when the session ends or another begins**, so the old conversation no longer stays on screen after a disconnect (it did before, with no way to connect; found in the screenshot). A person who disconnects loses sight of the last answer.
4. **The Agents tree is gone, and with it the list of past sessions.** A command "jawata chat: Open Session…" (a quick pick of what the agent lists) replaces it until S15 places history. A person who browsed past sessions in the tree now has one command instead of a pane.
5. **The /ux report's removal of the spinner is not applied**, on his words ("We could send our own until he writes back…"): the chat's own waiting line is S13's. Until then the banner spinner is the only sign that the agent works. The plan's S12b deliverable list still names the spinner as removed and must be corrected.
6. **The mode picker is still shown** (S13 B4 says no mode control shows). Held until 28h works, on his ruling.
7. **The picker icons and the tool status icons are emoji and text glyphs** (⚡ 🧠 💭 ⚙ ✓ ✗ ⟳); they look different on each operating system. No sentence asks for them.

## 6. Not reached

13 of 29 blocks on a real screen (see section 2); an open picker list; the view in a narrower pane; a light theme; the keyboard order of the picker and `/` lists; Eclipse's widget.
