# Recorded sessions

Each file is one whole ACP session, handshake included, as JSON lines:
`{"dir":"send"|"recv","msg":<ACP message>}`, in the order the chat's traffic tap saw them
(`send` is client to agent). Read them with `readSession` from this package.

Real recordings become contract recordings only through `promoteRecording`
(`jawata-acp-promote <raw> <out>`), which makes these redactions: the adapter's `_auth/*` notices are
dropped (they carry the account's email); the session's working directory, and the folder name the adapter
derives from it, become `/workspace` and `-workspace`; and a recording that still holds a home-directory
path afterwards is refused, so nothing local is promoted by accident. Every other message is unchanged.

| File | What it is | Source |
|---|---|---|
| R1.jsonl | a prompt and its streamed answer | a real Claude turn, promoted: identical to `docs/phase-a/claude-s2-pong.jsonl` |
| R2.jsonl | one `Write` tool call (`pending`, updates without status, `completed`), its permission request answered, the answer | a real Claude turn (A1), promoted: identical to `docs/phase-a/claude-a1.jsonl` |
| R3.jsonl | **SHAPE ONLY:** R1 with every advertised command tagged `_meta["jawata/group"]`: the ten jawata seats `seat`, Claude's built-in commands `utility`, the rest `skill` | DERIVED from R1 by `overlays/R3.json`; re-recorded from 28h's agent |
| R4.jsonl | **SHAPE ONLY:** two overlapping hires as tool calls (E3), one in state `compacting`, both ending `done`; then a stop (E4) and a transcript request (E5) | DERIVED from `bases/hires.jsonl` (a real Claude turn with two concurrent sub-agent calls) by `overlays/R4.json`; the reply shapes of E4 and E5 are this overlay's assumption, for 28h to confirm |
| R5.jsonl | **SHAPE ONLY:** a model change with one `seat-model:<seat>` option per seat (two seats), the change naming one | DERIVED from `bases/model.jsonl` (a real Claude model change) by `overlays/R5.json` |
| R6.jsonl | `session/list`, then `session/load` replaying an earlier turn; the list is cut to this one session | a real Claude run (`scripts/record-claude.mjs history`), promoted; the list of the machine's other sessions removed before promotion |
| R7.jsonl | two proposals as permission requests with a diff, answered yes (`allow-once`) and then no (`reject`) | a real Claude run with the user's hooks disabled in the scratch workspace (`record-claude.mjs proposals`), promoted |
| R9.jsonl | **SHAPE ONLY:** R1 with two `agent_thought_chunk` updates (one message id) before the answer: Claude's thinking | DERIVED from R1 by `overlays/R9.json`. Not recorded from real Claude: with thinking enabled (`MAX_THINKING_TOKENS`, `alwaysThinkingEnabled`, effort at its highest) four runs sent no thought chunk. Interim proposal: his decision is open; re-recorded from 28h's agent |
| R10.jsonl | **SHAPE ONLY:** R1 with three `plan` updates, the whole plan each time, its three entries moving from pending to completed | DERIVED from R1 by `overlays/R10.json`. Not recorded from real Claude: its task and to-do tools were not offered in the session, so no plan update arrived. Interim proposal: his decision is open; re-recorded from 28h's agent |

Derived files are made only by `jawata-acp-derive --all sessions` from an overlay (`overlays/*.json`) and a promoted base, validated against the Level-1 types; `derived.json` lists each with its source and the hash of its overlay, and the tests refuse a hand edit.
