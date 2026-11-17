import { useEffect, useState } from 'react';
import type { Activity } from '@jawata/chat-core/view';

/** Whole seconds since `running` last became true. */
export function useRunningSeconds(running: boolean): number {
  const [startedAt, setStartedAt] = useState<number | null>(running ? Date.now() : null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) { setStartedAt(null); return undefined; }
    setStartedAt(at => at ?? Date.now());
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return startedAt === null ? 0 : Math.max(0, Math.round((now - startedAt) / 1000));
}

const ACTIVITY_WORDS: Record<Activity['kind'], string> = {
  thinking: 'The agent is thinking. Click to read what it thinks so far.',
  tool: 'The tool the agent uses now. Click to see what went into it.',
  delegating: 'The agent hands work to another agent. Click to read the prompt it sent.',
  waiting: 'The agent waits on an agent it hired. Click to read the prompt that agent was given.',
};

/** What the agent does now, beside the dots and seconds: one line, overwritten as it changes, that opens in place to what it names. */
function ActivityLine({ activity }: { activity: Activity }) {
  if (!activity.detail) { return <span className={'working-activity ' + activity.kind}>{activity.label}</span>; }
  return (
    <details className={'working-activity ' + activity.kind}>
      <summary title={ACTIVITY_WORDS[activity.kind]}>{activity.label}</summary>
      <pre className="working-detail">{activity.detail}</pre>
    </details>
  );
}

/** The sign that the agent is working on the message: moving dots, how long it has been at it, and what it does now until its answer begins. */
export function Working({ running, activity = null }: { running: boolean; activity?: Activity | null }) {
  const seconds = useRunningSeconds(running);
  if (!running) { return null; }
  return (
    <div className="working" role="status" title="The agent is working on your message.">
      <span className="working-dots" aria-hidden="true"><i /><i /><i /></span>
      <span className="working-time">{seconds}s</span>
      {activity ? <ActivityLine activity={activity} /> : null}
    </div>
  );
}
