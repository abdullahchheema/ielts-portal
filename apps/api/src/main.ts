import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Load the repo-root .env for local development (real environments inject env vars).
for (const p of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (existsSync(p)) {
    process.loadEnvFile(p);
    break;
  }
}

async function bootstrap() {
  const { createApp } = await import('./app');
  const { app, config } = await createApp();
  await app.listen(config.PORT);
  console.log(`API listening on http://localhost:${config.PORT}`);
}

bootstrap();
