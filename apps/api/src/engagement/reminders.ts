/**
 * Class reminder timing. Pure: `now` is passed in, and the academy's wall-clock text is produced here so a batch's
 * local time is shown, not the server's. Deduplication keys keep the historical names for the existing reminders.
 */

export const REMINDER_OFFSETS_MINUTES = [1440, 60, 15] as const;

/** The dedupe key for one reminder. 24h keeps the legacy `class24:` key so nothing already sent is sent again. */
export function reminderKey(offsetMinutes: number, sessionId: string): string {
  const name = offsetMinutes === 1440 ? 'class24' : offsetMinutes === 60 ? 'class1h' : offsetMinutes === 15 ? 'class15' : `class${offsetMinutes}m`;
  return `${name}:${sessionId}`;
}

export interface SessionForReminder { id: string; topic: string; title: string | null; startsAt: Date; status: string; timezone: string }

/** Reminders due right now: the session starts within the offset, is not cancelled, and has not started yet. */
export function dueReminders(sessions: SessionForReminder[], offsets: readonly number[], now: Date) {
  const out: { sessionId: string; offsetMinutes: number; key: string; title: string; body: string }[] = [];
  for (const s of sessions) {
    if (s.status === 'CANCELLED' || s.status === 'COMPLETED' || s.status === 'LIVE') continue;
    const minutesLeft = (s.startsAt.getTime() - now.getTime()) / 60_000;
    if (minutesLeft <= 0) continue;
    for (const offset of offsets) {
      if (minutesLeft > offset) continue;
      const when = localText(s.startsAt, s.timezone);
      const label = s.title ?? s.topic;
      const title = offset === 1440 ? `Class tomorrow: ${label}` : offset === 60 ? `Class in one hour: ${label}` : `Starting soon: ${label}`;
      out.push({ sessionId: s.id, offsetMinutes: offset, key: reminderKey(offset, s.id), title, body: `Starts ${when}. Join from your Live classes page.` });
    }
  }
  return out;
}

/** "Mon 6 Oct, 19:30" in the batch's timezone. Falls back to UTC if the zone is unknown. */
export function localText(d: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(d) + ' UTC';
  }
}
