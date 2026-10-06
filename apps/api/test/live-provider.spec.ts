import { describe, expect, it } from 'vitest';
import { JOIN_EARLY_MS, liveClassProvider } from '../src/live/live-provider';

/** Live-class join window. Pure. The external link opens 15 minutes before the class and closes at its end. */
describe('live class provider', () => {
  const start = new Date('2026-10-07T10:00:00Z');
  const end = new Date('2026-10-07T11:30:00Z');
  const session = { meetingUrl: 'https://meet.example.com/x', startsAt: start, endsAt: end };
  const p = liveClassProvider('external');

  it('the external provider is the default', () => {
    expect(liveClassProvider(undefined).name).toBe('external');
  });
  it('the link is withheld until 15 minutes before, shown in the window, and withheld after the end', () => {
    expect(p.joinUrl(session, start.getTime() - JOIN_EARLY_MS - 1)).toBeNull();
    expect(p.joinUrl(session, start.getTime() - JOIN_EARLY_MS)).toBe(session.meetingUrl);
    expect(p.joinUrl(session, end.getTime())).toBe(session.meetingUrl);
    expect(p.joinUrl(session, end.getTime() + 1)).toBeNull();
  });
  it('a class without a meeting link has no join link', () => {
    expect(p.joinUrl({ ...session, meetingUrl: null }, start.getTime())).toBeNull();
  });
  it('an unknown provider is refused at startup rather than silently ignored', () => {
    expect(() => liveClassProvider('zoom-direct')).toThrow(/Unknown LIVE_CLASS_PROVIDER/);
  });
});
