# UX report: the S12 chat view (proposal only; nothing was edited)

Seat: `/ux`. Subject: `packages/chat-view/src/*.tsx` as built in S12, run against the real VS Code screenshots in this folder.
`jawata-project.md` does not exist in this repository, so the project's own four facts could not be quoted. Assumed, not declared: stack TypeScript, React 19, jsdom tests; source roots `packages/*/src`; green means `npm test` at the repository root passes.

## 1. Reachability, measured

Seen on a real screen (`s12-vscode-turn-r2.png`, `s12-vscode-slash-r3.png`, and a run at a 340 px side bar): the banner, the message area, the input area and the Send button are all on screen at once. The message area scrolls (`.messages` has `overflow-y: auto`; the root is a full-height flex column). The `/` list is 200 px high and scrolls, so every command is reachable by scrolling or by typing more letters. The open picker list opens upward (`bottom: 100%`) with a 240 px scroll.
Not reachable in the one place I tried: in Theia's side bar the Chat pane under the Agents pane was about 60 px high (`s12-theia-agents-pane.png`). That is Theia's pane layout, and the Agents pane is being removed, so it should be re-checked after that.

## 2. Census: 29 blocks rendered; 29 judged by reading the source; 12 of the 29 seen on a real screen

Seen on a real screen: 1, 2, 3, 12, 18, 19, 20, 21, 22, 25, 28, 29. The other 17 were exercised only in jsdom, which has no layout, so I cannot say how they look or whether they fit. Not rendered at all: Eclipse's widget, a narrow Theia pane.

## 3. One row per block

"Asked for by" quotes the plan (the sprint plan). The clause that introduced most blocks is the S12 design sentence *"The earlier page file is deleted in this stage, once the view plays the goldens"*: the goldens hold only the message stream, so the earlier page quietly became the specification for every block and the view copied it block for block.

| # | Block | Reader, in which situation | What they decide or change | Asked for by |
|---|---|---|---|---|
| 1 | Banner: status dot | person with a chat open, wondering if the agent is still there | whether to reconnect | asked for by nothing (copied from the earlier page) |
| 2 | Banner: agent name or session title | person with several sessions | which session this is | asked for by nothing |
| 3 | Banner: working folder | person with several workspaces | whether the agent is in the right project | asked for by nothing |
| 4 | Banner: spinner while working | person waiting for an answer | nothing: the Stop button and "Thinking…" already say so | asked for by nothing |
| 5 | Load overlay "Loading conversation history…" | person who just opened an old session | waits; typing is blocked so nothing is lost | asked for by nothing |
| 6 | Empty state: robot icon | nobody | nothing | asked for by nothing |
| 7 | Empty state: title "ACP Chat" | nobody; "ACP" is jargon to the person | nothing | asked for by nothing |
| 8 | Empty state: subtitle | person with no connection | what to do next | asked for by nothing |
| 9 | Button "Connect to Agent" | person with no connection | connect | S11 design: "named intents (open settings, connect, and so on)" |
| 10 | Button "Configure Agent" | person with no agent set | open the agent setting | same sentence |
| 11 | Hint "or press Ctrl+Alt+J anytime" | person who is already inside the chat | nothing | asked for by nothing |
| 12 | User message | person reading back the conversation | nothing, it is the record | S12 criterion 7: "the view renders a `userPrompt`" |
| 13 | Error message | person whose action failed | retry or reconnect | asked for by nothing (the core posts `error`; no sentence asks for it to show) |
| 14 | Plan title "Plan" | person following a multi-step answer | nothing | S13 P14: "the current stage and its checkpoint stay on screen" (not yet built) |
| 15 | Plan entry with status icon | same | whether to let it continue or stop it | same |
| 16 | Thought summary "Thinking…" / "Thought" | person watching the agent | open it, or stop an agent that is off track | S13 P2: "thinking as one folded line" (not yet built) |
| 17 | Thought content | same | judge the reasoning | same |
| 18 | Assistant text | person reading the answer | everything | S12 criterion 1: "the answer text" |
| 19 | Tool summary "▾ N tool calls" | person scanning a long turn | expand or fold the calls | S13 B2: "the folded tool line" (not yet built) |
| 20 | Tool line: icon and title | person checking what the agent did | whether to trust or stop it | S12 criterion 1: "the tool call's title" |
| 21 | `/` list header "Commands" | person typing `/` | nothing: the list is obviously commands | asked for by nothing |
| 22 | `/` list item: name and purpose | person choosing a command | which one to run | S12 criterion 1: "the `/` entries"; S13 P7: "each entry with its purpose" |
| 23 | Input resize handle | person writing a long prompt | the height of the input | asked for by nothing; no mouseover |
| 24 | Attached-file chip | person who attached a file | nothing: there is no way to remove it | S12 criterion 7: "the view renders a ... `file-attached`" |
| 25 | Picker button (icon, label, arrow) | person choosing mode, model or effort | what the next answer uses | S14 B6 "one model selector per seat"; S13 B4 says the mode control must NOT show |
| 26 | Picker group heading | person choosing among grouped options | the group | asked for by nothing (the agent sends groups; kept only if sent) |
| 27 | Picker item: check, name, description as mouseover | same | the value | same as 25 |
| 28 | Message input and its placeholder | person writing | the prompt | S12 criterion 1 (the `/` entries); the placeholder says "or / for commands", which is enough |
| 29 | Send / Stop button | person sending or interrupting | send or stop | asked for by nothing as a block; the Stop intent is in the contract |

## 4. Proposed view: what stays, what goes

Removed, with the reason:
- 4 (spinner), 6 (icon), 7 (title), 8 (subtitle merged into 9/10), 11 (hint), 21 (list header): no reader makes a decision from them.
- 23 (resize handle): replace by an input that grows with the text, so nobody has to resize.

Kept, with the text and mouseover each needs:
- **Banner**: agent name or title, with the working folder as the mouseover (3 folded into 2); the dot becomes part of it, mouseover "connected to <agent>". Hidden while no session exists.
- **Empty state**: one sentence, "No agent is connected.", and two buttons. "Connect" mouseover: "Starts the program set in the `jawataChat.agent` setting and opens a session." "Configure" mouseover: "Opens the `jawataChat.agent` setting where the program is set." Both texts must state what happens; today neither does.
- **Messages**: user message, assistant text, error (mouseover: "The agent or the connection reported this; sending again retries"), plan, thought line (mouseover "Click to read the agent's reasoning"), tool summary (mouseover "Click to show or fold the calls"), tool line with status icon (mouseover "completed" or "failed").
- **Input**: placeholder as now; Send (mouseover "Send (Enter)"), Stop (mouseover "Stop the running answer (Esc)"); the pickers with their descriptions as mouseovers (kept); attached-file chip with a "×" to remove it and the path as mouseover.
- **Load overlay**: kept.

## 5. Decisions owed to him

1. **S13 B4 contradicts the view today.** The plan says "no mode control: ... shows no mode control", but the view shows the mode picker ("Manual") because the agent sends it as a config option. Until S13 lands, the view breaks the plan's own sentence.
2. **Self-approved deviations in the C12 record** that change what the person sees, declared in a plan he did not read: the picker's hover tooltip dropped (the description became the item's `title`); the thought's duration dropped; an attached file goes into the prompt as a `[file: path]` text line, so the person sees raw bracket text in their own message and the model receives text, not a file; a prompt sent with no session shows only the error. Each is a decision for him, not bookkeeping.
3. **The sentence that made the earlier page the spec:** "once the view plays the goldens". The plan should name the blocks instead; otherwise the next restyle copies every block again.

## 6. Not reached

17 of 29 blocks on a real screen (see section 2); Eclipse's widget; a narrow Theia pane after the Agents pane is removed; contrast in a light theme; keyboard order of the picker lists.

## 7. Store

Consulted for similar cases; none applied (selected nothing). Outcome to be recorded after his verdict.

## 8. Amended after the report (2026-10-19, his words)

Block 4 (the spinner) was proposed for removal because "Thinking…" already says the agent is working. That holds only if the agent sends thinking, and Claude sends at most a summary. He ruled: *"We could send our own until he writes back. Thinking............... or so or really returning something if he shows something like tool usage."* The proposal to remove block 4 is withdrawn; the chat owns a waiting line (plan S13, row P2) and it takes over the spinner's job (the editor's reading: the banner spinner is then redundant and the Stop button stays; this report does not decide it). The rest of section 4 stands.
