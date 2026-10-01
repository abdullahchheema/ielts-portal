import { join } from 'node:path';
import type { NextConfig } from 'next';

// The browser only talks to this origin: /api/* is handled by src/app/api/[...path]/route.ts, which forwards to the
// backend (the NestJS app in apps/api, embedded in this server on Vercel). Cookies therefore stay first-party.
const config = {
  reactStrictMode: true,
  agentRules: false, // stop Next from generating AGENTS.md / CLAUDE.md in the repo
  // The backend is loaded at runtime from its compiled output instead of being bundled.
  serverExternalPackages: ['@ielts/api', '@ielts/db', '@prisma/client', 'argon2', '@nestjs/core', '@nestjs/common', '@nestjs/platform-express'],
  outputFileTracingRoot: join(__dirname, '../..'),
  outputFileTracingIncludes: {
    '/**': [
      '../api/dist/**',
      '../../packages/*/dist/**',
      '../../node_modules/.prisma/**',
      '../../node_modules/@prisma/client/**',
      '../../node_modules/@prisma/engines/**',
    ],
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    }];
  },
};

export default config as NextConfig;
