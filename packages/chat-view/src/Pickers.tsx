import { AUTONOMY_OPTION, type ViewSession } from '@jawata/chat-core/view';

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

