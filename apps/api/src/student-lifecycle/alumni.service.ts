import { Injectable } from '@nestjs/common';
import { forbidden } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { isAlumniStage } from './lifecycle-rules';

/**
 * The alumni area: certificates, final results and the alumni revision library. It is open only to students whose
 * lifecycle stage is ALUMNI, and only while the academy has not switched it off (setting alumni.access).
 * Live classes need no extra block: alumni have no active enrolment, so the batch checks already hide them.
 */
@Injectable()
export class AlumniService {
  constructor(private readonly prisma: PrismaService, private readonly settings: SettingsService) {}

  async assertAlumni(studentId: string) {
    const access = await this.settings.get<{ enabled: boolean }>('alumni.access');
    const cur = await this.prisma.studentLifecycle.findUnique({ where: { studentId }, select: { stage: true } });
    if (!access.enabled || !isAlumniStage(cur?.stage)) {
      throw forbidden('The alumni area opens once your course is complete and your certificate is issued.');
    }
  }

  async home(studentId: string) {
    await this.assertAlumni(studentId);
    const [student, certificates, completed, recordings] = await Promise.all([
      this.prisma.studentProfile.findUnique({ where: { id: studentId }, select: { firstName: true } }),
      this.prisma.certificate.findMany({
        where: { studentId }, orderBy: { issuedAt: 'desc' },
        select: { code: true, certificateNumber: true, courseTitle: true, batchName: true, issuedAt: true, revocation: { select: { id: true } } },
      }),
      this.prisma.enrollment.findMany({
        where: { studentId, status: 'COMPLETED', deletedAt: null }, orderBy: { completedAt: 'desc' },
        select: { completedAt: true, progressPercent: true, course: { select: { title: true } }, batch: { select: { name: true } } },
      }),
      this.prisma.classRecording.findMany({
        where: { status: 'READY', availability: 'ALUMNI' }, orderBy: { createdAt: 'desc' }, take: 100,
        select: {
          id: true, durationSec: true, createdAt: true,
          session: { select: { topic: true, title: true, startsAt: true } },
          views: { where: { studentId }, select: { positionSec: true, completedAt: true }, take: 1 },
        },
      }),
    ]);
    return {
      firstName: student?.firstName ?? '',
      certificates: certificates.map((c) => ({
        code: c.code, certificateNumber: c.certificateNumber, courseTitle: c.courseTitle, batchName: c.batchName, issuedAt: c.issuedAt,
        valid: !c.revocation, revoked: !!c.revocation,
      })),
      completedCourses: completed.map((e) => ({ title: e.course.title, batchName: e.batch.name, completedAt: e.completedAt, progressPercent: e.progressPercent })),
      recordings: recordings.map(({ views, ...r }) => ({
        ...r, progress: views[0] ? { positionSec: views[0].positionSec, completed: !!views[0].completedAt } : null,
      })),
    };
  }
}
