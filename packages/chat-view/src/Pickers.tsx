import { AUTONOMY_OPTION, type ViewIntent, type ViewSession } from '@jawata/chat-core/view';

/** The option that holds the principal's brain, sent by the agent with the session. */
const PRINCIPAL_BRAIN = 'principal-brain';

type RawChoice = { value?: string; name?: string };
type RawOption = { id: string; currentValue?: string; options?: unknown[] };

/** One brain the principal can run on. */
export interface BrainChoice { value: string; name: string }

/** The principal's brain as the agent reports it: what it is now and what it could be; null when the agent reports none. */
export function principalBrainOf(session: ViewSession | null | undefined): { current: string; label: string; choices: BrainChoice[]; configId: string } | null {
  const options = (session?.configOptions ?? []) as unknown as RawOption[];
  const option = options.find(o => o?.id === PRINCIPAL_BRAIN);
  if (!option) { return null; }
  const choices = ((option.options ?? []) as RawChoice[]).filter(Boolean).map(c => ({ value: c.value ?? '', name: c.name || c.value || '' }));
  const current = option.currentValue ?? '';
  return { current, label: choices.find(c => c.value === current)?.name || current, choices, configId: PRINCIPAL_BRAIN };
}

/**
 * The principal's brain as a control: a button with the brain in use, and a menu of what the agent offers for it. A choice other than the
 * one in use sends the agent's own config option, the one request the agent knows for it; the agent applies it from the next message.
 * Agent Control's principal row and the chat's input row both use this one control, so both offer the same and send the same.
 */
export function PrincipalBrainPicker({ brain, open, onToggle, send, className }: {
  brain: NonNullable<ReturnType<typeof principalBrainOf>>;
  open: boolean;
  onToggle: () => void;
  send: (intent: ViewIntent) => void;
  /** Classes added to the button, for the place it stands in. */
  className?: string;
}) {
  const choose = (value: string) => {
    onToggle();
    if (value !== brain.current) { send({ type: 'setConfigOption', configId: brain.configId, value }); }
  };
  return (
    <span className="brain-wrap">
      <button className={'brain-btn' + (className ? ' ' + className : '')} aria-haspopup="listbox" aria-expanded={open}
        title="The brain of the principal. Click to choose another; it takes over from your next message. Its default is set in jawata studio, Seats view." onClick={onToggle}>{brain.label + ' ▾'}</button>
      {open ? (
        <div className="brain-menu" role="listbox" aria-label="Brain for the principal"
          onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onToggle(); } }}>
          {brain.choices.map(c => (
            <div className="brain-item" role="option" aria-selected={c.value === brain.current} tabIndex={0} key={c.value}
              onClick={() => choose(c.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); choose(c.value); } }}>
              <span className="brain-check">{c.value === brain.current ? '✓' : ''}</span>{c.name}
            </div>
          ))}
        </div>
      ) : null}
    </span>
  );
}

/** The autocontinue switch: pressed means the agent reports the grant armed; pressing sends the opposite value and waits for the agent's word. */
export function AutonomyButton({ armed, onPress }: { armed: boolean; onPress: (next: 'on' | 'off') => void }) {
  return (
    <button className={'autonomy-btn' + (armed ? ' armed' : '')} data-config-id={AUTONOMY_OPTION} aria-pressed={armed}
      title={armed
        ? 'Autocontinue is on: the agent goes on from one checkpoint to the next by itself. Press to end it.'
        : 'Autocontinue is off: the agent stops at each checkpoint. Press to let it go on by itself.'}
      onClick={e => { e.stopPropagation(); onPress(armed ? 'off' : 'on'); }}>
      <span className="picker-icon">{armed ? '⏵⏵' : '⏸'}</span>
      <span className="picker-label">{armed ? 'Autocontinue on' : 'Autocontinue off'}</span>
    </button>
  );
}

