/** How long "Copied" stays on a button, in milliseconds. */
const COPIED_SHOWN_MS = 1500;

/**
 * Gives every code block of an answer a copy button at its top right (Stage 27 (y), his words 2026-11-18: "I need a copy button"). A click
 * copies the block's exact text: what lies between its fences, so no fence lines, and not the button's own label; the one newline the
 * renderer adds before the closing fence is not part of the block. A block that already has its button is left alone, so reading the same answer
 * again adds none.
 */
export function addCopyButtons(root: HTMLElement): void {
  root.querySelectorAll('pre').forEach(block => {
    if (block.querySelector(':scope > .code-copy')) {
      return;
    }
    const text = (block.querySelector('code') ?? block).textContent?.replace(/\n$/, '') ?? '';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-copy';
    button.textContent = 'Copy';
    button.title = 'Copy this block, exactly as written';
    button.addEventListener('click', () => {
      void copyText(text).then(done => {
        if (!done) {
          return;
        }
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = 'Copy'; }, COPIED_SHOWN_MS);
      });
    });
    block.appendChild(button);
  });
}

/**
 * Puts text on the clipboard from a click, and answers whether it got there. The page's own clipboard API first; where a host page does not
 * offer it (an embedded browser without clipboard permission), the selection-and-copy command on a hidden field, which a click may use anywhere.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // falls through to the command below
  }
  try {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const done = document.execCommand('copy');
    field.remove();
    return done;
  } catch {
    return false;
  }
}
