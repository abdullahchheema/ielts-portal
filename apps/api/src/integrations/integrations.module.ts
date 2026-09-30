import { Global, Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { MailService } from './mail.service';
import { RateLimiter } from './rate-limiter.service';
import { StorageService } from './storage.service';

@Global()
@Module({
  controllers: [FilesController],
  providers: [MailService, RateLimiter, StorageService],
  exports: [MailService, RateLimiter, StorageService],
})
export class IntegrationsModule {}
