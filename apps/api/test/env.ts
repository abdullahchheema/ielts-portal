import { testDatabaseUrl } from './test-db';

const url = testDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = url;
process.env.DIRECT_URL = url;
// Force in-memory limiter and logged emails so tests never hit Redis or send real mail.
delete process.env.REDIS_URL;
delete process.env.RESEND_API_KEY;
// Admin MFA is covered by its own spec; other specs log in as the seeded admin without a second factor.
process.env.TWO_FACTOR_ENABLED = 'false';
