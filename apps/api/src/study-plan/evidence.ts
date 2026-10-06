/** Emitted when a student does a plan item (a writing submission, a vocabulary review). The plan completes matching tasks. */
export const STUDY_EVIDENCE = 'study-plan.evidence';
export interface StudyEvidence { studentId: string; refType: string; refId: string }
