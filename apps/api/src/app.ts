import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
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
  // Bulk import JSON files can reach ~600 KB; raise the limit to 2 MB.
  app.useBodyParser('json', { limit: '2mb' });
  app.use(helmet());
  app.use(compression());
  app.use(cookieParser());
  app.enableCors({ origin: config.APP_URL, credentials: true });
  app.enableShutdownHooks();
  return { app, config };
}
