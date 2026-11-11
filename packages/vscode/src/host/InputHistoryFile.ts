import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { InputHistoryStore } from '@jawata/chat-core';

/**
 * What the person typed in the chat, kept in a file of the extension's own storage for this user (where the session recordings are kept
 * too), so that the input's arrows bring it back after the editor restarts. One window writes at a time, each write whole; with two windows
 * open, the one that sends last keeps its list.
 */
export class InputHistoryFile implements InputHistoryStore {
  /** The writes in the order they were asked for: a later save never lands before an earlier one. */
  private writing: Promise<void> = Promise.resolve();

  /** @param onError told when a save could not be written; the chat goes on with what it holds */
  constructor(readonly file: string, private readonly onError: (message: string, error: unknown) => void) {}

  /** What was saved last; empty when nothing was. A file that is not a list of texts is refused, and the chat begins empty. */
  async load(): Promise<string[]> {
    let text: string;
    try {
      text = await readFile(this.file, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') { return []; }
      throw e;
    }
    const kept: unknown = JSON.parse(text);
    if (!Array.isArray(kept) || !kept.every(e => typeof e === 'string')) { throw new Error(`${this.file} does not hold a list of texts`); }
    return kept;
  }

  save(entries: readonly string[]): void {
    const text = JSON.stringify(entries);
    const temporary = `${this.file}.writing`;
    this.writing = this.writing
      .then(async () => {
        await mkdir(dirname(this.file), { recursive: true });
        await writeFile(temporary, text); // written beside it and then put in its place, so a read never sees half a list
        await rename(temporary, this.file);
      })
      .catch(e => { this.onError(`the input history could not be written to ${this.file}`, e); });
  }
}
