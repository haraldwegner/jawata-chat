import * as vscode from 'vscode';
import { spawn, type ChildProcess } from 'node:child_process';
import type {
  CreateTerminalRequest, CreateTerminalResponse, KillTerminalRequest, KillTerminalResponse,
  ReleaseTerminalRequest, ReleaseTerminalResponse, TerminalOutputRequest, TerminalOutputResponse,
  WaitForTerminalExitRequest, WaitForTerminalExitResponse,
} from '@agentclientprotocol/sdk';
import type { TerminalPort } from '@jawata/chat-core';
import { log, logError } from '../utils/Logger';

/**
 * The newest bytes of a command's output, at most a limit of them; what was dropped is remembered.
 * @public read by the editor tests
 */
export class OutputTail {
  private kept = Buffer.alloc(0);
  dropped = false;

  constructor(private readonly limit: number) {}

  add(chunk: Buffer): void {
    this.kept = Buffer.concat([this.kept, chunk]);
    const surplus = this.kept.length - this.limit;
    if (surplus <= 0) { return; }
    let from = surplus;
    // do not begin in the middle of a multi-byte character
    while (from < this.kept.length && (this.kept[from] & 0xc0) === 0x80) { from++; }
    this.kept = this.kept.subarray(from);
    this.dropped = true;
  }

  get text(): string {
    return this.kept.toString('utf8');
  }
}

interface Ending {
  exitCode: number | null;
  signal: string | null;
}

/** A command the agent started, and what the chat knows of it. */
class Command {
  readonly tail: OutputTail;
  ending?: Ending;
  readonly ended: Promise<Ending>;

  constructor(readonly child: ChildProcess, limit: number, readonly shown: vscode.Terminal) {
    this.tail = new OutputTail(limit);
    this.ended = new Promise<Ending>(resolve => {
      const finish = (ending: Ending) => { this.ending ??= ending; resolve(this.ending); };
      child.on('close', (code, signal) => finish({ exitCode: code, signal }));
      child.on('error', () => finish({ exitCode: null, signal: null }));
    });
  }

  /**
   * Send a signal to the command and to everything it started: the command is a shell, and a
   * shell that is stopped alone leaves its child running and the output pipe open.
   */
  stop(signal: NodeJS.Signals): void {
    if (this.ending) { return; }
    const pid = this.child.pid;
    if (pid !== undefined && process.platform !== 'win32') {
      try { process.kill(-pid, signal); return; } catch { /* the group is gone already, or never was one */ }
    }
    this.child.kill(signal);
  }
}

const DEFAULT_LIMIT = 1024 * 1024;

/**
 * The terminals of the ACP `terminal/*` requests. The command runs as a child process whose output
 * the agent can read back; the same output is shown in an editor terminal for the person.
 */
export class TerminalHost implements TerminalPort {
  private readonly commands = new Map<string, Command>();
  private issued = 0;

  async createTerminal(request: CreateTerminalRequest): Promise<CreateTerminalResponse> {
    const terminalId = `term_${++this.issued}`;
    const line = [request.command, ...(request.args ?? [])].join(' ');
    log(`createTerminal ${terminalId}: ${line}`);

    const env = { ...process.env, ...Object.fromEntries((request.env ?? []).map(v => [v.name, v.value])) };
    const child = spawn(request.command, request.args ?? [], { cwd: request.cwd ?? undefined, env, shell: true, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    const display = new vscode.EventEmitter<string>();
    const shown = vscode.window.createTerminal({
      name: `ACP: ${request.command}`,
      pty: { onDidWrite: display.event, open: () => display.fire(`$ ${line}\r\n`), close: () => undefined },
    });
    const command = new Command(child, request.outputByteLimit ?? DEFAULT_LIMIT, shown);
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on('data', (chunk: Buffer) => {
        command.tail.add(chunk);
        display.fire(chunk.toString().replace(/\n/g, '\r\n'));
      });
    }

    this.commands.set(terminalId, command);
    return { terminalId };
  }

  async terminalOutput(request: TerminalOutputRequest): Promise<TerminalOutputResponse> {
    const command = this.find(request.terminalId);
    return {
      output: command.tail.text,
      truncated: command.tail.dropped,
      ...(command.ending ? { exitStatus: command.ending } : {}),
    };
  }

  async waitForTerminalExit(request: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse> {
    return this.find(request.terminalId).ended;
  }

  async killTerminal(request: KillTerminalRequest): Promise<KillTerminalResponse> {
    const command = this.find(request.terminalId);
    try {
      command.stop('SIGTERM');
    } catch (e) {
      logError(`Could not stop terminal ${request.terminalId}`, e);
    }
    return {};
  }

  async releaseTerminal(request: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse> {
    const command = this.find(request.terminalId);
    log(`releaseTerminal ${request.terminalId}`);
    command.stop('SIGTERM');
    // the editor terminal stays, so the person can read what the command wrote
    this.commands.delete(request.terminalId);
    return {};
  }

  /** End every command still running and close the editor terminals that show them. */
  dispose(): void {
    this.commands.forEach(c => { c.stop('SIGKILL'); c.shown.dispose(); });
    this.commands.clear();
  }

  private find(terminalId: string): Command {
    const command = this.commands.get(terminalId);
    if (!command) { throw new Error(`Terminal not found: ${terminalId}`); }
    return command;
  }
}
