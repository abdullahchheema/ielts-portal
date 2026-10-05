import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_WINDOW, SKILLS, gapTo, overallEstimate, skillEstimate, type OverallEstimate, type Skill, type SkillEstimateCore, type Trend,
} from './band';

/** One dated, scored point from either source. Both sources feed one history, nothing is overwritten. */
export interface BandPoint { at: Date | null; band: number; title: string; source: 'ASSESSMENT' | 'GRADED_WORK' }

export interface SkillEstimate extends SkillEstimateCore {
  /** Kept for the existing /me/skills consumers: most recent band, and the best band ever. */
  latest: number | null;
  best: number | null;
  target: number | null;
  gapToTarget: number | null;
  /** Oldest first, as /me/skills has always returned it. */
  series: BandPoint[];
}

export interface StudentBandEstimate extends OverallEstimate {
  studentId: string;
  skills: Record<Skill, SkillEstimate>;
  target: number | null;
  gapToTarget: number | null;
}

/**
 * Estimated bands per student, from real records only. Used by /me/skills, the teacher batch
 * results and the coming analytics endpoints, so that every screen reports the same number.
 */
@Injectable()
export class BandService {
  constructor(private readonly prisma: PrismaService) {}

  /** Estimate for one student. */
  async forStudent(studentId: string, opts: { window?: number } = {}): Promise<StudentBandEstimate> {
    const map = await this.forCohort([studentId], opts);
    return map.get(studentId)!;
  }

  /**
   * Estimates for many students at once. Two bounded queries whatever the cohort size; the caller
   * must pass a bounded list (the whole-academy view is handled by the analytics layer).
   */
  async forCohort(studentIds: string[], opts: { window?: number } = {}): Promise<Map<string, StudentBandEstimate>> {
    const window = opts.window ?? DEFAULT_WINDOW;
    const points = new Map<string, Record<Skill, BandPoint[]>>();
    const bucket = (sid: string) => {
      if (!points.has(sid)) points.set(sid, { LISTENING: [], READING: [], WRITING: [], SPEAKING: [] });
      return points.get(sid)!;
    };
    if (studentIds.length === 0) return new Map();

    const attempts = await this.prisma.assessmentAttempt.findMany({
      where: { studentId: { in: studentIds }, bandScore: { not: null }, submittedAt: { not: null }, assessment: { skill: { not: null } } },
      select: { studentId: true, bandScore: true, submittedAt: true, assessment: { select: { skill: true, title: true } } },
    });
    for (const a of attempts) {
      bucket(a.studentId)[a.assessment.skill as Skill]?.push({ at: a.submittedAt, band: Number(a.bandScore), title: a.assessment.title, source: 'ASSESSMENT' });
    }

    const graded = await this.prisma.submission.findMany({
      where: { studentId: { in: studentIds }, status: 'GRADED', finalBand: { not: null } },
      select: { studentId: true, finalBand: true, gradedAt: true, assignment: { select: { skill: true, contentItem: { select: { title: true } } } } },
    });
    for (const g of graded) {
      bucket(g.studentId)[g.assignment.skill as Skill]?.push({ at: g.gradedAt, band: Number(g.finalBand), title: g.assignment.contentItem.title, source: 'GRADED_WORK' });
    }

    const out = new Map<string, StudentBandEstimate>();
    for (const sid of studentIds) {
      const perSkill = bucket(sid);
      const skills = {} as Record<Skill, SkillEstimate>;
      for (const skill of SKILLS) {
        const series = [...perSkill[skill]].sort((x, y) => (x.at?.getTime() ?? 0) - (y.at?.getTime() ?? 0));
        const newestFirst = [...series].reverse().map((p) => p.band);
        const core = skillEstimate(newestFirst, window);
        skills[skill] = {
          ...core,
          latest: series.length ? series[series.length - 1].band : null,
          best: series.length ? Math.max(...series.map((p) => p.band)) : null,
          target: null,
          gapToTarget: null,
          series,
        };
      }
      const overall = overallEstimate(skills);
      out.set(sid, { studentId: sid, skills, ...overall, target: null, gapToTarget: null });
    }
    return out;
  }
}

/** Target gap is computed by the caller that knows the student's targets, so the engine stays free of profile reads. */
export function withTargets(est: StudentBandEstimate, targets: { overall: number | null; skills: Partial<Record<Skill, number | null>> }): StudentBandEstimate {
  const skills = { ...est.skills } as Record<Skill, SkillEstimate>;
  for (const skill of SKILLS) {
    const target = targets.skills[skill] ?? targets.overall;
    skills[skill] = { ...skills[skill], target: target ?? null, gapToTarget: gapTo(target ?? null, skills[skill].estimated) };
  }
  return { ...est, skills, target: targets.overall, gapToTarget: gapTo(targets.overall, est.overall) };
}

export type { Trend };
