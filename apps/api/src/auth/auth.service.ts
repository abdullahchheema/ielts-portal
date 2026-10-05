import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { LoginInput, RegisterInput } from '@ielts/validation';
import { AppError } from '../common/app-error';
import { APP_CONFIG, AppConfig } from '../config/config.module';
import { MailService } from '../integrations/mail.service';
import { RateLimiter } from '../integrations/rate-limiter.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserContextService } from '../roles/user-context.service';
import { AuditService } from '../audit/audit.service';
import { isAdminRole } from '../common/roles';
import { MfaService } from './mfa.service';
import type { GoogleProfile } from './google';
import { ACCESS_TTL_SEC, ADMIN_REFRESH_TTL_SEC, REFRESH_TTL_SEC, randomToken, sha256 } from './tokens';

export interface Meta { ip?: string; userAgent?: string }
export interface Session { accessToken: string; refreshToken: string; csrfToken: string; refreshTtlSec: number }

const MAX_FAILED_LOGINS = 10;
const LOCK_MINUTES = 15;

@Injectable()
export class AuthService {
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly limiter: RateLimiter,
    private readonly ctxService: UserContextService,
    private readonly audit: AuditService,
    private readonly mfa: MfaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async register(input: RegisterInput, meta: Meta) {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new AppError('EMAIL_ALREADY_REGISTERED', 409, 'An account with this email already exists.');

    const studentRole = await this.prisma.role.findUniqueOrThrow({ where: { name: 'STUDENT' } });
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

    const user = await this.prisma.user
      .create({
        data: {
          email: input.email,
          phone: input.phone,
          passwordHash,
          student: { create: { firstName: input.firstName, lastName: input.lastName } },
          roles: { create: { roleId: studentRole.id } },
        },
      })
      .catch((e) => {
        if (e?.code === 'P2002') throw new AppError('EMAIL_ALREADY_REGISTERED', 409, 'An account with this email already exists.');
        throw e;
      });

    await this.sendVerification(user.id, user.email, input.next);
    await this.audit.record({ userId: user.id, action: 'USER_REGISTERED', entityType: 'User', entityId: user.id, ...meta });
    return { id: user.id, email: user.email };
  }

  async sendVerification(userId: string, email: string, next?: string) {
    const token = randomToken();
    await this.prisma.emailVerificationToken.create({
      data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 24 * 3600_000) },
    });
    const query = new URLSearchParams({ token });
    if (next) query.set('next', next);
    const link = `${this.config.APP_URL}/verify-email?${query.toString()}`;
    await this.mail.send(
      email,
      'Verify your email',
      `<p>Welcome! Confirm your email to activate your account:</p><p><a href="${link}">${link}</a></p><p>This link expires in 24 hours.</p>`,
    );
  }

  async resendVerification(email: string) {
    const user = await this.prisma.user.findFirst({ where: { email, status: 'PENDING_VERIFICATION', deletedAt: null } });
    if (user) await this.sendVerification(user.id, user.email); // always succeeds silently
  }

  async verifyEmail(token: string) {
    const row = await this.prisma.emailVerificationToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.usedAt) throw new AppError('INVALID_TOKEN', 400, 'This verification link is invalid.');
    if (row.expiresAt < new Date()) throw new AppError('TOKEN_EXPIRED', 400, 'This verification link has expired.');
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date(), status: 'ACTIVE' } }),
    ]);
    this.ctxService.invalidate(row.userId);
  }

  async login(input: LoginInput, meta: Meta) {
    const key = `login:${input.email}:${meta.ip ?? 'na'}`;
    const { allowed } = await this.limiter.hit(key, 8, 15 * 60);
    if (!allowed) throw new AppError('TOO_MANY_LOGIN_ATTEMPTS', 429, 'Too many login attempts. Try again in a few minutes.');

    const user = await this.prisma.user.findFirst({ where: { email: input.email, deletedAt: null } });

    // Verify against a dummy hash when the user does not exist so timing does not reveal it.
    if (!user) {
      this.dummyHash ??= argon2.hash('dummy-password-for-timing', { type: argon2.argon2id });
      await argon2.verify(await this.dummyHash, input.password).catch(() => false);
      throw new AppError('INVALID_CREDENTIALS', 401, 'Email or password is incorrect.');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError('ACCOUNT_LOCKED', 403, 'Account temporarily locked. Try again later.');
    }

    const ok = await argon2.verify(user.passwordHash, input.password).catch(() => false);
    if (!ok) {
      const failed = user.failedLogins + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data:
          failed >= MAX_FAILED_LOGINS
            ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }
            : { failedLogins: failed },
      });
      throw new AppError('INVALID_CREDENTIALS', 401, 'Email or password is incorrect.');
    }

    if (user.status === 'PENDING_VERIFICATION') throw new AppError('ACCOUNT_NOT_VERIFIED', 403, 'Please verify your email first.');
    if (user.status !== 'ACTIVE') throw new AppError('ACCOUNT_SUSPENDED', 403, 'This account is not active.');

    // Second factor (if enrolled). Checked after the password so the response does not reveal MFA state to guessers.
    const ctxForMfa = await this.ctxService.get(user.id);
    if (this.config.TWO_FACTOR_ENABLED === 'true' && ctxForMfa?.mfaEnabled) {
      if (!input.mfaCode) throw new AppError('MFA_REQUIRED', 401, 'Enter the 6-digit code from your authenticator app.');
      if (!(await this.mfa.verifyLogin(user.id, input.mfaCode))) {
        throw new AppError('INVALID_CREDENTIALS', 401, 'The authentication code is incorrect.');
      }
    }

    await this.limiter.reset(key);
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });

    const ctx = await this.ctxService.get(user.id);
    const isAdmin = !!ctx && isAdminRole(ctx.roles);
    const session = await this.issueSession(user.id, randomUUID(), meta, isAdmin);
    return { session, user: await this.me(user.id) };
  }

  /** Signs a user in without a password step (used right after they apply for a batch and set their password). */
  /** Signs in the account for a Google-verified email, creating a student account when there is none. */
  async signInWithGoogle(profile: GoogleProfile, meta: Meta): Promise<Session> {
    let user = await this.prisma.user.findFirst({ where: { email: profile.email, deletedAt: null } });
    if (user) {
      if (['SUSPENDED', 'BLOCKED', 'DEACTIVATED'].includes(user.status)) throw new AppError('ACCOUNT_INACTIVE', 403, 'This account is not active. Contact the academy.');
      const ctx = await this.ctxService.get(user.id);
      if (this.config.TWO_FACTOR_ENABLED === 'true' && ctx?.mfaEnabled) {
        throw new AppError('MFA_REQUIRED', 403, 'This account uses two-step verification. Log in with your password and authenticator code.');
      }
      if (!user.emailVerifiedAt || user.status === 'PENDING_VERIFICATION') {
        user = await this.prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date(), status: 'ACTIVE' } });
      }
    } else {
      const studentRole = await this.prisma.role.findUniqueOrThrow({ where: { name: 'STUDENT' } });
      user = await this.prisma.user.create({
        data: {
          email: profile.email, passwordHash: await argon2.hash(randomToken(32), { type: argon2.argon2id }), status: 'ACTIVE', emailVerifiedAt: new Date(),
          roles: { create: { roleId: studentRole.id } },
          student: { create: { firstName: profile.firstName || profile.email.split('@')[0], lastName: profile.lastName } },
        },
      });
      await this.audit.record({ userId: user.id, action: 'USER_REGISTERED', entityType: 'User', entityId: user.id, after: { via: 'google' }, ...meta });
    }
    return this.startSession(user.id, meta);
  }

  async startSession(userId: string, meta: Meta): Promise<Session> {
    const ctx = await this.ctxService.get(userId);
    return this.issueSession(userId, randomUUID(), meta, !!ctx && isAdminRole(ctx.roles));
  }

  private async issueSession(userId: string, familyId: string, meta: Meta, isAdmin: boolean): Promise<Session> {
    const refreshToken = randomToken(48);
    const refreshTtlSec = isAdmin ? ADMIN_REFRESH_TTL_SEC : REFRESH_TTL_SEC;
    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + refreshTtlSec * 1000),
        userAgent: meta.userAgent,
        ip: meta.ip,
      },
    });
    const accessToken = await this.jwt.signAsync({ sub: userId }, { secret: this.config.JWT_ACCESS_SECRET, expiresIn: ACCESS_TTL_SEC });
    return { accessToken, refreshToken, csrfToken: randomToken(24), refreshTtlSec };
  }

  async refresh(rawToken: string | undefined, meta: Meta): Promise<Session> {
    if (!rawToken) throw new AppError('SESSION_EXPIRED', 401, 'Please log in again.');
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
    if (!row) throw new AppError('SESSION_EXPIRED', 401, 'Please log in again.');

    if (row.revokedAt) {
      // A rotated token was presented again: assume theft and revoke the whole family.
      await this.prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new AppError('SESSION_EXPIRED', 401, 'Session no longer valid. Please log in again.');
    }
    if (row.expiresAt < new Date()) throw new AppError('SESSION_EXPIRED', 401, 'Please log in again.');

    const ctx = await this.ctxService.get(row.userId);
    if (!ctx || ctx.status !== 'ACTIVE') throw new AppError('SESSION_EXPIRED', 401, 'Please log in again.');

    // Compare-and-swap so two concurrent refreshes cannot both succeed.
    const claimed = await this.prisma.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (claimed.count === 0) throw new AppError('SESSION_EXPIRED', 401, 'Please log in again.');

    const isAdmin = isAdminRole(ctx.roles);
    const session = await this.issueSession(row.userId, row.familyId, meta, isAdmin);
    const next = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(session.refreshToken) } });
    await this.prisma.refreshToken.update({ where: { id: row.id }, data: { replacedBy: next?.id } });
    return session;
  }

  async logout(rawToken: string | undefined) {
    if (!rawToken) return;
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
    if (row) {
      await this.prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findFirst({
      where: { email, deletedAt: null, status: { in: ['ACTIVE', 'PENDING_VERIFICATION'] } },
    });
    if (!user) return; // never reveal whether the email exists
    const token = randomToken();
    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600_000) },
    });
    const link = `${this.config.APP_URL}/reset-password?token=${token}`;
    await this.mail.send(
      user.email,
      'Reset your password',
      `<p>Use this link to choose a new password (valid for 1 hour):</p><p><a href="${link}">${link}</a></p><p>If you did not ask for this, ignore this email.</p>`,
    );
  }

  async resetPassword(token: string, password: string) {
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.usedAt) throw new AppError('INVALID_TOKEN', 400, 'This reset link is invalid.');
    if (row.expiresAt < new Date()) throw new AppError('TOKEN_EXPIRED', 400, 'This reset link has expired.');
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({ where: { id: row.userId }, data: { passwordHash, failedLogins: 0, lockedUntil: null } }),
      this.prisma.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  }

  async me(userId: string) {
    const ctx = await this.ctxService.get(userId);
    if (!ctx) throw new AppError('UNAUTHENTICATED', 401, 'Authentication required.');
    return {
      id: ctx.id,
      email: ctx.email,
      roles: ctx.roles,
      permissions: [...ctx.permissions],
      studentId: ctx.studentId,
      mentorId: ctx.mentorId,
      mfaEnabled: ctx.mfaEnabled,
      twoFactorEnabled: this.config.TWO_FACTOR_ENABLED === 'true',
      mfaSetupRequired: this.config.TWO_FACTOR_ENABLED === 'true' && isAdminRole(ctx.roles) && !ctx.mfaEnabled,
      isOwner: !!this.config.OWNER_EMAIL && ctx.email.toLowerCase() === this.config.OWNER_EMAIL,
    };
  }
}
