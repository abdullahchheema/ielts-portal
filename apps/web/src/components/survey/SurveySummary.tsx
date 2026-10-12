import { SurveyDraftInput } from '@ielts/validation';
import { DefinitionList, Empty } from '@/components/ui';
import { DAILY_MINUTES_LABEL, SKILL_LABEL, TIMELINE_LABEL } from './questions';
import { band } from '@/lib/format';

export interface SurveyDoc extends SurveyDraftInput {
  status: 'DRAFT' | 'SUBMITTED';
  revision: number;
  submittedAt: string | null;
}

/** Compact target band / timeline / priority skill / study time summary, reused across admin, mentor and student views. */
export function SurveySummary({ doc }: { doc: SurveyDoc | undefined }) {
  if (!doc || doc.status !== 'SUBMITTED') return <Empty>No onboarding survey submitted yet.</Empty>;
  return (
    <DefinitionList items={[
      { label: 'Target band', value: band(doc.targetBand) },
      { label: 'Test timeline', value: doc.testTimeline ? TIMELINE_LABEL[doc.testTimeline] : '—' },
      { label: 'Priority skill', value: doc.challengingSkills?.[0] ? SKILL_LABEL[doc.challengingSkills[0]] : '—' },
      { label: 'Daily study time', value: doc.dailyMinutes ? DAILY_MINUTES_LABEL[doc.dailyMinutes] : '—' },
    ]} />
  );
}
