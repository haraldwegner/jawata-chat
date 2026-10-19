# UX report: history, the draft and placement after S15 (a proposal; this report edited nothing)

Seat: `/ux`. Subject: `packages/chat-view/src/History.tsx` (and its two entry points in `ChatView.tsx` and `Messages.tsx`) and the new settings `jawataChat.placement` and `jawataChat.recordSessions`; one real VS Code screenshot, `s15-vscode-history-r6.png` in this folder.
`jawata-project.md` does not exist in this repository: assumed TypeScript, React 19, jsdom tests, green is `npm test` at the repository root. Store: `experience(nominate)` was not asked again; the question is the same family as C13's and C14's (no candidate fitted).

## 1. Reachability, measured
The list is a block above the conversation with `max-height: 50%` and its own scroll (asserted by the stylesheet test); on the real screen at side-bar width it sits under the toolbar and above the empty state with the "Close" button on the same line as its title. Not measured: a list longer than half the view on a real screen.

## 2. Census: 66 blocks rendered (57 after S14 plus 9 new); 66 judged; 5 of the 9 new blocks seen on a real screen
New: History button in the empty state and in the banner (2); the list's title, Close, a row's name, a row's time, More, the "Asking the agent…" line, the "lists no sessions" line (7). Not seen: the banner's History button, More, the waiting and empty lines. The draft (kept by the core, put back in the field after a reload) has no block of its own.

## 3. Rows for the new blocks
| Block | Reader, in which situation | Decides or changes | Asked for by |
|---|---|---|---|
| History button (empty state, banner) | person who wants an earlier conversation | open the list | spec B8: "a past session is listed in the chat"; plan S15 deliverable 1 |
| List title "Past sessions" (mouseover says what the list is) | same | nothing, it names the list | same |
| Close | same | put the list away | *asked for by nothing*; kept, a list that cannot be closed covers the conversation |
| Row: name | same | which session to open | plan S15 "the session list rendered in chat-view, from session/list" |
| Row: time (readable; the exact value is the mouseover) | same | which of two sessions with one name | same; *the time itself is asked for by nothing*, the agent sends it with each listed session |
| More | person with a long list | ask the agent for the next page | plan S15 (the agent pages its list) |
| "Asking the agent…", "The agent lists no sessions." | same | wait; or stop looking | *asked for by nothing*; the two states of an empty list |

## 4. Findings, and what was done
1. **The time was the agent's raw text** (`2026-10-18T23:36:38.234Z`): fixed, a local date and minute, the exact value as the mouseover.
2. **The extension now needs VS Code 1.101 or later** (was 1.85): the right side bar is a contribution only newer editors know. Cursor 3.24 and Theia 1.76 were checked at the protocol level in S6; **their base versions against 1.101 were not checked**. A host that does not know the right side bar simply has no right place. Owed to him as a decision (the engine range is a promise to every host).
3. **The chat is in one place at a time** (the plan's decision: replace). Opening it in another place leaves the first with a page that is told nothing; its tab or view stays, stale. Owed to him only as a reading of "replace".
4. **Recording is off as shipped**, so "jawata chat: Open Recording" says to turn on `recordSessions`; the traffic output channel still shows the messages with `logTraffic` on.
5. Not fixed: the list has no search or filter (no sentence asks for one).

## 5. Not reached
The banner's History button, More and the two status lines on a real screen; the list at a width narrower than the side bar; Stop and the transcript pane from S14 still unseen.
