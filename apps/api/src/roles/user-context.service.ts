import { Injectable } from '@nestjs/common';
import { AccountStatus } from '@ielts/db';
import { PrismaService } from '../prisma/prisma.service';

export interface UserContext {
  id: string;
  email: string;
  status: AccountStatus;
  roles: string[];
  permissions: Set<string>;
  studentId?: string;
  mentorId?: string;
  mfaEnabled: boolean;
}

const TTL_MS = 30_000;

/** Loads roles/permissions with a short in-process cache; invalidate() after role changes. */
@Injectable()
export class UserContextService {
  private readonly cache = new Map<string, { at: number; ctx: UserContext }>();

  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<UserContext | null> {
    const hit = this.cache.get(userId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.ctx;

    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        student: { select: { id: true } },
        mentor: { select: { id: true } },
        mfa: { select: { confirmedAt: true } },
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      },
    });
    if (!user) return null;

    const ctx: UserContext = {
      id: user.id,
      email: user.email,
      status: user.status,
      roles: user.roles.map((r) => r.role.name),
      permissions: new Set(user.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.key))),
      studentId: user.student?.id,
      mentorId: user.mentor?.id,
      mfaEnabled: !!user.mfa?.confirmedAt,
    };
    this.cache.set(userId, { at: Date.now(), ctx });
    return ctx;
  }

  invalidate(userId?: string) {
    if (userId) this.cache.delete(userId);
    else this.cache.clear();
  }
}
