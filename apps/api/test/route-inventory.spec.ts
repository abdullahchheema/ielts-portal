import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Route inventory. Reads every controller and checks the authorisation each route declares.
 * The global guards require a logged-in user on every route, so this test is about what must be stated explicitly:
 *   - any route under admin/ or mentor/ needs @RequirePermission (or @Public, which is listed below and must be justified)
 *   - any route marked @Public is listed here, so a new public route is a deliberate, reviewed change
 * Ownership of student data (me/ routes) is enforced in the services by scoping every query to the caller's own id.
 */

const SRC = join(__dirname, '..', 'src');
const VERB = /@(Get|Post|Put|Patch|Delete)\(\s*(?:(['"`])([^'"`]*)\2)?\s*\)/;

interface Route { file: string; method: string; path: string; permissioned: boolean; isPublic: boolean }

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return controllerFiles(full);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [full] : [];
  }).filter((f) => readFileSync(f, 'utf8').includes('@Controller('));
}

/** Parses the routes in one file. The authorisation decorators sit on the lines just above or beside the verb decorator. */
export function routesIn(file: string, source: string): Route[] {
  const lines = source.split(/\r?\n/);
  const routes: Route[] = [];
  let base = '';
  lines.forEach((line, i) => {
    const c = line.match(/@Controller\(\s*(?:(['"`])([^'"`]*)\1)?\s*\)/);
    if (c) base = c[2] ?? '';
    const v = line.match(VERB);
    if (!v) return;
    // Decorators for one handler are contiguous: look back until a line that closes the previous handler.
    let start = i;
    while (start > 0 && !/^\s*\}\s*$/.test(lines[start - 1]) && !/^\s*$/.test(lines[start - 1]) && !/^\s*(@Controller|export class|\/\/|\/\*\*|\s*\*)/.test(lines[start - 1])) start--;
    const window = lines.slice(start, i + 1).join('\n') + '\n' + (lines[i + 1] ?? '');
    const path = [base, v[3] ?? ''].filter(Boolean).join('/').replace(/\/+/g, '/');
    routes.push({
      file: relative(SRC, file).replace(/\\/g, '/'),
      method: v[1].toUpperCase(),
      path: path || '/',
      permissioned: /@RequirePermission\(/.test(window),
      isPublic: /@Public\(/.test(window),
    });
  });
  return routes;
}

const ALL: Route[] = controllerFiles(SRC).flatMap((f) => routesIn(f, readFileSync(f, 'utf8')));

describe('route inventory', () => {
  it('finds the routes it is checking', () => {
    expect(ALL.length).toBeGreaterThan(150);
  });

  it('every admin route states the permission it needs', () => {
    const gaps = ALL.filter((r) => r.path.startsWith('admin/') && !r.permissioned && !r.isPublic);
    expect(gaps.map((r) => `${r.method} ${r.path} (${r.file})`)).toEqual([]);
  });

  it('every mentor route states the permission it needs, or is scoped by its service', () => {
    const gaps = ALL.filter((r) => r.path.startsWith('mentor/') && !r.permissioned && !r.isPublic);
    expect(gaps.map((r) => `${r.method} ${r.path} (${r.file})`)).toEqual([]);
  });

  it('public routes are exactly the reviewed list', () => {
    const publicRoutes = ALL.filter((r) => r.isPublic).map((r) => `${r.method} ${r.path}`).sort();
    expect(publicRoutes).toEqual(REVIEWED_PUBLIC.slice().sort());
  });
});

/**
 * Every @Public route, reviewed. Each one is unauthenticated by design: registration, login, the public
 * catalogue and certificate verification.
 */
const REVIEWED_PUBLIC: string[] = [
  // Account entry points: registration, sign-in, password and verification flows, and OAuth.
  'POST auth/register', 'POST auth/login', 'POST auth/logout', 'POST auth/refresh',
  'POST auth/verify-email', 'POST auth/resend-verification', 'POST auth/forgot-password', 'POST auth/reset-password',
  'GET auth/providers', 'GET auth/google/start', 'GET auth/google/callback',
  // The public catalogue and enrolment page.
  'GET public/course', 'GET public/batches', 'GET public/payment-methods',
  // Public certificate verification: status, name, course and date only.
  'GET certificates/:code/verify', 'GET certificates/:code/pdf',
  // Signed, expiring links to stored files (local storage fallback). The signature is checked in the handler.
  'GET files/local',
  // Referral link clicks, rate-limited per IP.
  'POST referrals/click',
  // Liveness probe.
  'GET health',
];
