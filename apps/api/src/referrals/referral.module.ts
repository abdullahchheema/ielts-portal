import { Module } from '@nestjs/common';
import { AdminReferralsController, ReferralsController, ReferralsService } from './referrals.service';

@Module({
  controllers: [ReferralsController, AdminReferralsController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralModule {}
