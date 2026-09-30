import { Injectable } from '@nestjs/common';
import { Prisma } from '@ielts/db';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Pass the surrounding transaction client so the audit row commits or rolls back with the change. */
  record(entry: AuditEntry, tx: Prisma.TransactionClient | PrismaService = this.prisma) {
    return tx.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        beforeJson: (entry.before ?? undefined) as Prisma.InputJsonValue | undefined,
        afterJson: (entry.after ?? undefined) as Prisma.InputJsonValue | undefined,
        ipAddress: entry.ip,
        userAgent: entry.userAgent,
      },
    });
  }
}
