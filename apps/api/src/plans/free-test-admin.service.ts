import { Injectable } from '@nestjs/common';
import { FreeTestConfigInput, UpdateFreeTestConfigInput } from '@ielts/validation';
import { AuditService } from '../audit/audit.service';
import { Actor } from '../courses/courses.service';
import { notFound } from '../common/app-error';
import { PrismaService } from '../prisma/prisma.service';

/** Admin management of the free-test config pool and visibility into leads (conversion funnel). */
@Injectable()
export class FreeTestAdminService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async listConfigs() {
    const configs = await this.prisma.freeTestConfig.findMany({
      orderBy: { sequence: 'asc' },
      include: { assessment: { select: { title: true } }, _count: { select: { leads: true } } },
    });
    return configs.map((c) => ({ id: c.id, name: c.name, assessmentId: c.assessmentId, assessmentTitle: c.assessment.title, sequence: c.sequence, active: c.active, leadCount: c._count.leads }));
  }

  async createConfig(input: FreeTestConfigInput, actor: Actor) {
    const assessment = await this.prisma.assessment.findUnique({ where: { id: input.assessmentId } });
    if (!assessment) throw notFound('Assessment');
    const row = await this.prisma.freeTestConfig.create({ data: { name: input.name, assessmentId: input.assessmentId, sequence: input.sequence } });
    await this.audit.record({ ...actor, action: 'ADMIN_CREATED_FREE_TEST_CONFIG', entityType: 'FreeTestConfig', entityId: row.id, after: { name: row.name, assessmentId: row.assessmentId } });
    return row;
  }

  async updateConfig(id: string, input: UpdateFreeTestConfigInput, actor: Actor) {
    const before = await this.prisma.freeTestConfig.findUnique({ where: { id } });
    if (!before) throw notFound('Free test config');
    const after = await this.prisma.freeTestConfig.update({ where: { id }, data: input });
    await this.audit.record({ ...actor, action: 'ADMIN_UPDATED_FREE_TEST_CONFIG', entityType: 'FreeTestConfig', entityId: id, before: { active: before.active }, after: { active: after.active } });
    return after;
  }

  async listLeads(q: { status?: string; skip: number; take: number }) {
    const where = q.status ? { status: q.status } : {};
    const [rows, total] = await Promise.all([
      this.prisma.freeAssessmentLead.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.take,
        include: { assignedConfig: { select: { name: true } } },
      }),
      this.prisma.freeAssessmentLead.count({ where }),
    ]);
    return {
      total,
      items: rows.map((r) => ({
        id: r.id, email: r.email, phone: r.phone, status: r.status, configName: r.assignedConfig.name,
        createdAt: r.createdAt, linked: !!r.linkedStudentId,
      })),
    };
  }
}
