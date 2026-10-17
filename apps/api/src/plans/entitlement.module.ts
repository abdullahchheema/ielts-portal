import { Global, Module } from '@nestjs/common';
import { EntitlementService } from './entitlement.service';

/**
 * Global and standalone (no imports of its own) so any module can inject EntitlementService without
 * creating a cycle — several modules that need plan checks (assessments, writing, speaking, the
 * question bank) are also depended on by PlansModule itself (e.g. FreeTestService reuses AttemptsService).
 */
@Global()
@Module({ providers: [EntitlementService], exports: [EntitlementService] })
export class EntitlementModule {}
