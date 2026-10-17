import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { Actor } from '../courses/courses.service';
import { AppError, notFound } from '../common/app-error';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementService } from './entitlement.service';

const SERVICE_TYPES = ['CONSULTANCY', 'SCHOLARSHIP_GUIDANCE', 'CAREER_COUNSELING', 'SPORTS_BENEFIT'] as const;

/** Premium-only coaching services and student booking requests. Availability is gated server-side,
 *  independent of whatever the UI happens to show, so a non-Premium student can never book one. */
@Injectable()
export class PremiumServicesService {
  constructor(
    private readonly prisma: PrismaService, private readonly audit: AuditService,
    private readonly entitlements: EntitlementService, private readonly notify: NotificationsService,
  ) {}

  listActive() {
    return this.prisma.premiumService.findMany({ where: { active: true }, orderBy: { serviceType: 'asc' } });
  }

  adminList() {
    return this.prisma.premiumService.findMany({ orderBy: { serviceType: 'asc' }, include: { _count: { select: { bookings: true } } } });
  }

  async myBookings(studentId: string) {
    return this.prisma.premiumServiceBooking.findMany({ where: { studentId }, orderBy: { createdAt: 'desc' }, include: { service: true } });
  }

  async requestBooking(studentId: string, serviceId: string, notes: string | undefined, actor: Actor) {
    if (!await this.entitlements.can(studentId, 'premium.services')) {
      throw new AppError('PLAN_UPGRADE_REQUIRED', 403, 'Premium services require the Premium plan.');
    }
    const service = await this.prisma.premiumService.findUnique({ where: { id: serviceId } });
    if (!service || !service.active) throw notFound('Premium service');
    const booking = await this.prisma.premiumServiceBooking.create({ data: { serviceId, studentId, notes: notes ?? null } });
    await this.audit.record({ ...actor, action: 'STUDENT_REQUESTED_PREMIUM_SERVICE', entityType: 'PremiumServiceBooking', entityId: booking.id, after: { serviceId, serviceType: service.serviceType } });
    await this.notify.notifyPermission('premium.service.manage', 'PREMIUM_BOOKING_REQUESTED', `New ${service.name} request`, notes, {
      entityType: 'PremiumServiceBooking', entityId: booking.id,
    });
    return booking;
  }

  async adminListBookings(status?: string) {
    return this.prisma.premiumServiceBooking.findMany({
      where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 200,
      include: { service: true, student: { select: { firstName: true, lastName: true, user: { select: { email: true } } } } },
    });
  }

  /** Confirming a booking must have real schedule/delivery details — never "confirmed" with nothing behind it. */
  async decideBooking(id: string, input: { status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED'; scheduledAt?: string; adminNotes?: string }, actor: Actor) {
    const booking = await this.prisma.premiumServiceBooking.findUnique({ where: { id }, include: { student: { select: { userId: true } }, service: true } });
    if (!booking) throw notFound('Booking');
    if (input.status === 'SCHEDULED' && !input.scheduledAt) {
      throw new AppError('VALIDATION_ERROR', 422, 'Some fields are invalid.', { scheduledAt: 'A scheduled time is required to confirm this booking.' });
    }
    const after = await this.prisma.premiumServiceBooking.update({
      where: { id }, data: { status: input.status, scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : booking.scheduledAt, adminNotes: input.adminNotes ?? booking.adminNotes },
    });
    await this.audit.record({ ...actor, action: 'ADMIN_UPDATED_PREMIUM_BOOKING', entityType: 'PremiumServiceBooking', entityId: id, after: { status: input.status } });
    if (input.status === 'SCHEDULED') {
      await this.notify.notifyUser(booking.student.userId, 'PREMIUM_BOOKING_CONFIRMED', `Your ${booking.service.name} session is scheduled`, input.adminNotes, {
        email: true, entityType: 'PremiumServiceBooking', entityId: id,
      });
    }
    return after;
  }
}

export { SERVICE_TYPES };
