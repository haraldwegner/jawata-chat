#!/usr/bin/env node
// An ACP agent on stdio that plays one recorded session: `replay <session.jsonl>`.
import { Readable, Writable } from 'node:stream';
import { readSession } from '../recording.js';
import { replayAgent } from '../replay.js';

const file = process.argv[2];
if (!file) {
  process.stderr.write('usage: replay <session.jsonl>\n');
  process.exit(2);
}
let session;
try {
  session = readSession(file);
} catch (e) {
  process.stderr.write(`replay: ${file}: ${(e as Error).message}\n`);
  process.exit(1);
}
replayAgent(session,
  Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
  Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>);
