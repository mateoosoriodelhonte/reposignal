import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

/**
 * Two projects, because they need different environments:
 *
 * - `node`   — scoring, normalization, and the GitHub client. These are pure
 *              and must never require a DOM to run.
 * - `jsdom`  — React component tests.
 *
 * Playwright specs in `tests/e2e` are run separately by `npm run test:e2e`.
 */
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [tsconfigPaths()],
        test: {
          name: 'node',
          globals: true,
          environment: 'node',
          setupFiles: ['./tests/setup.ts'],
          include: ['tests/{unit,integration}/**/*.test.ts'],
        },
      },
      {
        plugins: [tsconfigPaths(), react()],
        test: {
          name: 'components',
          globals: true,
          environment: 'jsdom',
          setupFiles: ['./tests/setup.dom.ts'],
          include: ['tests/components/**/*.test.tsx'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/index.ts', 'src/lib/store/prisma-*.ts'],
      thresholds: {
        // The scoring and normalization layers are the correctness core of the
        // product, so the bar is set against src/lib rather than the whole app.
        statements: 85,
        branches: 85,
        functions: 85,
        lines: 85,
      },
    },
  },
});
