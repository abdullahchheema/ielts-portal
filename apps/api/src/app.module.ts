import { AiModule } from './ai/ai.module';
import { JobsModule } from './jobs/jobs.module';
import { QuestionBankModule } from './question-bank/question-bank.module';
import { WritingModule } from './writing/writing.module';
import { SpeakingModule } from './speaking/speaking.module';
import { MockExamsModule } from './mock-exams/mock-exams.service';
import { SimulatorModule } from './simulator/simulator.service';
import { InsightsModule } from './insights/insights.module';
import { StudyPlanModule } from './study-plan/study-plan.module';
import { VocabularyModule } from './vocabulary/vocabulary.service';
import { GrammarModule } from './grammar/grammar.service';
import { EngagementModule } from './engagement/engagement.service';
import { RecordingsModule } from './recordings/recordings.service';
import { StudentLifecycleModule } from './student-lifecycle/lifecycle.controller';
import { FeedbackModule } from './feedback/feedback.controller';
import { LeaderboardModule } from './leaderboards/leaderboard.service';
import { TeacherWorkspaceModule } from './teacher-workspace/teacher-workspace';
import { NotesModule } from './admin-ops/notes';
import { SearchModule } from './admin-ops/search';
import { CommandCenterModule } from './admin-ops/command-center';
import { SupportAssistantModule } from './admin-ops/assistant';
import { TutorModule } from './tutor/tutor';
import { PaymentRiskModule } from './payment-risk/payment-risk.service';
import { ReconciliationModule } from './reconciliation/reconciliation';
import { AnalyticsModule } from './analytics/analytics.module';
import { Controller, Get, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { JwtModule } from '@nestjs/jwt';
import { AdminModule } from './admin/admin.module';
import { AssessmentsModule } from './assessments/assessments.module';
import { GradingModule } from './grading/grading.module';
import { LiveModule } from './live/live.service';
import { ReportsModule } from './reports/reports.service';
import { SupportModule } from './support/support.service';
import { CertificatesModule } from './certificates/certificates.service';
import { LifecycleModule } from './lifecycle/lifecycle.service';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard, CsrfGuard, PermissionsGuard } from './auth/guards';
import { AllExceptionsFilter } from './common/error.filter';
import { Public } from './common/decorators';
import { ConfigModule } from './config/config.module';
import { CoursesModule } from './courses/courses.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { PrismaModule } from './prisma/prisma.module';
import { PrismaService } from './prisma/prisma.service';
import { RolesModule } from './roles/roles.module';
import { BatchesModule } from './batches/batches.module';
import { CommerceModule } from './commerce/commerce.module';
import { LearningModule } from './learning/learning.module';
import { NotificationsModule } from './notifications/notifications.service';
import { SettingsModule } from './settings/settings.module';
import { TeachersModule } from './teachers/teachers.module';

@Controller('health')
class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public() @Get()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  }
}

@Module({
  imports: [
    AnalyticsModule, AiModule, JobsModule, QuestionBankModule, WritingModule, SpeakingModule, MockExamsModule, SimulatorModule, InsightsModule, StudyPlanModule, VocabularyModule, GrammarModule, EngagementModule, RecordingsModule, LeaderboardModule, TeacherWorkspaceModule, NotesModule, SearchModule, CommandCenterModule, SupportAssistantModule, TutorModule, PaymentRiskModule, ReconciliationModule, StudentLifecycleModule, FeedbackModule,
    ConfigModule, PrismaModule, IntegrationsModule, AuditModule, EventEmitterModule.forRoot(), JwtModule.register({}),
    AuthModule, RolesModule, SettingsModule, NotificationsModule, CoursesModule, BatchesModule, CommerceModule, LearningModule, AssessmentsModule, GradingModule, LiveModule, SupportModule, ReportsModule, LifecycleModule, CertificatesModule, AdminModule, TeachersModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Order matters: authenticate → CSRF → permissions.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
