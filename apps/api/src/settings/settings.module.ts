import { Global, Module } from '@nestjs/common';
import { SettingsController, SettingsService } from './settings.service';

@Global()
@Module({ controllers: [SettingsController], providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
