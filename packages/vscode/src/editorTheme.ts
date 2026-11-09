import { writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import * as vscode from 'vscode';

/** What the Agent Control page reports about the editor's current colours. */
export interface EditorTheme {
  type: 'editorTheme';
  dark: boolean;
  colors: Record<string, string>;
}

function themeFile(): string | undefined {
  const studio = vscode.workspace.getConfiguration('jawataChat').get<{ handoffDir?: string }>('studio');
  return studio?.handoffDir ? join(dirname(studio.handoffDir), 'editor-theme.json') : undefined;
}

/** The window is closing: the studio goes back to its own colours, until another window reports. */
export function forgetEditorTheme(): void {
  const file = themeFile();
  if (file) {
    try { writeFileSync(file, JSON.stringify({ dark: false, colors: {}, at: Date.now() })); } catch { /* the studio then keeps the last colours until a window reports again */ }
  }
}

/**
 * Leaves the editor's colours beside the studio's folder of answers, where the studio reads them: dark themes are followed, a light one means
 * the studio keeps its own colours. With no studio set up there is nowhere to tell it, and nothing happens.
 */
export async function saveEditorTheme(theme: EditorTheme): Promise<void> {
  const file = themeFile();
  if (!file) { return; }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ dark: theme.dark, colors: theme.colors, at: Date.now() }));
}
