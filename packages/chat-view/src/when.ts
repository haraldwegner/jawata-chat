/**
 * A time the agent sent, as the person reads it in the History list, chosen by distance from now and not by calendar year (his ruling
 * 2026-11-18): `Today 1:39 AM`, `Yesterday 9:14 PM`, `Dec 30, 9:14 PM` within about six months, `Dec 30, 2025` beyond. A Dec 30 row read on
 * Jan 2 shows no year and cannot be misread. What the agent sent is returned as it is when it is not a time.
 */
export function whenIs(sent: string, now: Date = new Date()): string {
  const at = new Date(sent);
  if (Number.isNaN(at.getTime())) {
    return sent;
  }
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const dayOf = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const daysAgo = Math.round((dayOf(now) - dayOf(at)) / 86_400_000);
  if (daysAgo === 0) {
    return `Today ${time}`;
  }
  if (daysAgo === 1) {
    return `Yesterday ${time}`;
  }
  const day = at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return daysAgo >= 0 && daysAgo <= SIX_MONTHS_IN_DAYS ? `${day}, ${time}` : `${day}, ${at.getFullYear()}`;
}

/** About six months, in days: from there on the year is shown. */
const SIX_MONTHS_IN_DAYS = 183;
