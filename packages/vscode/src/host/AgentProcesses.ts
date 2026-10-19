import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import { ndJsonStream } from '@agentclientprotocol/sdk';
import { Emitter, type AgentConfigEntry, type AgentHandle, type AgentHost } from '@jawata/chat-core';
import { launchFor } from './launch';
import { log, logError } from '../utils/Logger';

/** How long an agent is given to end after it is asked to, before it is ended by force. */
const FORCE_AFTER_MS = 3000;

interface Reports {
  stderr(line: string): void;
  failed(error: Error): void;
  ended(code: number | null, signal: NodeJS.Signals | null): void;
}

/** One agent program, started: its byte stream as the protocol frames it, and a way to end it. */
class ChildAgent {
  readonly handle: AgentHandle;
  private readonly child: ChildProcess;

  constructor(id: string, name: string, config: AgentConfigEntry, cwd: string | undefined, report: Reports) {
    const how = launchFor(config, { platform: process.platform, env: process.env, exists: existsSync });
    if (how.rejectedShell) { log(`The shell "${how.rejectedShell}" cannot run a command line for the chat; ${how.file} is used`); }
    this.child = spawn(how.file, how.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...config.env },
      cwd,
      shell: how.systemShell,
    });
    const { stdin, stdout, stderr } = this.child;
    if (!stdin || !stdout) { throw new Error('The agent program has to have stdin and stdout'); }

    this.handle = {
      id, name,
      stream: ndJsonStream(Writable.toWeb(stdin) as WritableStream<Uint8Array>, Readable.toWeb(stdout) as ReadableStream<Uint8Array>),
    };
    stderr?.on('data', (chunk: Buffer) => { const line = chunk.toString().trim(); if (line) { report.stderr(line); } });
    this.child.on('error', report.failed);
    this.child.on('close', report.ended);
  }

  /** Ask it to end; if it has not within a grace period, end it by force. */
  end(): void {
    this.child.kill('SIGTERM');
    setTimeout(() => { if (this.child.exitCode === null) { this.child.kill('SIGKILL'); } }, FORCE_AFTER_MS).unref();
  }
}

/**
 * The agent programs this extension has started. Reports `agent-error` ({agentId, error}),
 * `agent-closed` ({agentId, code, signal}) and `agent-stderr` ({agentId, line}) to whoever listens.
 */
export class AgentProcesses extends Emitter implements AgentHost {
  private readonly agents = new Map<string, ChildAgent>();
  private count = 0;

  spawnAgent(name: string, config: AgentConfigEntry, cwd?: string): AgentHandle {
    const id = `agent_${++this.count}`;
    log(`agent ${name} (${id}) is being started with: ${[config.command, ...(config.args ?? [])].join(' ')}`);
    const agent = new ChildAgent(id, name, config, cwd || undefined, {
      stderr: line => { log(`agent ${name} wrote: ${line}`); this.emit('agent-stderr', { agentId: id, line }); },
      failed: error => { logError(`agent ${name} reported an error`, error); this.emit('agent-error', { agentId: id, error }); },
      ended: (code, signal) => {
        log(`agent ${name} is gone: exit code ${code}, signal ${signal}`);
        this.agents.delete(id);
        this.emit('agent-closed', { agentId: id, code, signal });
      },
    });
    this.agents.set(id, agent);
    return agent.handle;
  }

  killAgent(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) { return false; }
    log(`ending agent ${agent.handle.name} (${agentId})`);
    this.agents.delete(agentId);
    try { agent.end(); } catch (e) { logError(`agent ${agentId} did not end cleanly`, e); }
    return true;
  }

  dispose(): void {
    this.removeAllListeners();
    Array.from(this.agents.keys()).forEach(id => this.killAgent(id));
  }
}
