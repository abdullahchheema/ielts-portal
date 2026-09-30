import { Body, Controller, Get, Global, HttpCode, Injectable, Logger, Module, Post } from '@nestjs/common';
import { Prisma } from '@ielts/db';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { MailService } from '../integrations/mail.service';
import { PrismaService } from '../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

/**
 * Minimal notifications: an in-app row plus (optionally) an email.
 * Best-effort by design — a notification failure must never fail the business operation that triggered it.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService, private readonly mail: MailService) {}

  /** Latest in-app notifications plus the unread count. */
  async feed(userId: string) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({ where: { userId, channel: 'IN_APP' }, orderBy: { createdAt: 'desc' }, take: 30, select: { id: true, type: true, title: true, body: true, readAt: true, createdAt: true } }),
      this.prisma.notification.count({ where: { userId, channel: 'IN_APP', readAt: null } }),
    ]);
    return { unread, items };
  }

  async getPreferences(userId: string) {
    const rows = await this.prisma.notificationPreference.findMany({ where: { userId } });
    return new Map(rows.map((r) => [r.type + ':' + r.channel, r.enabled]));
  }

  async setPreferences(userId: string, prefs: { type: string; inApp: boolean; email: boolean }[]) {
    await this.prisma.$transaction(prefs.flatMap((p) => (['IN_APP', 'EMAIL'] as const).map((channel) =>
      this.prisma.notificationPreference.upsert({
        where: { userId_type_channel: { userId, type: p.type, channel } },
        create: { userId, type: p.type, channel, enabled: channel === 'IN_APP' ? p.inApp : p.email },
        update: { enabled: channel === 'IN_APP' ? p.inApp : p.email },
      }))));
  }

  /** Marks the given notifications (or all, if no ids) read. Only ever touches the caller's own rows. */
  async markRead(userId: string, ids?: string[]) {
    const r = await this.prisma.notification.updateMany({ where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
    return { updated: r.count };
  }

  /**
   * Creates an in-app notification (and optionally an email).
   *  - `dedupeKey`: sending the same key to the same user twice is a no-op (returns false) — reminders rely on this.
   *  - `optional`: the user may switch this type off per channel (essential messages such as payments ignore preferences).
   * Best-effort: never throws into the caller.
   */
  async notifyUser(
    userId: string, type: string, title: string, body?: string,
    opts: { email?: boolean; dedupeKey?: string; optional?: boolean } = {}, db: Db = this.prisma,
  ): Promise<boolean> {
    try {
      let showInApp = true;
      let sendEmail = !!opts.email;
      if (opts.optional) {
        const prefs = await this.prisma.notificationPreference.findMany({ where: { userId, type } });
        const off = (ch: 'IN_APP' | 'EMAIL') => prefs.some((p) => p.channel === ch && !p.enabled);
        showInApp = !off('IN_APP');
        sendEmail = sendEmail && !off('EMAIL');
      }
      if (!showInApp && !sendEmail) return false;
      try {
        // The row doubles as the de-duplication anchor; when in-app is switched off it is stored as an EMAIL-channel record so the bell hides it.
        await db.notification.create({ data: { userId, type, title, body, channel: showInApp ? 'IN_APP' : 'EMAIL', dedupeKey: opts.dedupeKey } });
      } catch (e) {
        if ((e as { code?: string }).code === 'P2002') return false; // already sent
        throw e;
      }
      if (sendEmail) {
        const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
        if (user) await this.mail.send(user.email, title, `<p>${escapeHtml(body ?? title)}</p>`);
      }
      return true;
    } catch (e) {
      this.logger.warn(`notifyUser(${type}) failed: ${(e as Error).message}`);
      return false;
    }
  }

  /** Notify everyone who holds a permission (e.g. finance staff when a payment proof arrives). */
  async notifyPermission(permission: string, type: string, title: string, body?: string) {
    try {
      const users = await this.prisma.user.findMany({
        where: { deletedAt: null, status: 'ACTIVE', roles: { some: { role: { permissions: { some: { permission: { key: permission } } } } } } },
        select: { id: true },
      });
      if (users.length) {
        await this.prisma.notification.createMany({ data: users.map((u) => ({ userId: u.id, type, title, body, channel: 'IN_APP' as const })) });
      }
    } catch (e) {
      this.logger.warn(`notifyPermission(${type}) failed: ${(e as Error).message}`);
    }
  }
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const readSchema = z.object({ ids: z.array(z.string().uuid()).max(100).optional() });

/** Notification types a user may switch off. Payment, enrollment and grading messages are essential and always sent. */
export const OPTIONAL_TYPES = [
  { type: 'CLASS_REMINDER', label: 'Live class reminders' },
  { type: 'DEADLINE_REMINDER', label: 'Assignment deadline reminders' },
  { type: 'EXPIRY_REMINDER', label: 'Course access expiring soon' },
  { type: 'SESSION_SCHEDULED', label: 'New class scheduled' },
] as const;
const prefsSchema = z.object({
  preferences: z.array(z.object({ type: z.enum(OPTIONAL_TYPES.map((t) => t.type) as [string, ...string[]]), inApp: z.boolean(), email: z.boolean() })).max(20),
});

@Controller('me/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  feed(@CurrentUser() u: AuthUser) { return this.notifications.feed(u.id); }

  @Get('preferences')
  async preferences(@CurrentUser() u: AuthUser) {
    const rows = await this.notifications.getPreferences(u.id);
    return OPTIONAL_TYPES.map((t) => ({ ...t, inApp: rows.get(t.type + ':IN_APP') ?? true, email: rows.get(t.type + ':EMAIL') ?? true }));
  }

  @HttpCode(200) @Post('preferences')
  async setPreferences(@Body(new ZodPipe(prefsSchema)) body: z.infer<typeof prefsSchema>, @CurrentUser() u: AuthUser) {
    await this.notifications.setPreferences(u.id, body.preferences);
    return { ok: true };
  }

  @HttpCode(200) @Post('read')
  read(@Body(new ZodPipe(readSchema)) body: { ids?: string[] }, @CurrentUser() u: AuthUser) { return this.notifications.markRead(u.id, body.ids); }
}

@Global()
@Module({ controllers: [NotificationsController], providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
