import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 moved the connection URL out of `schema.prisma`. Migration and
 * introspection commands read it from here; the runtime client gets its
 * connection through a driver adapter instead (see `src/lib/store/prisma.ts`).
 *
 * The datasource is only declared when `DATABASE_URL` is actually set.
 * `prisma generate` needs no database, and RepoSignal runs without one — using
 * Prisma's `env()` helper here would throw in both cases, since it treats a
 * missing variable as fatal rather than absent.
 */
const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  ...(databaseUrl === undefined || databaseUrl === ''
    ? {}
    : { datasource: { url: databaseUrl } }),
});
