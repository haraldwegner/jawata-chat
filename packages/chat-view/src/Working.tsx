import { useEffect, useState } from 'react';

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

/** The sign that the agent is working on the message: moving dots and how long it has been at it. */
export function Working({ running }: { running: boolean }) {
  const seconds = useRunningSeconds(running);
  if (!running) { return null; }
  return (
    <div className="working" role="status" title="The agent is working on your message.">
      <span className="working-dots" aria-hidden="true"><i /><i /><i /></span>
      <span className="working-time">{seconds}s</span>
    </div>
  );
}
