import { Inject, Injectable } from '@nestjs/common';
import { AccountStatus, Prisma } from '@ielts/db';
import * as argon2 from 'argon2';
import { AuditService } from '../audit/audit.service';
import { randomToken, sha256 } from '../auth/tokens';
import { AppError, conflict, notFound } from '../common/app-error';
import { ieltsSummary } from '../common/ielts';
import { ADMIN_ROLES } from '../common/roles';
import { APP_CONFIG, AppConfig } from '../config/config.module';
import { Actor } from '../courses/courses.service';
import { MailService } from '../integrations/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserContextService } from '../roles/user-context.service';

/** Roles staff can be given via the admin API. STUDENT is implicit and MENTOR is created via the mentor endpoint. */
const ASSIGNABLE = [...ADMIN_ROLES, 'MENTOR'] as string[];

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ctx: UserContextService,
    private readonly mail: MailService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Headline numbers; each one only appears for roles that may see the underlying data. */
  async dashboard(permissions: Set<string>) {
    const has = (p: string) => permissions.has(p);
    const live = { deletedAt: null } as const;
    const [pendingApplications, pendingVerifications, enrolledStudents, students, activeBatches, upcomingBatches, teachers] = await Promise.all([
      has('enrollment.view') || has('payment.view') ? this.prisma.enrollment.count({ where: { ...live, status: 'PENDING_PAYMENT' } }) : null,
      has('payment.view') ? this.prisma.paymentProof.count({ where: { status: 'SUBMITTED' } }) : null,
      has('enrollment.view') ? this.prisma.enrollment.count({ where: { ...live, status: { in: ['ACTIVE', 'PAUSED', 'COMPLETED'] } } }) : null,
      has('student.view') ? this.prisma.studentProfile.count() : null,
      has('batch.view') ? this.prisma.batch.count({ where: { ...live, status: { in: ['OPEN', 'IN_PROGRESS'] } } }) : null,
      has('batch.view') ? this.prisma.batch.count({ where: { ...live, startAt: { gt: new Date() }, status: { in: ['DRAFT', 'OPEN'] } } }) : null,
      has('mentor.assign') ? this.prisma.mentorProfile.count({ where: { status: 'ACTIVE' } }) : null,
    ]);
    return { students, pendingApplications, pendingVerifications, enrolledStudents, activeBatches, upcomingBatches, teachers };
  }

  // ───────── students ─────────
  async listStudents(q: { search?: string; status?: AccountStatus; skip: number; take: number }) {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      student: { isNot: null },
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? { OR: [
            { email: { contains: q.search, mode: 'insensitive' } },
            { student: { firstName: { contains: q.search, mode: 'insensitive' } } },
            { student: { lastName: { contains: q.search, mode: 'insensitive' } } },
          ] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where, skip: q.skip, take: q.take, orderBy: { createdAt: 'desc' },
        select: {
          id: true, email: true, status: true, createdAt: true, lastLoginAt: true,
          student: {
            select: {
              id: true, firstName: true, lastName: true, currentBand: true, targetBand: true, ieltsExamDate: true, _count: { select: { enrollments: true } },
              ieltsHistory: true, ieltsOverall: true, ieltsListening: true, ieltsReading: true, ieltsWriting: true, ieltsSpeaking: true, ieltsTestDate: true, ieltsAttempts: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { total, items: rows.map((r) => ({ ...r, student: r.student ? { ...r.student, ielts: ieltsSummary(r.student) } : null })) };
  }

  async studentDetail(studentId: string) {
    const s = await this.prisma.studentProfile.findUnique({
      where: { id: studentId },
      include: {
        user: { select: { id: true, email: true, phone: true, status: true, createdAt: true, lastLoginAt: true } },
        enrollments: { include: { course: { select: { title: true } }, batch: { select: { name: true } } }, orderBy: { createdAt: 'desc' } },
        orders: {
          orderBy: { createdAt: 'desc' }, take: 20,
          select: {
            id: true, reference: true, status: true, total: true, currency: true, createdAt: true,
            payments: { select: { id: true, status: true, provider: true } },
          },
        },
        timeline: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!s) throw notFound('Student');
    return { ...s, ielts: ieltsSummary(s) };
  }

  async setStudentStatus(userId: string, status: 'ACTIVE' | 'SUSPENDED' | 'BLOCKED', actor: Actor) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findFirst({ where: { id: userId, deletedAt: null }, include: { roles: { include: { role: true } } } });
      if (!user) throw notFound('User');
      const names = user.roles.map((r) => r.role.name);
      if (!names.includes('STUDENT') || names.some((n) => (ADMIN_ROLES as readonly string[]).includes(n))) {
        throw new AppError('FORBIDDEN', 403, 'Only student accounts can be changed here.');
      }
      if (user.status === 'PENDING_VERIFICATION' && status === 'ACTIVE') {
        throw new AppError('CONFLICT', 409, 'This student has not verified their email yet.');
      }
      const after = await tx.user.update({ where: { id: userId }, data: { status } });
      if (status !== 'ACTIVE') await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record({ ...actor, action: 'ADMIN_CHANGED_ACCOUNT_STATUS', entityType: 'User', entityId: userId, before: { status: user.status }, after: { status: after.status } }, tx);
      this.ctx.invalidate(userId);
      return { id: userId, status: after.status };
    });
  }

  // ───────── staff & roles ─────────
  listRoles() {
    return this.prisma.role.findMany({
      orderBy: { name: 'asc' },
      include: { permissions: { include: { permission: { select: { key: true } } } }, _count: { select: { users: true } } },
    }).then((rows) => rows.map((r) => ({ id: r.id, name: r.name, description: r.description, users: r._count.users, permissions: r.permissions.map((p) => p.permission.key).sort() })));
  }

  async listStaff() {
    const rows = await this.prisma.user.findMany({
      where: { deletedAt: null, roles: { some: { role: { name: { in: ASSIGNABLE } } } } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, status: true, lastLoginAt: true, mfa: { select: { confirmedAt: true } }, roles: { select: { role: { select: { name: true } } } } },
    });
    return rows.map((u) => ({ id: u.id, email: u.email, status: u.status, lastLoginAt: u.lastLoginAt, mfaEnabled: !!u.mfa?.confirmedAt, roles: u.roles.map((r) => r.role.name) }));
  }

  private assertAssignable(roleNames: string[]) {
    const bad = roleNames.filter((r) => !ASSIGNABLE.includes(r));
    if (bad.length) throw new AppError('VALIDATION_ERROR', 422, 'Some fields are invalid.', { roles: `Unknown or non-assignable roles: ${bad.join(', ')}` });
  }

  /** Invites a staff member: random password + emailed set-password link. */
  async createStaff(input: { email: string; roles: string[] }, actor: Actor) {
    this.assertAssignable(input.roles);
    if (await this.prisma.user.findUnique({ where: { email: input.email } })) throw new AppError('EMAIL_ALREADY_REGISTERED', 409, 'An account with this email already exists.');
    const roles = await this.prisma.role.findMany({ where: { name: { in: input.roles } } });
    const token = randomToken();
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          email: input.email, status: 'ACTIVE', emailVerifiedAt: new Date(),
          passwordHash: await argon2.hash(randomToken(24), { type: argon2.argon2id }),
          roles: { create: roles.map((r) => ({ roleId: r.id })) },
        },
      });
      await tx.passwordResetToken.create({ data: { userId: u.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 7 * 24 * 3600_000) } });
      await this.audit.record({ ...actor, action: 'ADMIN_CREATED_STAFF', entityType: 'User', entityId: u.id, after: { email: u.email, roles: input.roles } }, tx);
      return u;
    });
    const link = `${this.config.APP_URL}/reset-password?token=${token}`;
    await this.mail.send(user.email, 'You have been invited to the IELTS Portal', `<p>Your staff account is ready. Set your password here (valid 7 days):</p><p><a href="${link}">${link}</a></p><p>You will be asked to set up two-factor authentication on first sign-in.</p>`);
    return { id: user.id, email: user.email, roles: input.roles };
  }

  async setRoles(userId: string, roleNames: string[], actor: Actor) {
    this.assertAssignable(roleNames);
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findFirst({ where: { id: userId, deletedAt: null }, include: { roles: { include: { role: true } } } });
      if (!user) throw notFound('User');
      const before = user.roles.map((r) => r.role.name);
      // Keep implicit roles (STUDENT) untouched; only the assignable set is managed here.
      const kept = before.filter((r) => !ASSIGNABLE.includes(r));
      const next = [...new Set([...kept, ...roleNames])];

      if (before.includes('SUPER_ADMIN') && !next.includes('SUPER_ADMIN')) {
        const others = await tx.userRole.count({ where: { role: { name: 'SUPER_ADMIN' }, userId: { not: userId }, user: { status: 'ACTIVE', deletedAt: null } } });
        if (others === 0) throw conflict('CONFLICT', 'You cannot remove the last active Super Admin.');
      }
      const roles = await tx.role.findMany({ where: { name: { in: next } } });
      await tx.userRole.deleteMany({ where: { userId } });
      await tx.userRole.createMany({ data: roles.map((r) => ({ userId, roleId: r.id })) });
      // Privilege changes take effect immediately: kill existing sessions.
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record({ ...actor, action: 'ADMIN_CHANGED_ROLE', entityType: 'User', entityId: userId, before: { roles: before }, after: { roles: next } }, tx);
      this.ctx.invalidate(userId);
      return { id: userId, roles: next };
    });
  }

  // ───────── audit log ─────────
  async auditLogs(q: { entityType?: string; action?: string; userId?: string; before?: string; take: number }) {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(q.entityType ? { entityType: q.entityType } : {}),
        ...(q.action ? { action: q.action } : {}),
        ...(q.userId ? { userId: q.userId } : {}),
        ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: q.take + 1,
      include: { user: { select: { email: true } } },
    });
    const more = rows.length > q.take;
    const items = rows.slice(0, q.take).map((r) => ({
      id: r.id, createdAt: r.createdAt, action: r.action, entityType: r.entityType, entityId: r.entityId,
      actor: r.user?.email ?? null, ip: r.ipAddress, before: r.beforeJson, after: r.afterJson,
    }));
    return { items, nextBefore: more ? items[items.length - 1].createdAt : null };
  }
}
