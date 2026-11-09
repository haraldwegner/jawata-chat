import { createRoot } from 'react-dom/client';
import type { FunctionComponent } from 'react';
import type { ScreensPort } from './port.js';
import { Reporting } from './Reporting.js';
import { SCREENS_CSS } from './screen.js';
import type { ScreenHandle, ScreenProps } from './screen.js';

/** The screens by the name a host opens them with. */
const SCREENS: Readonly<Record<string, FunctionComponent<ScreenProps>>> = { reporting: Reporting };

/**
 * Shows one screen.
 *
 * @param element where it is shown
 * @param port    the host
 * @param name    which screen
 * @returns what the host can ask of it
 */
export function mountScreen(element: Element, port: ScreensPort, name: string): ScreenHandle {
  const style = document.createElement('style');
  style.textContent = SCREENS_CSS;
  document.head.appendChild(style);
  document.documentElement.dataset.theme = port.theme();
  const handle: ScreenHandle = { refresh: () => Promise.resolve() };
  const Screen = SCREENS[name];
  createRoot(element).render(Screen ? <Screen port={port} handle={handle} /> : <p className="screen-error">jawata has no screen named {name}.</p>);
  return handle;
}
