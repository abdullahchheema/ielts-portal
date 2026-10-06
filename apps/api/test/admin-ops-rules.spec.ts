import { describe, expect, it } from 'vitest';
import { leastLoaded, roleFor, slaDueAt, slaState } from '../src/support/routing';

/** Support routing and service levels. Pure. */

const T0 = new Date('2026-10-06T08:00:00Z');
const hours = (h: number) => new Date(T0.getTime() + h * 3_600_000);

describe('support routing', () => {
  it('payment tickets go to finance, certificate and course tickets to academic, technical to support', () => {
    expect(roleFor('PAYMENT')).toBe('FINANCE_ADMIN');
    expect(roleFor('CERTIFICATE')).toBe('ACADEMIC_ADMIN');
    expect(roleFor('COURSE')).toBe('ACADEMIC_ADMIN');
    expect(roleFor('TECHNICAL')).toBe('SUPPORT_AGENT');
  });
  it('an unknown category falls back to support rather than being dropped', () => {
    expect(roleFor('SOMETHING_NEW')).toBe('SUPPORT_AGENT');
  });
});

describe('service levels', () => {
  it('urgent tickets are due soonest, low priority latest', () => {
    expect(slaDueAt(T0, 'URGENT').getTime()).toBeLessThan(slaDueAt(T0, 'LOW').getTime());
  });
  it('a ticket is on track, due soon, then breached as its clock runs out', () => {
    const due = hours(24);
    expect(slaState({ slaDueAt: due, firstResponseAt: null, status: 'OPEN' }, hours(1))).toBe('ON_TRACK');
    expect(slaState({ slaDueAt: due, firstResponseAt: null, status: 'OPEN' }, hours(23))).toBe('DUE_SOON');
    expect(slaState({ slaDueAt: due, firstResponseAt: null, status: 'OPEN' }, hours(25))).toBe('BREACHED');
  });
  it('a first response stops the clock', () => {
    expect(slaState({ slaDueAt: hours(1), firstResponseAt: hours(0), status: 'IN_PROGRESS' }, hours(5))).toBe('MET');
  });
  it('a resolved ticket is never breached', () => {
    expect(slaState({ slaDueAt: hours(1), firstResponseAt: null, status: 'RESOLVED' }, hours(5))).toBe('MET');
  });
});

describe('assignment', () => {
  it('chooses the least loaded person, and is stable on ties', () => {
    expect(leastLoaded([{ id: 'b', open: 2 }, { id: 'a', open: 2 }, { id: 'c', open: 5 }])).toBe('a');
    expect(leastLoaded([{ id: 'z', open: 0 }, { id: 'y', open: 1 }])).toBe('z');
  });
  it('with nobody available it chooses no one', () => {
    expect(leastLoaded([])).toBeNull();
  });
});
