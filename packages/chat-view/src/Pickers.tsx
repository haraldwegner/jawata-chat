import type { ViewSession } from '@jawata/chat-core';

/** One choice in a picker. */
interface Choice { value: string; name: string; description?: string | null }
interface Group { name: string; choices: Choice[] }

/** What a picker shows: where it comes from decides what choosing does. */
export interface PickerModel {
  id: string;
  icon: string;
  title: string;
  label: string;
  groups: Group[];
  current: string;
  /** The intent choosing a value sends. */
  choose: (value: string) => void;
}

const ICONS: Record<string, string> = { mode: '⚡', model: '🧠', thought_level: '💭' };

/** The id of a jawata seat's model option is this prefix and the seat's name. */
const SEAT_MODEL = 'seat-model:';

type RawChoice = { value?: string; name?: string; description?: string | null };
type RawOption = { id: string; name?: string; description?: string | null; category?: string | null; type?: string; currentValue?: string; options?: unknown[] };

function choicesOf(raw: unknown[] | undefined): Group[] {
  if (!Array.isArray(raw) || raw.length === 0) { return []; }
  const first = raw[0] as { group?: unknown; options?: unknown };
  if (typeof first?.group === 'string' && Array.isArray(first.options)) {
    return (raw as { group: string; name?: string; options: RawChoice[] }[])
      .filter(g => g && Array.isArray(g.options))
      .map(g => ({ name: g.name || g.group, choices: g.options.map(o => ({ value: o.value ?? '', name: o.name || o.value || '', description: o.description })) }));
  }
  return [{ name: '', choices: (raw as RawChoice[]).filter(Boolean).map(o => ({ value: o.value ?? '', name: o.name || o.value || '', description: o.description })) }];
}

/** The pickers for a session: its config options when it has any (they supersede modes and models), the legacy ones otherwise. */
export function pickersFor(
  session: ViewSession,
  chosen: Record<string, string>,
  send: { setConfigOption(configId: string, value: string): void; setMode(modeId: string): void; setModel(modelId: string): void },
): PickerModel[] {
  const options = (session.configOptions ?? []) as unknown as RawOption[];
  if (options.length > 0) {
    return options
      .filter(o => o && o.type === 'select' && Array.isArray(o.options) && o.options.length > 0)
      .map(o => {
        const groups = choicesOf(o.options);
        const current = chosen[o.id] ?? o.currentValue ?? '';
        const hit = groups.flatMap(g => g.choices).find(c => c.value === current);
        // a seat's model says whose it is: two seats may use the same model
        const seat = o.id.startsWith(SEAT_MODEL) ? o.id.slice(SEAT_MODEL.length) : undefined;
        const described = hit?.description || o.description || o.name || '';
        return {
          id: o.id,
          icon: ICONS[o.category ?? ''] ?? '⚙',
          title: seat ? `The model the ${seat} seat uses. ${described}`.trim() : described,
          label: seat ? `${seat} · ${hit?.name || 'model'}` : hit?.name || o.name || 'Option',
          groups, current,
          choose: (value: string) => send.setConfigOption(o.id, value),
        };
      });
  }
  const pickers: PickerModel[] = [];
  const modes = session.modes;
  if (modes && modes.availableModes.length > 0) {
    const current = chosen['mode'] ?? modes.currentModeId ?? '';
    const hit = modes.availableModes.find(m => m.id === current);
    pickers.push({
      id: 'mode', icon: '⚡', title: hit?.description || 'Select mode', label: hit?.name || 'Mode', current,
      groups: [{ name: '', choices: modes.availableModes.map(m => ({ value: m.id, name: m.name, description: m.description })) }],
      choose: send.setMode,
    });
  }
  const models = session.models;
  if (models && models.availableModels.length > 0) {
    const current = chosen['model'] ?? models.currentModelId ?? '';
    const hit = models.availableModels.find(m => m.modelId === current);
    pickers.push({
      id: 'model', icon: '🧠', title: hit?.description || 'Select model', label: hit?.name || 'Model', current,
      groups: [{ name: '', choices: models.availableModels.map(m => ({ value: m.modelId, name: m.name, description: m.description })) }],
      choose: send.setModel,
    });
  }
  return pickers;
}

export function Picker({ model, open, onToggle, onChoose }: { model: PickerModel; open: boolean; onToggle: () => void; onChoose: (value: string) => void }) {
  return (
    <div className="picker-wrap" data-config-id={model.id}>
      <button className="picker-btn" title={model.title} onClick={e => { e.stopPropagation(); onToggle(); }}>
        <span className="picker-icon">{model.icon}</span>
        <span className="picker-label">{model.label}</span>
        <span className="picker-chevron">▾</span>
      </button>
      <div className={'picker-dropdown' + (open ? ' open' : '')}>
        {model.groups.map((g, gi) => (
          <div key={gi}>
            {g.name ? <div className="picker-dropdown-group-header">{g.name}</div> : null}
            {g.choices.map(c => (
              <div key={c.value} className={'picker-dropdown-item' + (c.value === model.current ? ' selected' : '')} title={c.description || undefined} data-value={c.value}
                onClick={e => { e.stopPropagation(); onChoose(c.value); }}>
                <span className="check">{c.value === model.current ? '✓' : ''}</span>
                <span className="item-label">{c.name}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
