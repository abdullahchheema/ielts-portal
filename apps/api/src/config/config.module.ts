import { Global, Module } from '@nestjs/common';
import { AppConfig, loadConfig } from '@ielts/config';

export const APP_CONFIG = 'APP_CONFIG';
export type { AppConfig };

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
