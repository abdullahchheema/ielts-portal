import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { forbidden } from '../common/app-error';
import { AuthUser, clientMeta, CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AlumniService } from './alumni.service';
import { LifecycleStageService } from './lifecycle.service';
import { LIFECYCLE_STAGES } from './lifecycle-rules';
import { SettingsService } from '../settings/settings.service';

const uuid = new ParseUUIDPipe();
const sid = (u: AuthUser) => { if (!u.studentId) throw forbidden(); return u.studentId; };

const transitionSchema = z.object({
  to: z.enum(LIFECYCLE_STAGES),
  reason: z.string().trim().min(3).max(300),
});

@Controller('me/lifecycle')
export class StudentLifecycleController {
  constructor(private readonly lifecycle: LifecycleStageService, private readonly alumni: AlumniService, private readonly settings: SettingsService) {}

  /** The student's own stage. Used by the portal to decide whether to show the alumni area. */
  @Get()
  async mine(@CurrentUser() u: AuthUser) {
    const studentId = sid(u);
    const tl = await this.lifecycle.timeline(studentId);
    const access = await this.settings.get<{ enabled: boolean }>('alumni.access');
    return { stage: tl.stage, since: tl.since, alumniAccess: access.enabled && tl.stage === 'ALUMNI' };
  }
}

@Controller('admin/students/:id/lifecycle')
export class LifecycleAdminController {
  constructor(private readonly lifecycle: LifecycleStageService) {}

  @RequirePermission('student.view') @Get()
  timeline(@Param('id', uuid) id: string) { return this.lifecycle.timeline(id); }

  @RequirePermission('lifecycle.manage') @HttpCode(200) @Post()
  transition(@Param('id', uuid) id: string, @Body(new ZodPipe(transitionSchema)) body: z.infer<typeof transitionSchema>, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.lifecycle.transitionByStaff(id, body.to, body.reason, { userId: u.id, ...clientMeta(req) });
  }
}

@Controller('alumni')
export class AlumniController {
  constructor(private readonly alumni: AlumniService) {}

  @Get('home')
  home(@CurrentUser() u: AuthUser) { return this.alumni.home(sid(u)); }
}

@Module({
  controllers: [StudentLifecycleController, LifecycleAdminController, AlumniController],
  providers: [LifecycleStageService, AlumniService],
  exports: [LifecycleStageService, AlumniService],
})
export class StudentLifecycleModule {}
