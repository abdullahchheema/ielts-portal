import { Controller, Get } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators';
import { forbidden } from '../common/app-error';
import { RiskService } from './risk.service';

/** The student sees their own risk level and the reasons behind it. Copy is written as prompts, not verdicts. */
@Controller('me')
export class StudentRiskController {
  constructor(private readonly risk: RiskService) {}

  @Get('risk')
  async mine(@CurrentUser() u: AuthUser) {
    if (!u.studentId) throw forbidden('Only student accounts have a risk summary.');
    const r = await this.risk.forStudent(u.studentId);
    if (!r) return { level: 'GREEN', reasons: [], positives: [], enrolled: false };
    return { level: r.level, reasons: r.reasons, positives: r.positives, enrolled: true, signals: { attendancePercent: r.signals.attendancePercent, daysSinceAcademicActivity: r.signals.daysSinceAcademicActivity, overdueCount: r.signals.overdueCount, overall: r.signals.overall, target: r.signals.target, gapToTarget: r.signals.gapToTarget } };
  }
}
