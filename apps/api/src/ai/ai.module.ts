import { Global, Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiPromptService } from './prompt.service';

@Global()
@Module({
  providers: [AiPromptService, AiService],
  exports: [AiPromptService, AiService],
})
export class AiModule {}
