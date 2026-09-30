import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminCommerceController, ApplicationsController, PublicController } from './commerce.controller';
import { ApplicationsService } from './applications.service';
import { CouponsController, CouponsService } from './coupons.service';
import { EnrollmentsService } from './enrollments.service';
import { AdminRefundsController, StudentRefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';

@Module({
  imports: [AuthModule],
  controllers: [PublicController, ApplicationsController, AdminCommerceController, CouponsController, StudentRefundsController, AdminRefundsController],
  providers: [ApplicationsService, CouponsService, EnrollmentsService, RefundsService],
  exports: [ApplicationsService, EnrollmentsService],
})
export class CommerceModule {}
