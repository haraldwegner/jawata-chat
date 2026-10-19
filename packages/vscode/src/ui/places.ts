import * as vscode from 'vscode';

/** Where the chat can be: the left side bar, the right (secondary) side bar, the bottom panel, or the editor area. */
export type Place = 'left' | 'right' | 'bottom' | 'center';

const PLACES: readonly Place[] = ['left', 'right', 'bottom', 'center'];

/** The view that holds the chat in each place that is a view (the editor area is a panel, not a view). */
export const VIEW_OF: Record<Exclude<Place, 'center'>, string> = {
  left: 'jawata-chat-view',
  right: 'jawata-chat-view-right',
  bottom: 'jawata-chat-view-bottom',
};

/** The place the setting names; the left side bar if it names none that exists. */
export function chosenPlace(): Place {
  const named = vscode.workspace.getConfiguration('jawataChat').get<string>('placement', 'left');
  return (PLACES as readonly string[]).includes(named) ? named as Place : 'left';
}
