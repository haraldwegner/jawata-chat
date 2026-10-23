import type { Disposable } from './view.js';

type Listener = (...args: any[]) => void;

/** The arguments each named event carries; an emitter that is given no map accepts any name. */
type EventMap<E> = { [K in keyof E]: unknown[] };

/** A small event emitter. chat-core has no node, so it cannot use node:events. */
export class Emitter<E extends EventMap<E> = Record<string, any[]>> {
  private readonly heard = new Map<keyof E, Set<Listener>>();

  on<K extends keyof E>(event: K, listener: (...args: E[K]) => void): this {
    const set = this.heard.get(event) ?? new Set<Listener>();
    this.heard.set(event, set.add(listener));
    return this;
  }

  once<K extends keyof E>(event: K, listener: (...args: E[K]) => void): this {
    const once: Listener = (...args) => { this.off(event, once); listener(...(args as E[K])); };
    return this.on(event, once);
  }

  /** Listen, and get the handle that stops listening: the one way a port's onSomething registration is written (ledger 28i-C20-4). */
  listen<K extends keyof E>(event: K, listener: (...args: E[K]) => void): Disposable {
    this.on(event, listener);
    return { dispose: () => { this.off(event, listener); } };
  }

  off<K extends keyof E>(event: K, listener: (...args: E[K]) => void): this {
    this.heard.get(event)?.delete(listener);
    return this;
  }

  emit<K extends keyof E>(event: K, ...args: E[K]): boolean {
    const set = this.heard.get(event);
    if (!set?.size) { return false; }
    [...set].forEach(listener => listener(...args));
    return true;
  }

  removeAllListeners(event?: keyof E): this {
    if (event === undefined) { this.heard.clear(); } else { this.heard.delete(event); }
    return this;
  }
}
