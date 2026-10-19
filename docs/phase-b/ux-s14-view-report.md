# UX report: the agents view, the proposal card and the seat selectors after S14 (a proposal; this report edited nothing)

Seat: `/ux`. Subject: `packages/chat-view/src/Agents.tsx`, `Proposals.tsx` and the selector labels in `Pickers.tsx`, and two real VS Code screenshots in this folder: `s14-vscode-agents-r4.png`, `s14-vscode-proposal-r7.png`.
`jawata-project.md` does not exist in this repository: assumed TypeScript, React 19, jsdom tests, green is `npm test` at the repository root. Store: `experience(nominate)` for this view's question returned no candidate that fits (decided with none selected at C13; the question is the same family).

## 1. Reachability, measured
Both blocks sit above the input and scroll inside themselves: `.agents` is capped at 40% of the view and `.proposals` at 50%, each with `overflow-y: auto` (asserted by the stylesheet test for the plan and queue; the new two are the same shape and are **not yet in that test**: fixed below as a finding). On the real screen at side-bar width the agents view, the answer and the input are on screen together; the proposal card, the answer and the input likewise.

## 2. Census: 57 blocks rendered (41 after S13 plus 16 new); 57 judged; 14 of the 16 new blocks seen on a real screen
New: agents title; per row seat, program and model, state, elapsed time, tokens, cost (6); Stop; Transcript; the transcript pane and its turns (2); proposal title; diff path; diff lines; Accept; Reject. Changed: the seat selector's label and mouseover. Not seen on a real screen: Stop (the recorded hires have ended when the shot is taken), the transcript pane.

## 3. Rows for the new blocks
| Block | Reader, in which situation | Decides or changes | Asked for by |
|---|---|---|---|
| Agents title "N agents working · M finished" | person who has hired several seats | whether to wait or look closer | spec P6: "one row per hire" and plan S14 B7: "a count" |
| Row: seat, program · model, state, time, tokens, cost | same, deciding whether an agent has run too long or too dear | stop it, or let it go on | spec P6/P17: "seat, brain, model, state, elapsed time, tokens and cost" |
| State "compacting" | same | wait; it is not stuck | plan S14 P4 second half |
| Stop | same | end that agent, the others go on | plan S14 exit 2 |
| Transcript, the pane | same | read what it did before deciding | plan S14 exit 3 "opens and cannot be typed into" |
| Proposal title, diff path, diff lines | person asked to let the agent change a file | accept or reject it | plan S14 P10 "a proposal shows as a diff" |
| Accept, Reject | same | answer | same: "Accept and Reject each reach the agent" |
| Seat selector label "seat · model" | person who set a model per seat | change one seat's model | plan S14 B6/P5 "one model selector per seat" |

## 4. Findings, and what was done
1. **A waiting line over a tool title that already ends in "…" shows two ellipses** ("Preparing file…" then the dots). Not fixed: the title is the agent's, and the line carries it unchanged by the signed design. Owed to him as a reading.
2. **The proposal card offers Accept and Reject only.** The agent also offers "Yes, allow all edits during this session"; it is not shown, because a blanket yes is the self-approval the rule "propose, never auto-apply" is against. The mouseover of each button names the agent's own wording. A person who wants the blanket yes cannot give it here. Owed to him as a decision.
3. **A request that carries no diff (for instance a shell command) is allowed without asking.** Spec P10 says "nothing else asks permission", and the plan removes the `autoApprovePermissions` setting, so nothing is left to ask with; the stage allows the choice that allows once (never a standing grant). **This is the largest consequence of the stage and the plan did not name it.** Owed to him as a decision, with the options: allow as built; ask with the same Accept/Reject card (this contradicts the plan's "a non-proposal request is shown" as Red); reject.
4. The stylesheet test did not cover the new blocks' bounds; added now (`.agents`, `.proposals`).
5. Carried: emoji glyphs (✓ ✗ ⟳ ✎) on tool lines and the picker icons; no sentence asks for them.

## 5. Not reached
Stop and the transcript pane on a real screen; a long list of hires (more than the cap) on a real screen; a light theme; the keyboard order of the agents rows.
