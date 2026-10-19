# UX report: the chat view after S13 (a proposal; this report edited nothing, the fixes named in section 4 were made by the stage afterwards)

Seat: `/ux`. Subject: `packages/chat-view/src/*.tsx` and its stylesheet at commit `43ace0b`, and real VS Code screenshots in this folder: `s13-vscode-plan-r10.png`, `s13-vscode-slash-r3.png`, `s13-vscode-turn-r2.png`.
`jawata-project.md` does not exist in this repository, so the project's four facts could not be quoted. Assumed, not declared: TypeScript, React 19, jsdom tests; source roots `packages/*/src`; green means `npm test` at the repository root passes.
Store: `experience(nominate)` returned 8 candidates (hooks, permission requests, attribution); none concerns a chat view; `decide` with none selected.

## 1. Reachability, measured

On a real screen at side-bar width: banner, message area, picker row, text field and the send button are on screen together (`s13-vscode-plan-r10.png`). The message area scrolls (`.messages { overflow-y: auto; min-height: 0 }`). Two blocks that can grow without limit are now bounded and scroll: the plan (`max-height: 30%`) and, after this review, the queue (`max-height: 6em`; the queue was unbounded at `43ace0b`, found by this report and fixed). The `/` list is capped at 200 px and scrolls. Not measured: a plan of 30 entries on a real screen (the rule is asserted by `styles.test.mjs`, not seen), a pane narrower than the side bar.

## 2. Census: 41 blocks rendered; 41 judged by reading the source; 14 seen on a real screen

Seen: banner dot, name, Disconnect; plan title and entries; user message; assistant text; tool run summary, kind icon, status icon, title; `/` group heading, name and description; picker button; text field; send. Not seen (exercised in jsdom, which has no layout, so how they look is not claimed): version notice, load overlay (2), empty state (3), user file chip, error, tool Input, diff, content, Output, thought summary and content, waiting line and its tool name, attached chip name and ×, queue box, queued text, Send now, picker heading and item, Stop.

## 3. One row per block (blocks new or changed by S13; the 24 unchanged ones are in `ux-s12b-view-report.md`)

| Block | Reader, in which situation | Decides or changes | Asked for by |
|---|---|---|---|
| Version notice (mismatch) | person whose editor was updated but not reloaded | reload the window | S13 step 0a: "the view checks `contractVersion` and the core refuses a snapshot of another version" |
| Plan title, plan entries | person following a long answer | let it run or press Stop | S13 P14: "the current stage and its checkpoint stay on screen" |
| User file chip name | person reading the conversation back | nothing, it is the record | S13 step 0a: "attachments travel in the `sendPrompt` intent"; the chip is *asked for by nothing* as its own block, kept as the record of what was sent |
| Tool run summary "▾ N tool calls" | person scanning a long answer | fold or open the calls | S13 B2/P1 "the folded tool line" |
| Tool kind icon | same | tell reads from writes from commands at a glance | S13 B2/P1: "an icon for its kind" |
| Tool status icon, title | same | trust or stop the agent | same: "its status", "title" |
| Tool Input / diff / Output | person checking what the agent did | accept the change or stop | same: "unfolded: input, output, diff" |
| Tool terminal note | person whose tool ran a command | open the editor's terminal | same, by "content"; **flagged**: it printed the terminal's internal id, which no person can use; now plain words, no id |
| Thought "Thought" and its content | person watching the agent | read why, or stop an agent that is off track | S13 P2: "thinking as one folded line" |
| Waiting line "Thinking…" with dots; tool name | person waiting for an answer | wait, or press Stop | his words: "We could send our own until he writes back. Thinking............... or so or really returning something if he shows something like tool usage" |
| `/` group heading (mouseover says what the group is) | person choosing a command | which group to look in | S13 B3/P7: "`/` in the three groups" |
| `/` entry description | same | which command | S13 B3/P7: "each entry with its purpose"; **flagged**: the line cut it off (`…`) and nothing showed the rest; the whole text is now the mouseover |
| Queue box and queued text | person who typed during an answer | wait, or send now | S13 P12: "a message typed during a turn is queued and sent when it ends"; the text was cut with no way to read it, now a mouseover |
| Send now | same | interrupt the running answer | S13 P12: "'send now' cancels the turn first" |
| Send / Queue label | same | whether Enter sends or queues | S13 P12; *the label change is asked for by nothing* beyond that sentence |
| Stop | person interrupting | stop | S12 criterion; kept |

Blocks removed by S13: the banner spinner (replaced by the waiting line, on his words above) and the "thought indicator" blink.

## 4. The view as it now is

Kept as the table says. Changed by this report's findings, made in `d99728e` and the commit after it: mouseovers on `/` entries and queued text; the queue is bounded; the terminal note shows no id. Removed with the reason: the banner spinner (the waiting line says the same with more).

## 5. Decisions owed to him (self-approving deviations and contradictions)

1. **The view contract number 2 is the editor's choice**, not his; the view refuses any other number.
2. **Restart is now the same as a new conversation** (it asks first if messages would be lost, and clears them). It used to reconnect and leave the old messages on screen with a session the agent no longer had. Keep both commands, or drop restart?
3. **Opening a session focuses the chat view before it asks to replace the messages**, so it focuses even if the person then cancels.
4. **The mode picker still shows** (S13 B4 held until 28h works, his ruling).
5. **Icons are emoji and text glyphs** (✎ ✓ ✗ ⟳ 📄 ▶ …), which look different on each operating system; no sentence asks for them. Carried from S12b.
6. **Plan and queue statuses use emoji** (✅ 🔄 ⬜); same remark.

## 6. Not reached

27 of 41 blocks on a real screen; the waiting line on a real screen (the recorded agents answer too fast for a screenshot); a long plan on a real screen; a light theme; the keyboard order of the lists; Eclipse's widget.
