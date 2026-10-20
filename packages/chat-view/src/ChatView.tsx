import { useEffect, useReducer, useState } from 'react';
import { initialViewState, reduce, type PageTransport } from '@jawata/chat-core/view';
import { AgentsBar } from './Agents.js';
import { History } from './History.js';
import { InputArea } from './InputArea.js';
import { Proposals } from './Proposals.js';
import { Messages, PlanBar } from './Messages.js';

/** The chat: a fold of the messages the core tells it, and the intents it sends back. It keeps no other state of the conversation. */
export function ChatView({ transport }: { transport: PageTransport }) {
  const [state, dispatch] = useReducer(reduce, undefined, initialViewState);
  useEffect(() => {
    const heard = transport.onMessage(message => {
      dispatch(message);
      // a list the core sends because it was asked for from outside the page (a command) is shown, not only kept
      if (message.type === 'sessionList' && message.show) { setHistory(true); }
    });
    transport.send({ type: 'ready' });
    return () => heard.dispose();
  }, [transport]);
  const session = state.session;
  const [history, setHistory] = useState(false);
  const toggleHistory = () => {
    if (!history) { transport.send({ type: 'listSessions' }); }
    setHistory(h => !h);
  };
  return (
    <>
      <div className={'session-banner' + (session ? ' visible' : '')}>
        <span className="dot" title={`Connected to ${session?.agentName ?? 'the agent'}`} />
        <div className="info" title={session?.cwd ? `The agent works in ${session.cwd}` : undefined}>
          <div className="agent">{session?.title || session?.agentName || 'Agent'}</div>
        </div>
        <button className="banner-btn history-btn" title="Shows the sessions the agent has, to open one again" onClick={toggleHistory}>History</button>
        <button className="banner-btn" title="Ends the agent program and closes this session. The chat then offers to connect again."
          onClick={() => transport.send({ type: 'disconnectAgent' })}>Disconnect</button>
      </div>
      {state.mismatch !== undefined ? (
        <div className="mismatch" role="alert" title="The view and the host that serves it were built for different versions of the chat's contract.">
          This chat view speaks version {state.contractVersion} of the contract and the host speaks version {state.mismatch}. Update the chat and reload it.
        </div>
      ) : null}
      {state.plan && state.plan.length > 0 ? <PlanBar plan={state.plan} /> : null}
      <AgentsBar state={state} send={transport.send.bind(transport)} />
      {history ? <History state={state} send={transport.send.bind(transport)} onClose={() => setHistory(false)} /> : null}
      <Messages state={state}
        onHistory={toggleHistory}
        onConnect={() => transport.send({ type: 'connectAgent' })}
        onConfigure={() => transport.send({ type: 'configureAgent' })} />
      <Proposals state={state} send={transport.send.bind(transport)} />
      <InputArea state={state} send={transport.send.bind(transport)} />
      <div className={'load-overlay' + (state.loading ? ' visible' : '')} role="status" aria-live="polite">
        <div className="spinner" />
        <div className="label">Loading the conversation…</div>
      </div>
    </>
  );
}
