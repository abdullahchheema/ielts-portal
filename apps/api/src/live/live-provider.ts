/**
 * Where a live class is joined. Pure. The academy uses an external meeting link; another provider can be added here
 * without changing the schedule, attendance or reminder code.
 */
export const JOIN_EARLY_MS = 15 * 60_000;

export interface LiveClassProvider {
  readonly name: string;
  /** The join link for a student at `now`, or null outside the join window. */
  joinUrl(session: { meetingUrl: string | null; startsAt: Date; endsAt: Date }, now: number): string | null;
}

export class ExternalLinkProvider implements LiveClassProvider {
  readonly name = 'external';
  joinUrl(s: { meetingUrl: string | null; startsAt: Date; endsAt: Date }, now: number): string | null {
    return s.meetingUrl && now >= s.startsAt.getTime() - JOIN_EARLY_MS && now <= s.endsAt.getTime() ? s.meetingUrl : null;
  }
}

export function liveClassProvider(name: string | undefined): LiveClassProvider {
  if (!name || name === 'external') return new ExternalLinkProvider();
  throw new Error(`Unknown LIVE_CLASS_PROVIDER: ${name}`);
}
