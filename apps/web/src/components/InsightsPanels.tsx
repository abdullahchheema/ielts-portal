import { Alert, Badge, Card, Empty, Loading, ProgressRing, Section, SkillScoreCard, Table, Td } from '@/components/ui';

export interface Group { key: string; total: number; correct: number; accuracy: number | null; level: string }
export interface Weakness { bySkill: Group[]; byQuestionType: Group[]; byTopic: Group[]; byDifficulty: Group[]; writingCriteria: { key: string; score: number | null; level: string; gap: number | null }[]; answered: number }
export interface Readiness { percent: number; label: string; reasons: string[]; components: { key: string; score: number; weight: number }[] }
export interface TargetPlan {
  labelled: string; target: number | null;
  current?: { overallEstimate: number | null; skills: Record<string, number | null> };
  gaps?: { skill: string; current: number | null; gap: number | null }[];
  biggestGap?: { skill: string; gap: number | null } | null;
  weeklyImprovementTarget?: number | null;
  combinations?: { scores: Record<string, number>; overall: number; cost: number }[];
}
interface QueryLike<T> { isLoading: boolean; isError: boolean; data: T | undefined }

const LEVEL: Record<string, string> = { HIGH_RISK: 'High risk', NEEDS_PRACTICE: 'Needs practice', STRONG: 'Strong', INSUFFICIENT_DATA: 'Not enough data' };
const COMPONENT: Record<string, string> = { scores: 'Recent scores', mocks: 'Mock tests', consistency: 'Consistency', completion: 'Course completion', attendance: 'Attendance', assignments: 'Assignments', balance: 'Skill balance', trend: 'Improvement trend' };
const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`);

/**
 * The weakness/readiness/target-band panels — originally the student's own Insights page, factored out
 * so the admin per-student drill-down can show the exact same thing read-only, from an `:id`-parameterized
 * endpoint instead of `/me/*`.
 */
export function InsightsPanels({ weak, ready, target }: { weak: QueryLike<Weakness>; ready: QueryLike<Readiness>; target: QueryLike<TargetPlan> }) {
  return (
    <>
      <Section title="Readiness estimate" description="A guide to preparation. It is not a probability of reaching a band.">
        {ready.isLoading && <Loading />}
        {ready.isError && <Alert>Could not load readiness.</Alert>}
        {ready.data && (
          <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
            <Card className="flex flex-col items-center justify-center gap-2 lg:w-60">
              <ProgressRing value={ready.data.percent} size={110} label="Readiness estimate" />
              <p className="text-sm font-medium text-fg">Readiness estimate</p>
            </Card>
            <Card className="space-y-3">
              {ready.data.reasons.length ? (
                <ul className="list-disc space-y-1 pl-5 text-sm text-fg">{ready.data.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              ) : <p className="text-sm text-fg-muted">Nothing is holding readiness back right now.</p>}
              <ul className="grid gap-2 sm:grid-cols-2">
                {ready.data.components.map((c) => (
                  <li key={c.key} className="flex items-center justify-between text-sm"><span className="text-fg-muted">{COMPONENT[c.key] ?? c.key}</span><span className="tabular-nums text-fg">{Math.round(c.score * 100)}%</span></li>
                ))}
              </ul>
            </Card>
          </div>
        )}
      </Section>

      <Section title="Target band planning" description={target.data?.labelled} className="mt-6">
        {target.isLoading && <Loading />}
        {target.data && target.data.target === null && <Empty title="No target band set">A target band has not been set for this student yet.</Empty>}
        {target.data && target.data.target !== null && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {(target.data.gaps ?? []).map((g) => (
                <SkillScoreCard key={g.skill} skill={g.skill[0] + g.skill.slice(1).toLowerCase()} band={g.current} target={target.data!.target} />
              ))}
            </div>
            <Card className="space-y-2 text-sm">
              <p className="text-fg">Target: <span className="font-semibold">{target.data.target}</span>{target.data.current?.overallEstimate !== null && target.data.current?.overallEstimate !== undefined ? ` · estimated now ${target.data.current.overallEstimate}` : ''}</p>
              {target.data.biggestGap && target.data.biggestGap.gap !== null && target.data.biggestGap.gap > 0 && <p className="text-fg-muted">Largest gap: {target.data.biggestGap.skill.toLowerCase()} ({target.data.biggestGap.gap} band{target.data.biggestGap.gap === 1 ? '' : 's'}).</p>}
              {target.data.weeklyImprovementTarget ? <p className="text-fg-muted">About {target.data.weeklyImprovementTarget} band of overall improvement per week until the exam.</p> : null}
            </Card>
            {(target.data.combinations ?? []).length > 0 && (
              <Table head={['Listening', 'Reading', 'Writing', 'Speaking', 'Overall']}>
                {target.data.combinations!.map((c, i) => (
                  <tr key={i}>
                    <Td>{c.scores.LISTENING}</Td><Td>{c.scores.READING}</Td><Td>{c.scores.WRITING}</Td><Td>{c.scores.SPEAKING}</Td><Td className="font-semibold">{c.overall}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </div>
        )}
      </Section>

      <Section title="Weak areas" description="Accuracy on answers given. Groups with few answers are not judged yet." className="mt-6">
        {weak.isLoading && <Loading />}
        {weak.isError && <Alert>Could not load weak areas.</Alert>}
        {weak.data && weak.data.answered === 0 && <Empty title="No answers yet">Weak areas appear here once practice tests have been completed.</Empty>}
        {weak.data && weak.data.answered > 0 && (
          <div className="grid gap-4 lg:grid-cols-2">
            <GroupCard title="By skill" groups={weak.data.bySkill} />
            <GroupCard title="By question type" groups={weak.data.byQuestionType} />
            <GroupCard title="By topic" groups={weak.data.byTopic} />
            <GroupCard title="By difficulty" groups={weak.data.byDifficulty} />
            {weak.data.writingCriteria.length > 0 && (
              <Card className="space-y-2 lg:col-span-2">
                <h3 className="font-semibold text-fg">Writing criteria</h3>
                <ul className="space-y-1 text-sm">{weak.data.writingCriteria.map((c) => <li key={c.key} className="flex justify-between"><span className="text-fg-muted">{c.key.replace(/_/g, ' ').toLowerCase()}</span><Badge status={c.level} text={LEVEL[c.level] ?? c.level} /></li>)}</ul>
              </Card>
            )}
          </div>
        )}
      </Section>
    </>
  );
}

function GroupCard({ title, groups }: { title: string; groups: Group[] }) {
  return (
    <Card className="space-y-2">
      <h3 className="font-semibold text-fg">{title}</h3>
      {groups.length === 0 ? <p className="text-sm text-fg-muted">Nothing to show yet.</p> : (
        <ul className="space-y-2">
          {groups.map((g) => (
            <li key={g.key} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-fg">{g.key.replace(/_/g, ' ').toLowerCase()}</span>
              <span className="flex items-center gap-2 tabular-nums text-fg-muted">{pct(g.accuracy)} of {g.total}<Badge status={g.level} text={LEVEL[g.level] ?? g.level} /></span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
