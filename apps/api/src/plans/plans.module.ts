import { Module } from '@nestjs/common';
import { AssessmentsModule } from '../assessments/assessments.module';
import { FreeTestAdminService } from './free-test-admin.service';
import { FreeTestController } from './free-test.controller';
import { FreeTestService } from './free-test.service';
import {
  AdminFreeTestConfigsController, AdminFreeTestLeadsController, AdminPlansController, AdminStudentPlansController,
  PublicPlansController, StudentPlanController,
} from './plans.controller';
import { PlansService } from './plans.service';
import { AdminPremiumServicesController, StudentPremiumServicesController } from './premium-services.controller';
import { PremiumServicesService } from './premium-services.service';

// EntitlementService lives in the separate, global EntitlementModule (see entitlement.module.ts) —
// not provided here — so modules that depend on it (assessments, writing, speaking...) never need
// to import PlansModule, which would cycle back through AssessmentsModule below.
@Module({
  imports: [AssessmentsModule],
  controllers: [
    PublicPlansController, StudentPlanController, AdminPlansController, AdminStudentPlansController,
    FreeTestController, AdminFreeTestConfigsController, AdminFreeTestLeadsController,
    StudentPremiumServicesController, AdminPremiumServicesController,
  ],
  providers: [PlansService, FreeTestService, FreeTestAdminService, PremiumServicesService],
  exports: [PlansService, FreeTestService],
})
export class PlansModule {}
