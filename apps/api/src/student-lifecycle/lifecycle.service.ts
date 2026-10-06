import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@ielts/db';
import { AuditService } from '../audit/audit.service';
import { conflict, notFound } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { ENROLLMENT_ACTIVATED, EnrollmentActivatedEvent } from '../commerce/events';
import { allowedNext, canTransition, LifecycleStage, isLifecycleStage } from './lifecycle-rules';

/** Other modules emit this with a system signal. They never import this service, so there are no import cycles. */
export const LIFECYCLE_SIGNAL = 'lifecycle.signal';

export interface LifecycleSignal {
  studentId: string;
  to: LifecycleStage;
  reason: string;
}

/**
 * The single writer of student lifecycle stages. System signals are applied only when the current stage allows them,
 * and an ignored signal is logged rather than thrown, because it is normal for events to arrive out of order.
 * Staff transitions are strict: a move that is not allowed is refused with a reason.
 */
@Injectable()
export class LifecycleStageService {
  private readonly logger = new Logger(LifecycleStageService.name);

  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @OnEvent(LIFECYCLE_SIGNAL, { async: true })
  async onSignal(signal: LifecycleSignal) {
    await this.signal(signal);
  }

  @OnEvent(ENROLLMENT_ACTIVATED, { async: true })
  async onEnrolled(ev: EnrollmentActivatedEvent) {
    await this.signal({ studentId: ev.studentId, to: 'ENROLLED', reason: 'Enrolment activated' });
  }

  /** Applies a system signal. Returns whether the stage changed. Never throws: a failure here must not break the event's source. */
  async signal(s: LifecycleSignal): Promise<{ changed: boolean; from: string | null; to: string }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const cur = await tx.studentLifecycle.findUnique({ where: { studentId: s.studentId }, select: { stage: true } });
        const from = cur && isLifecycleStage(cur.stage) ? cur.stage : null;
        if (from === s.to || !canTransition(from, s.to)) {
          if (from !== s.to) this.logger.debug(`Lifecycle signal ${s.to} ignored for ${s.studentId} at ${from}`);
          return { changed: false, from, to: s.to };
        }
        await this.write(tx, s.studentId, from, s.to, s.reason, 'SYSTEM', null);
        return { changed: true, from, to: s.to };
      });
    } catch (err) {
      // A concurrent signal may have written first (unique key or moved stage). The next signal will reconcile.
      this.logger.warn(`Lifecycle signal ${s.to} for ${s.studentId} not applied: ${(err as Error).message}`);
      return { changed: false, from: null, to: s.to };
    }
  }

  /** Staff move, checked against the allowed map and audited inside the same transaction. */
  async transitionByStaff(studentId: string, to: LifecycleStage, reason: string, actor: { userId: string; ip?: string; userAgent?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const student = await tx.studentProfile.findUnique({ where: { id: studentId }, select: { id: true } });
      if (!student) throw notFound('Student');
      const cur = await tx.studentLifecycle.findUnique({ where: { studentId }, select: { stage: true } });
      const from = cur && isLifecycleStage(cur.stage) ? cur.stage : null;
      if (from === to) throw conflict('CONFLICT', `The student is already ${to.toLowerCase().replace(/_/g, ' ')}.`);
      if (!canTransition(from, to)) {
        const next = from ? allowedNext(from).map((s) => s.toLowerCase().replace(/_/g, ' ')).join(', ') : 'any stage';
        throw conflict('CONFLICT', `A student cannot move from ${(from ?? 'no stage').toLowerCase().replace(/_/g, ' ')} to ${to.toLowerCase().replace(/_/g, ' ')}. Allowed next: ${next}.`);
      }
      await this.write(tx, studentId, from, to, reason, 'STAFF', actor.userId);
      await this.audit.record({
        userId: actor.userId, ip: actor.ip, userAgent: actor.userAgent,
        action: 'LIFECYCLE_CHANGED', entityType: 'StudentProfile', entityId: studentId,
        before: { stage: from }, after: { stage: to, reason },
      }, tx);
      return { studentId, from, to };
    });
  }

  /** The current stage and its full history, newest first. Staff see the reasons and sources; the actor is shown by role only. */
  async timeline(studentId: string) {
    const [cur, rows] = await Promise.all([
      this.prisma.studentLifecycle.findUnique({ where: { studentId }, select: { stage: true, since: true } }),
      this.prisma.studentLifecycleTransition.findMany({
        where: { studentId }, orderBy: { createdAt: 'desc' }, take: 200,
        select: { id: true, fromStage: true, toStage: true, reason: true, source: true, createdAt: true },
      }),
    ]);
    return { stage: cur?.stage ?? null, since: cur?.since ?? null, transitions: rows };
  }

  async currentStage(studentId: string): Promise<string | null> {
    const cur = await this.prisma.studentLifecycle.findUnique({ where: { studentId }, select: { stage: true } });
    return cur?.stage ?? null;
  }

  private async write(tx: Prisma.TransactionClient, studentId: string, from: LifecycleStage | null, to: LifecycleStage, reason: string, source: 'SYSTEM' | 'STAFF', actorId: string | null) {
    if (from === null) {
      await tx.studentLifecycle.create({ data: { studentId, stage: to } });
    } else {
      // Conditional move: if the stage changed underneath us, this fails and nothing is recorded.
      const moved = await tx.studentLifecycle.updateMany({ where: { studentId, stage: from }, data: { stage: to, since: new Date() } });
      if (moved.count === 0) throw conflict('CONFLICT', 'The student\'s stage changed while you were editing. Refresh and try again.');
    }
    await tx.studentLifecycleTransition.create({ data: { studentId, fromStage: from, toStage: to, reason, source, actorId } });
  }
}
