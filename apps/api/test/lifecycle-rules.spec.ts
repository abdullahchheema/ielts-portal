import { describe, expect, it } from 'vitest';
import { allowedNext, canTransition, isAlumniStage, isLifecycleStage, LIFECYCLE_STAGES, stageFromEngagement } from '../src/student-lifecycle/lifecycle-rules';

/** Lifecycle transition map. Pure. A visitor is never a stage, and alumni status comes only from completion. */

describe('lifecycle transitions', () => {
  it('the first recorded stage is accepted from any signal', () => {
    expect(canTransition(null, 'ENROLLED')).toBe(true);
    expect(canTransition(null, 'ALUMNI')).toBe(true);
  });

  it('a stage cannot move to itself', () => {
    expect(canTransition('ACTIVE', 'ACTIVE')).toBe(false);
  });

  it('the application path runs forward', () => {
    expect(canTransition('REGISTERED', 'APPLICATION_SUBMITTED')).toBe(true);
    expect(canTransition('APPLICATION_SUBMITTED', 'PAYMENT_APPROVED')).toBe(true);
    expect(canTransition('PAYMENT_APPROVED', 'ENROLLED')).toBe(true);
    expect(canTransition('ENROLLED', 'ACTIVE')).toBe(true);
  });

  it('an enrolled student cannot jump straight to alumni; completion comes first', () => {
    expect(canTransition('ENROLLED', 'ALUMNI')).toBe(false);
    expect(canTransition('ACTIVE', 'ALUMNI')).toBe(false);
    expect(canTransition('COMPLETED', 'ALUMNI')).toBe(true);
  });

  it('engagement moves an active student between active, at risk and inactive, and back', () => {
    expect(canTransition('ACTIVE', 'AT_RISK')).toBe(true);
    expect(canTransition('AT_RISK', 'INACTIVE')).toBe(true);
    expect(canTransition('INACTIVE', 'ACTIVE')).toBe(true);
  });

  it('an alumnus stays an alumnus when engagement later reports inactivity', () => {
    expect(canTransition('ALUMNI', 'INACTIVE')).toBe(false);
    expect(canTransition('ALUMNI', 'AT_RISK')).toBe(false);
  });

  it('an alumnus who re-enrols moves back to enrolled', () => {
    expect(canTransition('ALUMNI', 'ENROLLED')).toBe(true);
  });

  it('every stage lists its allowed next stages, none of which is itself', () => {
    for (const stage of LIFECYCLE_STAGES) {
      const next = allowedNext(stage);
      expect(next).not.toContain(stage);
      for (const n of next) expect(LIFECYCLE_STAGES).toContain(n);
    }
  });
});

describe('lifecycle helpers', () => {
  it('only the stages in the map are accepted from storage', () => {
    expect(isLifecycleStage('ACTIVE')).toBe(true);
    expect(isLifecycleStage('VISITOR')).toBe(false);
  });

  it('engagement statuses map onto stages, and reactivation counts as active', () => {
    expect(stageFromEngagement('REACTIVATED')).toBe('ACTIVE');
    expect(stageFromEngagement('AT_RISK')).toBe('AT_RISK');
  });

  it('only the ALUMNI stage opens the alumni area', () => {
    expect(isAlumniStage('ALUMNI')).toBe(true);
    expect(isAlumniStage('COMPLETED')).toBe(false);
    expect(isAlumniStage(null)).toBe(false);
  });
});
