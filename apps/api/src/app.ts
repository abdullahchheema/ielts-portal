import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { loadConfig } from '@ielts/config';
import { AppModule } from './app.module';
import { requestId } from './common/request-id.middleware';

export async function createApp(logger: false | ('log' | 'warn' | 'error')[] = ['log', 'warn', 'error']) {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger });
  app.set('trust proxy', 1);
  app.use(requestId);
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: config.APP_URL, credentials: true });
  app.enableShutdownHooks();
  return { app, config };
}
