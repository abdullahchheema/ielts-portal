import { Global, Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { forbidden, notFound } from './app-error';
import { overseesAllBatches } from './scope';

/** The caller. Either the permission set, or the already-decided `canOverseeAll` flag. */
export type ScopeActor = { mentorId?: string | null } & ({ permissions: Set<string> } | { canOverseeAll: boolean });

const oversees = (a: ScopeActor) => ('canOverseeAll' in a ? a.canOverseeAll : overseesAllBatches(a.permissions));

/**
 * Teacher scoping in one place. Every module that decides whether a teacher may see or act on a batch asks this
 * service. A batch that does not exist is 404; a batch the actor is not assigned to is 403, unless the actor may
 * oversee every batch.
 */
@Injectable()
export class ScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async assertBatch(actor: ScopeActor, batchId: string) {
    const batch = await this.prisma.batch.findFirst({ where: { id: batchId, deletedAt: null } });
    if (!batch) throw notFound('Batch');
    if (oversees(actor)) return batch;
    const assigned = actor.mentorId ? await this.prisma.batchMentor.count({ where: { batchId, mentorId: actor.mentorId, batch: { deletedAt: null } } }) : 0;
    if (!assigned) throw forbidden('You are not assigned to this batch.');
    return batch;
  }

  /** The batch ids an actor may see, or null when they may see every batch. */
  async visibleBatchIds(actor: ScopeActor): Promise<string[] | null> {
    if (oversees(actor)) return null;
    if (!actor.mentorId) return [];
    const rows = await this.prisma.batchMentor.findMany({ where: { mentorId: actor.mentorId, batch: { deletedAt: null } }, select: { batchId: true } });
    return rows.map((r) => r.batchId);
  }
}

@Global()
@Module({ providers: [ScopeService], exports: [ScopeService] })
export class ScopeModule {}
