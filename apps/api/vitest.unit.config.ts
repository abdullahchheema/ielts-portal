import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/** Pure-logic specs only: no database, no network. Fast enough to run on every push. */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: { include: ['test/grading.spec.ts', 'test/release.spec.ts', 'test/pathway.spec.ts'] },
});
