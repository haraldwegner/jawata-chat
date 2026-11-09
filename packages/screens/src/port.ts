/**
 * The one port between jawata's screens and the host they run in. Every host (Eclipse's browser widget now, Theia later) answers it with
 * one small adapter, and the screens never know which host they are in.
 */

/** Any value that crosses the port: JSON, the only thing both sides can read. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** How a call crosses the line: answered at once, or a promise answered later and never on the interface thread. */
export type CallKind = 'at-once' | 'promise';

/** What the host can do for a screen. */
export interface ScreensPort {
  /** What the knowledge store holds. */
  knowledgeStatus(): Promise<Json>;
  /** One action on the knowledge store, from the host's allowed list. */
  experienceVerb(verb: string, args: Json): Promise<Json>;
  /** Changes the memory settings; the two kept on the page of Preferences are not sent here. */
  updateSettings(settings: Json): Promise<Json>;
  /** Whether the engine answers and which projects it cannot read. */
  resolutionStatus(): Promise<Json>;
  /** The failures the engine recorded on this machine. */
  fieldStatus(): Promise<Json>;
  /** Switches the failure reminders on or off. */
  fieldSetSilence(silenced: boolean): Promise<Json>;
  /** The seats with their settings. */
  seatsView(): Promise<Json>;
  /** Proposes a change to one seat; held until the page's Apply. */
  seatChange(seat: string, change: Json): Promise<Json>;
  /** Who hires whom. */
  workflowView(): Promise<Json>;
  /** Which brains this machine has. */
  brainsStatus(ids: string[]): Promise<Json>;
  /** A one-word test run through a brain. */
  brainProbe(brain: string, model: string | null): Promise<Json>;
  /** Asks the person for a file or folder to read; null when they cancelled. */
  openDialog(options: Json): Promise<string | null>;
  /** Asks the person where to write a file; null when they cancelled. */
  saveDialog(options: Json): Promise<string | null>;
  /** The product's version. */
  version(): Promise<string>;
  /** Whether the host is light or dark now; the one call answered at once, so a screen draws the right colours first time. */
  theme(): 'light' | 'dark';
}

/**
 * How each call of the port crosses the line. The type requires every member, so a call added to the port and left out here, or named
 * here and not on the port, fails to compile.
 * @public a host outside this repository (Eclipse's Java side) reads it to know what it must answer at once
 */
export const PORT_CALLS: { readonly [K in keyof Required<ScreensPort>]: CallKind } = {
  knowledgeStatus: 'promise',
  experienceVerb: 'promise',
  updateSettings: 'promise',
  resolutionStatus: 'promise',
  fieldStatus: 'promise',
  fieldSetSilence: 'promise',
  seatsView: 'promise',
  seatChange: 'promise',
  workflowView: 'promise',
  brainsStatus: 'promise',
  brainProbe: 'promise',
  openDialog: 'promise',
  saveDialog: 'promise',
  version: 'promise',
  theme: 'at-once',
};
