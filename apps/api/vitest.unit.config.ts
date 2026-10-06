import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/** Pure-logic specs only: no database, no network. Fast enough to run on every push. */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: { include: ['test/grading.spec.ts', 'test/release.spec.ts', 'test/band.spec.ts', 'test/risk.spec.ts', 'test/csv.spec.ts', 'test/content.spec.ts', 'test/platform.spec.ts', 'test/rules.spec.ts', 'test/ai-rules.spec.ts', 'test/insights-rules.spec.ts', 'test/engagement-rules.spec.ts', 'test/teacher-rules.spec.ts', 'test/admin-ops-rules.spec.ts', 'test/finance-rules.spec.ts', 'test/lifecycle-rules.spec.ts', 'test/nps-rules.spec.ts', 'test/route-inventory.spec.ts'] },
});
