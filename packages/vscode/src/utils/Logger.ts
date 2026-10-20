import * as vscode from 'vscode';
import { SessionRecorder } from './SessionRecorder';
import type { TrafficSink } from '@jawata/chat-core';

/** An output channel that is created the first time something is written to it, and can be let go of. */
class LazyChannel {
  private channel?: vscode.OutputChannel;

  constructor(private readonly name: string) {}

  get(): vscode.OutputChannel {
    return (this.channel ??= vscode.window.createOutputChannel(this.name));
  }

  writeLine(text: string): void {
    this.get().appendLine(text);
  }

  dispose(): void {
    this.channel?.dispose();
    this.channel = undefined;
  }
}

const events = new LazyChannel('jawata chat');
const traffic = new LazyChannel('jawata chat traffic');

let recordingDir: string | undefined;
let latestRecording: string | undefined;

const stamp = () => new Date().toISOString();

export const getOutputChannel = (): vscode.OutputChannel => events.get();
export const getTrafficChannel = (): vscode.OutputChannel => traffic.get();

export function log(message: string, ...details: unknown[]): void {
  const tail = details.map(d => JSON.stringify(d)).join(' ');
  events.writeLine(`[${stamp()}] ${[message, tail].filter(Boolean).join(' ')}`);
}

export function logError(message: string, error?: unknown): void {
  const reason = error instanceof Error ? error.message : String(error ?? '');
  events.writeLine(`[${stamp()}] ERROR: ${message} ${reason}`);
  if (error instanceof Error && error.stack) {
    events.writeLine(error.stack);
  }
}

/** Whether traffic is shown in its output channel; read on every message, so the setting takes effect at once. */
const trafficOn = (): boolean => vscode.workspace.getConfiguration('jawataChat').get<boolean>('logTraffic', false);

/** Whether sessions are kept as recordings; off as shipped, and read on every message so the setting takes effect at once. */
const recordingOn = (): boolean => vscode.workspace.getConfiguration('jawataChat').get<boolean>('recordSessions', false);

/** Where session recordings are written; set once at activation. */
export function setRecordingDir(directory: string): void {
  recordingDir = directory;
}

/** The most recent session recording's file, if any was opened this run. */
export function lastRecordingPath(): string | undefined {
  return latestRecording;
}

/**
 * The sink that records one connection's traffic into its own JSON-lines file. It writes only while
 * `recordSessions` is on, and there is no sink at all when the setting is off at connect or no folder is set.
 */
export function sessionRecordingSink(agentId: string): { sink: TrafficSink; filePath: string } | undefined {
  if (!recordingOn() || !recordingDir) { return undefined; }
  const recorder = new SessionRecorder(recordingDir, agentId);
  latestRecording = recorder.filePath;
  const sink: TrafficSink = (direction, message) => {
    if (recordingOn()) { recorder.record(direction, message); }
  };
  return { filePath: recorder.filePath, sink };
}

/** What kind of JSON-RPC message this is, for the log's headline. */
function kindOf(message: unknown): string {
  if (typeof message !== 'object' || message === null) { return ''; }
  const m = message as Record<string, unknown>;
  if ('method' in m) { return 'id' in m ? ` [REQUEST] ${String(m.method)}` : ` [NOTIFICATION] ${String(m.method)}`; }
  if ('result' in m || 'error' in m) { return ` [RESPONSE] id=${String(m.id)}`; }
  return '';
}

export const logTraffic: TrafficSink = (direction, data) => {
  if (!trafficOn()) { return; }
  const headline = direction === 'send' ? '>>> CLIENT → AGENT' : '<<< AGENT → CLIENT';
  traffic.writeLine(`[${stamp()}] ${headline}${kindOf(data)}\n${JSON.stringify(data, null, 2)}\n`);
};

export function disposeChannels(): void {
  events.dispose();
  traffic.dispose();
}
