import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AUTONOMY_OPTION, autonomyOf, type ViewIntent, type ViewState } from '@jawata/chat-core/view';
import { AutonomyButton, principalBrainOf } from './Pickers.js';

/** How long the person stops typing before the core is told what the draft is. */
const DRAFT_PAUSE_MS = 250;

/** The most the text field grows to, in pixels; beyond it the field scrolls. */
const MAX_FIELD_HEIGHT = 240;

/** The groups of the `/` list, in the order shown, with what each is. The agent says which group a command is in. */
const GROUPS: { key: string; label: string; what: string }[] = [
  { key: 'seat', label: 'Seats', what: 'jawata\'s engineering roles: each does one narrow job' },
  { key: 'skill', label: 'Skills', what: 'procedures the agent has been taught' },
  { key: 'utility', label: 'Utilities', what: 'the agent\'s own commands for the session' },
];
const groupOf = (command: { _meta?: unknown }): string => {
  const given = ((command._meta ?? {}) as Record<string, unknown>)['jawata/group'];
  return typeof given === 'string' && GROUPS.some(g => g.key === given) ? given : 'other';
};

export function InputArea({ state, send }: { state: ViewState; send: (intent: ViewIntent) => void }) {
  const session = state.session;
  const commands = session?.availableCommands ?? [];
  const [text, setText] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashClosed, setSlashClosed] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  /** Whether the person has typed in this page: until then, the draft the core holds (from before a reload) is what the field takes. */
  const touched = useRef(false);

  useEffect(() => {
    if (!touched.current && state.draft && text === '') { setText(state.draft); }
  }, [state.draft]);
  // a cleared chat or a new conversation takes the draft with it; moving the chat to another place, or reloading it, does not
  const resets = useRef(state.draftResets);
  useEffect(() => {
    if (state.draftResets === resets.current) { return; }
    resets.current = state.draftResets;
    touched.current = false;
    setText('');
  }, [state.draftResets]);
  // the core keeps what is typed, a moment after the person stops, so a reloaded page has it back
  useEffect(() => {
    if (!touched.current) { return; }
    const timer = setTimeout(() => send({ type: 'keepDraft', text }), DRAFT_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  // the text field is as tall as its text, up to a limit: nobody has to drag it larger
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) { return; }
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, MAX_FIELD_HEIGHT) + 'px';
  }, [text]);

  const typingCommand = text.startsWith('/') && !text.includes(' ');
  const matching = typingCommand && commands.length > 0 && !slashClosed
    ? commands.filter(c => c.name.toLowerCase().startsWith(text.slice(1).toLowerCase()))
    : [];
  // grouped, in the order of the groups; within a group, in the order the agent sent them
  const order = [...GROUPS.map(g => g.key), 'other'];
  const filtered = [...matching].sort((a, b) => order.indexOf(groupOf(a)) - order.indexOf(groupOf(b)));
  const slashOpen = filtered.length > 0;
  const disabled = !session || state.loading;

  const openSide = (question?: string) => {
    send({ type: 'openSide', ...(question ? { text: question } : {}) });
  };

  /** What is in the field becomes the side discussion's first message: the button and the shortcut are the same act (D53 (b)). */
  const askFromTheField = () => {
    const question = text.trim();
    if (question) {
      touched.current = true;
      send({ type: 'keepDraft', text: '' });
      setText('');
    }
    openSide(question || undefined);
  };

  const submit = (value: string) => {
    const body = value.trim();
    if (!body) { return; }
    // `/btw` is the side discussion: what follows it is its first question, and it is not sent to this conversation
    const btw = /^\/btw(?:\s+([\s\S]*))?$/.exec(body);
    if (btw) {
      openSide(btw[1]?.trim());
      touched.current = true;
      send({ type: 'keepDraft', text: '' });
      setText('');
      setHint(null);
      return;
    }
    const files = state.attachments.map(a => a.path);
    send({ type: 'sendPrompt', text: body, ...(files.length > 0 ? { files } : {}) });
    touched.current = true;
    send({ type: 'keepDraft', text: '' });
    setText('');
    setHint(null);
  };

  const pick = (name: string) => {
    setSlashClosed(true);
    const cmd = commands.find(c => c.name === name);
    if (!cmd) { return; }
    if (cmd.input) {
      setText('/' + cmd.name + ' ');
      setHint((cmd.input as { hint?: string }).hint || 'Type input...');
    } else {
      submit('/' + cmd.name);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      askFromTheField(); // the editor's own binding only opens the panel: it cannot read this field
      return;
    }
    if (slashOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex(i => Math.min(i + 1, filtered.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIndex(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); pick(filtered[slashIndex]?.name ?? ''); return; }
      if (e.key === 'Escape') { e.preventDefault(); setSlashClosed(true); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit(text);
    }
  };

  const autonomy = session ? autonomyOf(session) : null;
  const brain = principalBrainOf(session);

  /** A picture pasted into the field is attached; anything else is pasted as usual. */
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const item = [...e.clipboardData.items].find(i => i.kind === 'file' && i.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (!item || !file) { return; }
    e.preventDefault();
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result).split(',')[1] ?? '';
      send({ type: 'attachPasted', name: file.name || 'screenshot.png', mimeType: item.type, data });
    };
    reader.readAsDataURL(file);
  };

  /** Show the list of seats and skills, as typing `/` does. */
  const openList = () => {
    touched.current = true;
    setText('/');
    setSlashClosed(false);
    setSlashIndex(0);
    field.current?.focus();
  };

  const placeholder = hint ?? (commands.length > 0 ? 'Type a message or / for commands...' : 'Type a message...');

  return (
    <div className={'input-area' + (disabled ? ' disabled' : '')}>
      <div className={'slash-popup' + (slashOpen ? ' open' : '')}>
        {filtered.map((c, i) => {
          const group = groupOf(c);
          const heading = i === 0 || groupOf(filtered[i - 1]) !== group ? GROUPS.find(g => g.key === group) ?? { label: 'Other', what: 'commands the agent did not sort into a group' } : null;
          return (
            <div key={c.name}>
              {heading ? <div className="slash-popup-group" title={heading.what}>{heading.label}</div> : null}
              <div className={'slash-popup-item' + (i === slashIndex ? ' active' : '')} title={c.description} onClick={() => pick(c.name)} onMouseEnter={() => setSlashIndex(i)}>
                <span className="cmd-name">{'/' + c.name}</span>
                <span className="cmd-desc">{c.description}</span>
              </div>
            </div>
          );
        })}
      </div>
      {state.attachments.length > 0 ? (
        <div className="attachments">
          {state.attachments.map(a => (
            <span className="attachment-chip" key={a.path} title={a.path}>
              <span className="chip-name">{a.name}</span>
              <button className="chip-remove" aria-label={`Remove ${a.name}`} title="Take this file out of the next prompt" onClick={() => send({ type: 'detachFile', path: a.path })}>×</button>
            </span>
          ))}
        </div>
      ) : null}
      {state.queued.length > 0 ? (
        <div className="queue" title="These are sent, one after another, when the answer ends">
          {state.queued.map((q, i) => (
            <div className="queued" key={i}>
              <span className="queued-text" title={q.text}>{q.text}{q.files.length > 0 ? ` (+${q.files.length} file${q.files.length === 1 ? '' : 's'})` : ''}</span>
              {i === 0 ? <button className="queued-now" title="Stops the running answer and sends this now" onClick={() => send({ type: 'sendNow' })}>Send now</button> : null}
            </div>
          ))}
        </div>
      ) : null}
      <div className="input-toolbar">
        <div className="picker-row">
          {autonomy ? <AutonomyButton armed={autonomy.armed} onPress={value => send({ type: 'setConfigOption', configId: AUTONOMY_OPTION, value })} /> : null}
          <button className="tool-btn" disabled={disabled} title="Attach a file or picture to your next message. You can also paste a screenshot into the field." onClick={() => send({ type: 'chooseFiles' })}>+</button>
          <button className="tool-btn" disabled={disabled} title="Lists the seats and skills you can start. Typing / does the same." onClick={openList}>/</button>
          <button className="tool-btn" disabled={disabled} title="Opens the btw panel on the right, a separate conversation with its own agent. This one goes on and is not told. Ctrl+Alt+S."
            onClick={askFromTheField}>Side question</button>
        </div>
        <span className="toolbar-spacer" />
        {brain ? <span className="principal-brain" title="The brain of the principal in this conversation. Its default is set in jawata studio, Seats view.">{brain.label}</span> : null}
      </div>
      <div className="input-editor-wrap">
        <textarea ref={field} placeholder={placeholder} rows={2} value={text} disabled={disabled}
          onChange={e => { touched.current = true; setText(e.target.value); setSlashClosed(false); setSlashIndex(0); if (!e.target.value.startsWith('/')) { setHint(null); } }}
          onKeyDown={onKeyDown} onPaste={onPaste} />
      </div>
      <div className="input-send-row">
        {state.processing ? <button className="send-stop-btn stop" title="Stop the running answer (Esc)" onClick={() => send({ type: 'cancelTurn' })}>■ Stop</button> : null}
        <button className="send-stop-btn send" title={state.processing ? 'Send when the answer ends (Enter)' : 'Send (Enter)'} onClick={() => submit(text)}>{state.processing ? 'Queue' : 'Send'}</button>
      </div>
    </div>
  );
}
