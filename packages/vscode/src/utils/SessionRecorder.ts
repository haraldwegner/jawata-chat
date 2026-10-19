import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TrafficDirection } from '@jawata/chat-core';

/**
 * One line of a recorded session — the format the replay agent and the checker read.
 * @public read by the editor tests
 */
export interface RecordedLine {
  dir: TrafficDirection;
  msg: unknown;
}

/**
 * How many recordings are kept: the newest, this one included.
 * @public read by the editor tests
 */
export const KEPT_RECORDINGS = 20;

/**
 * Writes one connection's ACP traffic as JSON lines, one message and its direction per line,
 * in the order the tap saw them.
 */
export class SessionRecorder {
  readonly filePath: string;

  constructor(directory: string, agentId: string, now: Date = new Date()) {
    fs.mkdirSync(directory, { recursive: true });
    SessionRecorder.keepNewest(directory, KEPT_RECORDINGS - 1);
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    this.filePath = path.join(directory, `${stamp}-${agentId.replace(/[^A-Za-z0-9_-]/g, '_')}.jsonl`);
  }

  /** Delete the oldest recordings in the folder (they are named by the time they began) so that no more than `keep` remain. */
  private static keepNewest(directory: string, keep: number): void {
    const files = fs.readdirSync(directory).filter(f => f.endsWith('.jsonl')).sort();
    for (const old of files.slice(0, Math.max(0, files.length - keep))) { fs.rmSync(path.join(directory, old), { force: true }); }
  }

  record(direction: TrafficDirection, message: unknown): void {
    const line: RecordedLine = { dir: direction, msg: message };
    fs.appendFileSync(this.filePath, JSON.stringify(line) + '\n');
  }
}
