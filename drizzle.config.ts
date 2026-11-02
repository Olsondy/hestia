import { defineConfig } from 'drizzle-kit';

// Schema source of truth is TypeScript; `pnpm db:generate` diffs it against the last snapshot in
// packages/persistence/drizzle. The legacy SQL chain in packages/persistence/migrations is frozen.
export default defineConfig({
  dialect: 'postgresql',
  schema: './packages/persistence/src/schema/index.ts',
  out: './packages/persistence/drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
