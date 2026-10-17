import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { DecidePremiumBookingInput, RequestPremiumBookingInput, decidePremiumBookingSchema, requestPremiumBookingSchema } from '@ielts/validation';
import { AuthUser, CurrentUser, RequirePermission, clientMeta } from '../common/decorators';
import { forbidden } from '../common/app-error';
import { ZodPipe } from '../common/zod.pipe';
import { PremiumServicesService } from './premium-services.service';

const uuid = new ParseUUIDPipe();
const actor = (u: AuthUser, req: Request) => ({ userId: u.id, ...clientMeta(req) });

@Controller('me/premium-services')
export class StudentPremiumServicesController {
  constructor(private readonly svc: PremiumServicesService) {}

  @Get()
  list() { return this.svc.listActive(); }

  @Get('bookings')
  myBookings(@CurrentUser() u: AuthUser) {
    if (!u.studentId) throw forbidden();
    return this.svc.myBookings(u.studentId);
  }

  @Post('bookings')
  request(@Body(new ZodPipe(requestPremiumBookingSchema)) body: RequestPremiumBookingInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    if (!u.studentId) throw forbidden();
    return this.svc.requestBooking(u.studentId, body.serviceId, body.notes, actor(u, req));
  }
}

@Controller('admin/premium-services')
export class AdminPremiumServicesController {
  constructor(private readonly svc: PremiumServicesService) {}

  @RequirePermission('premium.service.manage') @Get()
  list() { return this.svc.adminList(); }

  @RequirePermission('premium.service.manage') @Get('bookings')
  bookings(@Query('status') status?: string) { return this.svc.adminListBookings(status); }

  @RequirePermission('premium.service.manage') @HttpCode(200) @Post('bookings/:id/decide')
  decide(@Param('id', uuid) id: string, @Body(new ZodPipe(decidePremiumBookingSchema)) body: DecidePremiumBookingInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.svc.decideBooking(id, body, actor(u, req));
  }
}
