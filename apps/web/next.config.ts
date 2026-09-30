import type { NextConfig } from 'next';

// The browser only ever talks to this origin; /api/* is proxied to the Nest API so auth cookies stay first-party.
const API_URL = process.env.API_URL ?? 'http://localhost:4000';

const config = {
  reactStrictMode: true,
  agentRules: false, // stop Next from generating AGENTS.md / CLAUDE.md in the repo
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/:path*` }];
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
