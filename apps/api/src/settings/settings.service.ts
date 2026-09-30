import { Controller, Get, Injectable, Put, Body, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Prisma } from '@ielts/db';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

/** One way a student can pay. Shown on the enrollment form; the admin decides which are enabled. */
export const paymentMethodSchema = z.object({
  method: z.enum(['BANK_TRANSFER', 'JAZZCASH', 'EASYPAISA', 'OTHER']),
  enabled: z.boolean(),
  accountTitle: z.string().trim().max(120).default(''),
  accountNumber: z.string().trim().max(60).default(''),
  bankName: z.string().trim().max(120).default(''),
  iban: z.string().trim().max(60).default(''),
  instructions: z.string().trim().max(1000).default(''),
});
export type PaymentMethodSetting = z.infer<typeof paymentMethodSchema>;

const paymentMethodsSchema = z.array(paymentMethodSchema).max(4).refine((l) => new Set(l.map((m) => m.method)).size === l.length, 'Each method can appear once.');

/** Whitelisted, validated settings. Anything not listed here cannot be written through the API. */
export const SETTING_SCHEMAS = {
  'payment.methods': paymentMethodsSchema,
  'commerce.currency': z.string().length(3).toUpperCase(),
  'commerce.refund_window_days': z.number().int().min(0).max(365),
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMAS;

const DEFAULTS: Record<SettingKey, unknown> = {
  'payment.methods': [
    { method: 'BANK_TRANSFER', enabled: true, accountTitle: '', accountNumber: '', bankName: '', iban: '', instructions: '' },
    { method: 'JAZZCASH', enabled: true, accountTitle: '', accountNumber: '', bankName: '', iban: '', instructions: '' },
    { method: 'EASYPAISA', enabled: true, accountTitle: '', accountNumber: '', bankName: '', iban: '', instructions: '' },
  ],
  'commerce.currency': 'PKR',
  'commerce.refund_window_days': 7,
};

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async get<T = unknown>(key: SettingKey, db: PrismaService | Prisma.TransactionClient = this.prisma): Promise<T> {
    const row = await db.setting.findUnique({ where: { key } });
    return (row?.value ?? DEFAULTS[key]) as T;
  }

  async all() {
    const rows = await this.prisma.setting.findMany();
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return Object.fromEntries((Object.keys(SETTING_SCHEMAS) as SettingKey[]).map((k) => [k, map.get(k) ?? DEFAULTS[k]]));
  }

  async update(patch: Record<string, unknown>, actor: { userId: string; ip?: string; userAgent?: string }) {
    const before = await this.all();
    await this.prisma.$transaction(async (tx) => {
      for (const [key, value] of Object.entries(patch)) {
        await tx.setting.upsert({ where: { key }, update: { value: value as Prisma.InputJsonValue }, create: { key, value: value as Prisma.InputJsonValue } });
      }
      await this.audit.record({ ...actor, action: 'ADMIN_CHANGED_SETTINGS', entityType: 'Setting', before: this.pick(before, patch), after: patch }, tx);
    });
    return this.all();
  }

  private pick(src: Record<string, unknown>, patch: Record<string, unknown>) {
    return Object.fromEntries(Object.keys(patch).map((k) => [k, src[k]]));
  }
}

const patchSchema = z
  .object({
    'payment.methods': SETTING_SCHEMAS['payment.methods'].optional(),
    'commerce.currency': SETTING_SCHEMAS['commerce.currency'].optional(),
    'commerce.refund_window_days': SETTING_SCHEMAS['commerce.refund_window_days'].optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Provide at least one setting.');

@Controller('admin/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @RequirePermission('settings.edit') @Get()
  all() { return this.settings.all(); }

  @RequirePermission('settings.edit') @Put()
  update(@Body(new ZodPipe(patchSchema)) body: Record<string, unknown>, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.settings.update(body, { userId: u.id, ...clientMeta(req) });
  }
}
