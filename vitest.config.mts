import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Two projects, because they need different environments:
 *
 * - `node`       — scoring, normalization, and the GitHub client. These are
 *                  pure and must never require a DOM to run.
 * - `components` — React component tests, under jsdom.
 *
 * Playwright specs in `tests/e2e` are run separately by `npm run test:e2e`.
 *
 * The `.mts` extension is deliberate: it lets Vite load this config as real
 * ESM instead of transpiling it as CommonJS.
 */
export default defineConfig({
  // Resolves the `@/*` alias from tsconfig.json natively, which is why
  // vite-tsconfig-paths is not a dependency of this project.
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: 'node',
          globals: true,
          environment: 'node',
          setupFiles: ['./tests/setup.ts'],
          include: ['tests/{unit,integration}/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        resolve: { tsconfigPaths: true },
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
