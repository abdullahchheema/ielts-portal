import { Inject, Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { AppError } from '../common/app-error';
import { APP_CONFIG, AppConfig } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UserContextService } from '../roles/user-context.service';

authenticator.options = { window: 1, step: 30, digits: 6 }; // tolerate ±30s clock drift

@Injectable()
export class MfaService {
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ctx: UserContextService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    // Derived key; TOTP secrets are stored encrypted, never in plaintext.
    this.key = Buffer.from(hkdfSync('sha256', config.JWT_REFRESH_SECRET, 'ielts-portal', 'mfa-secret-v1', 32));
  }

  private encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
  }

  private decrypt(blob: string): string {
    const raw = Buffer.from(blob, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  }

  async isEnabled(userId: string): Promise<boolean> {
    const row = await this.prisma.mfaSecret.findUnique({ where: { userId } });
    return !!row?.confirmedAt;
  }

  /** Starts (or restarts) enrolment. Refuses to overwrite an already-confirmed authenticator. */
  async setup(userId: string, email: string) {
    if (await this.isEnabled(userId)) throw new AppError('CONFLICT', 409, 'Two-factor authentication is already enabled.');
    const secret = authenticator.generateSecret(20);
    await this.prisma.mfaSecret.upsert({
      where: { userId },
      create: { userId, secretEnc: this.encrypt(secret) },
      update: { secretEnc: this.encrypt(secret), confirmedAt: null },
    });
    return { secret, otpauthUrl: authenticator.keyuri(email, 'IELTS Portal', secret) };
  }

  async confirm(userId: string, code: string, meta: { ip?: string; userAgent?: string }) {
    const row = await this.prisma.mfaSecret.findUnique({ where: { userId } });
    if (!row) throw new AppError('CONFLICT', 409, 'Start two-factor setup first.');
    if (row.confirmedAt) throw new AppError('CONFLICT', 409, 'Two-factor authentication is already enabled.');
    if (!this.check(row.secretEnc, code)) throw new AppError('INVALID_TOKEN', 400, 'That code is not correct. Check your authenticator app and try again.');
    await this.prisma.$transaction(async (tx) => {
      await tx.mfaSecret.update({ where: { userId }, data: { confirmedAt: new Date() } });
      await this.audit.record({ userId, action: 'MFA_ENABLED', entityType: 'User', entityId: userId, ...meta }, tx);
    });
    this.ctx.invalidate(userId);
  }

  /** True if the user has MFA and the code is valid; used by login. */
  async verifyLogin(userId: string, code: string): Promise<boolean> {
    const row = await this.prisma.mfaSecret.findUnique({ where: { userId } });
    return !!row?.confirmedAt && this.check(row.secretEnc, code);
  }

  private check(secretEnc: string, code: string): boolean {
    try {
      return authenticator.check(code, this.decrypt(secretEnc));
    } catch {
      return false;
    }
  }
}
