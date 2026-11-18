import { useEffect, useRef } from 'react';

/**
 * Esc closes the topmost open thing and only that (his ruling 2026-11-18): the model list, the "/" list and the History panel are each
 * registered here while they are open, in the order they opened, and one Esc closes the last of them. Registered once, on the document, so it
 * works with the focus anywhere in the page.
 */
const open: Array<() => void> = [];
let listening = false;

function onKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.defaultPrevented || open.length === 0) { return; }
  e.preventDefault();
  open[open.length - 1]();
}

/** While `active`, Esc closes this surface when it is the topmost open one: `close` is called then. */
export function useEscape(active: boolean, close: () => void): void {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (!active) { return undefined; }
    const entry = () => latest.current();
    open.push(entry);
    if (!listening) { document.addEventListener('keydown', onKeyDown); listening = true; }
    return () => {
      const at = open.indexOf(entry);
      if (at >= 0) { open.splice(at, 1); }
      if (open.length === 0 && listening) { document.removeEventListener('keydown', onKeyDown); listening = false; }
    };
  }, [active]);
}
