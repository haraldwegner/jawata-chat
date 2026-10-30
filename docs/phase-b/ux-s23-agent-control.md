# S23, the Agent Control view: the ux seat's census and proposed view

Written 2026-10-30 by the ux seat for plan stage S23 (entry gate: this report goes to Harald before anything is built). It is a proposal; nothing in the code was changed.

**What the project says it is.** `jawata-project.md` does not exist in `jawata-chat`, so these four facts are my assumptions, read from the repository and not declared by the project: stack TypeScript with React (`packages/chat-view`), build `npm run build`, source roots `packages/*/src`, green means `npm test` exits 0 (acp-contract, chat-core, chat-view, root checks with knip) plus the extension tests in `packages/vscode` under a virtual screen.

**The view in question.** Today the agents are one bar, `AgentsBar` in `packages/chat-view/src/Agents.tsx`, shown above the conversation only once a hire exists. CR2 asks for an Agent Control view with the active agents, their tasks, their talk folded, and a control to attach another hired brain. The data is 28h's (D46). This report designs the screen; the bar is what it extends.

## Revision, 2026-10-31, after Harald's answers to D1 to D3

His words: *"D1 - wher do you know the costs if it is subscription?"*, *"D2 - not a separate button agent is shown and you overwrite. Clicking on it shows selection"*, *"D3 - zero agents. The side bar is its own panel, so should be shown"*. The sections below are the first proposal; where they disagree with this section, this section wins.

- **D1, cost.** The chat only shows what the agent sends in `_meta["jawata/hire"].costUsd`. Claude's real traffic carries a dollar amount (R1: `cost.amount` 1.11 USD) even on a subscription, where it is a price at API rates and nothing is billed; a brain that sends none leaves it missing, and today's code turns a missing figure into `$0.000`. So: **tokens stay in the row (block 6 is kept, my proposal to drop it is withdrawn), cost shows only when the agent sent one**, with the mouseover "What this agent reports it has cost, in US dollars at API prices. On a subscription nothing is charged for it." Signed row P6 is then unchanged. `costUsd` becomes optional in the hire shape (the contract number is raised for it). Whether a brain runs on a subscription or a metered key is 28h's to know (R18); a flag for it is not asked for.
- **D2, the brain.** **No attach button and no attach form (blocks 14 and 15 are dropped).** Each agent is a row; its brain and model are a control with an arrow; clicking it shows the list of brains; the one picked overwrites the agent's brain. What happens to work already under way is the agent's rule (28h), not the view's. The list of brains comes from the agent.
- **D3, the panel.** **The panel is its own panel and always shown**, with zero agents too. Overwriting needs a row to click, so there are two readings and one question is open: **X** the rows are the agents started in this conversation (zero agents shows one line saying so, and nothing can be overwritten), or **Y** the rows are every seat, idle ones included, each with its brain to change before it works. Y needs the agent to send the list of seats; I recommend Y because it is the only reading in which the brain of an idle seat can be chosen.
- **Census now:** 16 blocks, 14 kept or added (block 14 attach button and 15 attach form dropped, block 6 kept, the idle seat row added).

## 1. Reachability, measured

I read it from the stylesheet and the component; I could not render it with layout (the page tests run in a DOM without layout, so they cannot show a scrollbar). The bar is `max-height: 40%; overflow-y: auto` (`.agents`, `styles.ts` line 115) and the transcript region is `max-height: 12em; overflow-y: auto`, so with many hires or a long transcript the bar scrolls inside itself and nothing is cut off, but this is read, not seen. The bar is hidden when no hire exists (`state.hires.length === 0`), which decides the attach question in section 5. This view lives in the chat's own stylesheet (`.jc-chat` scope), not the studio's shell, so the studio's scroll-container check does not apply; a rendered check in the real extension is owed before the build is called done.

## 2. The census: 12 blocks rendered today, 4 the change requests add: 16, all 16 judged

Source: `Agents.tsx` (every user-visible block, counted from the component, not a screenshot).

| # | Block | Reader, and the next thing they do | The sentence that asked for it | Verdict |
|---|---|---|---|---|
| 1 | Title: "2 agents working · 1 finished" | the person who started a multi-step job and wants to know whether to wait; waits, or looks at a row | B7: *"Agent count running, what is running."* | keep |
| 2 | Seat name (`architect`) | the same person, deciding which agent to stop or read | P6: *"one row per hire: seat, brain, model, state..."* | keep, and add the name they type: `architect (/refactor)` |
| 3 | Brain and model (`claude · sonnet`) | the person who pays for the work; compares it with what they would pick when attaching a brain | P6, same sentence | keep, quiet text |
| 4 | State word (running, compacting, done, failed) | the person deciding whether an agent is stuck or finished; stops it or reads it | P6, same sentence | keep; "compacting" needs its mouseover (it has one) |
| 5 | Elapsed time | the person judging whether an agent has run too long; stops it | P6: *"elapsed time"* | keep |
| 6 | Tokens (`15.0k tokens`) | nobody who is not also reading the cost; it changes no decision the cost does not | P6: *"tokens and cost"* | collapse into the cost's mouseover (decision D1) |
| 7 | Cost (`$0.31`) | the person watching spend; stops an agent that costs too much | P6: *"tokens and cost"*, P17 | keep |
| 8 | Stop button | the person who sees an agent off track or expensive; ends it, the others go on | P6: *"stop one hire"* | keep |
| 9 | "Transcript" / "Hide" button | the person who wants to know what an agent said; reads it | P6: *"open its transcript read-only"* | becomes the fold toggle (▸ / ▾, `aria-expanded`), folded by default |
| 10 | Transcript region (read only) | same reader; reads, cannot type | CR2: *"Each agent's communication is folded by default and unfolds to the recorded transcript"* | keep |
| 11 | "Loading…" | same reader, waiting for the transcript | asked for by nothing | keep: without it a slow transcript looks broken |
| 12 | A transcript turn (role and text) | same reader | CR2, same sentence | keep |
| 13 | **Task line** under each row | the person who sees four agents and cannot tell which is doing what; decides which to read or stop | CR2: *"the task each works on"*; the user's words *"all the active agents and the tasks they are working on"* | add; full text wrapped, never cut with an ellipsis |
| 14 | **Attach button** in the title row | the person who wants another brain on the job; opens the form | CR2: *"A control attaches another hired brain to the running session"* | add |
| 15 | **Attach form** (seat, brain and model, task, Start, Cancel) | the same person; chooses and starts a hire | CR2, same sentence; the plan says only *"choose a brain, start a hire"* | add, with the fields below (decision D2) |
| 16 | **"No talk recorded for this agent"** (an unfolded empty transcript) | the person who unfolded a row and sees nothing | asked for by nothing | add as the one empty state; without it an empty transcript is indistinguishable from loading |

Blocks 11 and 16 are *asked for by nothing*. I keep them because each prevents a dead screen, and I say so here instead of letting them pass as part of the request.

## 3. The proposed view

```
2 agents working · 1 finished                         [ Attach a brain ]
▸ architect (/refactor)   claude · sonnet   running   1m 12s   $0.31   [ Stop ]
    Review the new retry policy against the target architecture
▾ test-writer (/cover)    claude · haiku    done      9s       $0.02
    Cover the queue's send-now path
    ┌ transcript, read only ─────────────────────────────────────────┐
    │ pm      Write tests for the send-now path of the queue ...     │
    │ agent   I will start with the case where nothing is waiting.   │
    └─────────────────────────────────────────────────────────────────┘
```

Each row's talk is folded when the row appears. The list scrolls inside the bar. The visible text and the mouseover of every block that stays:

| Block | Visible | Mouseover |
|---|---|---|
| Title | `2 agents working · 1 finished` | "The agents started for this conversation. The numbers are what the agent last reported." |
| Fold toggle | `▸` / `▾` before the seat | "Show or fold what this agent and its program said. You cannot type into it." |
| Seat | `architect (/refactor)` | "The role this agent plays. Type /refactor in a message to use the same role yourself." |
| Brain and model | `claude · sonnet` | "The program and the model that do the work. The model decides most of the cost." |
| State | `running` | running: "The agent is working." compacting: "The agent is shortening its own conversation so it can go on." done: "The agent has finished." failed: "The agent ended with a failure." |
| Elapsed | `1m 12s` | "How long this agent has been at it." |
| Cost | `$0.31` | "What this agent has cost so far, in US dollars. It has used 15.0k tokens." |
| Task line | the task text, wrapped | the same text in full |
| Stop | `Stop` | "Ends this agent. The other agents go on." (shown only while it works) |
| Attach button | `Attach a brain` | "Starts another hired agent in this conversation. It appears in the list when it starts." |
| Attach form: Seat | a list of seats, each as `name (/command)` | "Which role the new agent plays. It works from that seat's instructions." |
| Attach form: Brain | a list of brain and model | "The program and model that do the work. Their cost differs." |
| Attach form: Task | one text field | "What you want this agent to do. It is sent as its first instruction." |
| Attach form: Start / Cancel | `Start`, `Cancel` | Start: "Hires the agent now." Cancel: "Closes this form and hires nothing." |
| Empty transcript | `No talk recorded for this agent.` | "Nothing this agent said has been stored." |

What goes: the separate `tokens` column (block 6) and the words "Transcript" and "Hide" (block 9, replaced by the fold toggle). Nothing else is removed. The view holds no state of its own beyond which rows are unfolded and whether the form is open: a reload shows the agent's list again (P8).

## 4. What the data must carry (28h, D46), because the view needs it

The list the agent returns must carry, per agent: seat, **the seat's typed command** (today only the seat name arrives, so `(/refactor)` cannot be shown), brain, model, state, elapsed, cost, tokens, **task text**, and the recorded talk. For the attach form the agent must also offer the **list of seats with their commands** and the **list of brains and models**. If 28h's D46 does not name these, the view cannot show the mandatory name and cannot offer choices; I send this list to 28h's session with this report.

## 5. Decisions owed to Harald

- **D1. Tokens.** P6 (signed) lists *"tokens and cost"*; U-HUMAN says tokens change no decision cost does not. Proposal: show cost, put the token count in its mouseover. The sentence to change is P6's. Your word needed because it is a signed row.
- **D2. The attach form's fields.** Your words: *"I can attach another hired brain during runtime"*. The plan's S23 says only *"choose a brain, start a hire"*. A hire needs a role and a task to work from, so the proposed form has seat, brain and model, and task. That is my reading of "attach another hired brain", and the plan's narrower wording was a self-approved narrowing that I name here instead of letting it pass. Your word needed: is a seat and a task part of attaching, or only the brain?
- **D3. When the view is there.** Today the bar appears only when a hire exists. So "Attach a brain" is reachable only when at least one agent exists (*"attach another"*). Starting the first hire stays a prompt in the chat. If you want to attach with none running, the bar must also show with zero agents. Proposal: keep it hidden until a hire exists. Your word only if you disagree.

## 6. Spec and plan sentences this changes

- P6 (tokens), D1 above.
- Plan S23 deliverable *"the attach control (choose a brain, start a hire in the running session)"*, D2 above.
- Plan S23 exit criterion 1 says *"the built view equals its proposed view block by block (census number stated)"*: the census number is 16 here (12 existing, 4 added).

## 7. What I could not reach

A rendered look at the bar in the real extension (layout, the 40% height, the scroll); the real shape of D46's answer (not defined yet in 28h's plan stages, so the list of seats and brains is assumed); how a hire that itself hires appears (28h's D33 extends the bar to a tree later; this view lists the hires of the session only).
