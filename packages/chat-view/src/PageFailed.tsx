import { Component, Fragment, type ReactNode } from 'react';
import type { PageTransport } from '@jawata/chat-core/view';

/**
 * What the person sees when the chat could not be drawn (ledger 28i-C13-10): what stopped, and a Reload that draws the chat again from
 * the core, which holds the conversation, so nothing is lost. The core is told, so the host's log has it.
 */
export class PageFailed extends Component<{ transport: PageTransport; children?: ReactNode }, { error: string | null; attempt: number }> {
  override state = { error: null as string | null, attempt: 0 };

  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  override componentDidCatch(error: unknown): void {
    this.props.transport.send({ type: 'pageFailed', message: error instanceof Error ? error.message : String(error) });
  }

  override render(): ReactNode {
    if (this.state.error === null) { return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>; }
    return (
      <div className="page-failed" role="alert">
        <p>The chat view stopped working: {this.state.error}</p>
        <button type="button" title="Draws the chat again from what the chat holds; the conversation is not lost."
          onClick={() => this.setState(s => ({ error: null, attempt: s.attempt + 1 }))}>Reload the chat view</button>
      </div>
    );
  }
}
