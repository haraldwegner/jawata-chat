// A DOM in node and a chat wired to the view: the core on the in-memory host plays a recorded session, the view renders what it is told.
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRequire } from 'node:module';
import { readSession, replayAgent } from '@jawata/acp-contract';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
for (const key of Object.getOwnPropertyNames(window)) {
  if (!(key in globalThis)) { try { globalThis[key] = window[key]; } catch { /* a read-only global */ } }
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { mountChatView } = await import('../dist/index.js');
const { LoopbackPort, chatWith, answerProposals } = await import('@jawata/chat-core/test-support');

const require = createRequire(import.meta.url);
export const sessionFile = (name) => require.resolve(`@jawata/acp-contract/sessions/${name}.jsonl`);
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export { act, mountChatView };
/** Close the DOM: its timers would keep the process alive after the last test. */
export const closeDom = () => window.close();

/**
 * The view mounted on a chat whose agent plays the named session. The person answers the proposals the way the recording
 * says they did, unless `answering` is false: a test of the proposals themselves answers them by clicking.
 */
export async function viewOn(name, { answering = true } = {}) {
  const session = readSession(sessionFile(name));
  const port = new LoopbackPort();
  const chat = chatWith((input, output) => replayAgent(session, output, input), port);
  const answers = session.filter(l => l.dir === 'send' && l.msg.result?.outcome?.optionId).map(l => l.msg.result.outcome.optionId);
  if (answering && answers.length > 0) { answerProposals(chat.chat, port, answers); }
  const container = document.createElement('div');
  container.id = 'root';
  document.body.appendChild(container);
  let mounted;
  await act(async () => { mounted = mountChatView(container, port.page); });
  return {
    ...chat, session, container, port, mounted,
    $: (selector) => container.querySelector(selector),
    $$: (selector) => [...container.querySelectorAll(selector)],
    /** Let the core and the view run until `done()` holds. */
    async settle(done = () => false, tries = 100) {
      for (let i = 0; i < tries && !done(); i++) { await act(async () => { await sleep(20); }); }
      await act(async () => { await sleep(20); });
    },
    async type(value) {
      const el = container.querySelector('textarea');
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(el, value);
        el.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
    },
    async key(key, init = {}) {
      const el = container.querySelector('textarea');
      await act(async () => { el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })); });
    },
    async click(el) { await act(async () => { el.click(); }); },
    async connect() { await act(async () => { await chat.sessions.connectToAgent('agent'); }); },
    dispose() { act(() => { mounted.dispose(); }); container.remove(); chat.dispose(); },
  };
}
