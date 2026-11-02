import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { pool } from '../packages/persistence/src/client';

// Two stages on one connection under one session lock:
// 1. the frozen legacy SQL chain (0001–0029), tracked in hestia_migrations;
// 2. drizzle-kit migrations generated from packages/persistence/src/schema, tracked in drizzle.__drizzle_migrations.
// The drizzle baseline (0000) is a no-op whose snapshot describes the state the legacy chain leaves behind.
const legacyDirectory = new URL('../packages/persistence/migrations/', import.meta.url);
const drizzleDirectory = fileURLToPath(new URL('../packages/persistence/drizzle/', import.meta.url));
const LAST_LEGACY_MIGRATION = '0029-request-preferences.sql';

const client = await pool.connect();
try {
  await client.query("SELECT pg_advisory_lock(hashtext('hestia:migrations'))");
  const names = (await readdir(legacyDirectory)).filter(n => n.endsWith('.sql')).sort();
  const late = names.filter(name => name > LAST_LEGACY_MIGRATION);
  if (late.length) throw new Error(`Legacy SQL migrations are frozen; add schema changes in packages/persistence/src/schema and run pnpm db:generate. Unexpected: ${late.join(', ')}`);
  await client.query('BEGIN');
  try {
    await client.query('CREATE TABLE IF NOT EXISTS hestia_migrations (name text PRIMARY KEY, hash text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of names) {
      const sql = (await readFile(new URL(name, legacyDirectory), 'utf8')).replace(/\r\n/g, '\n');
      const hash = createHash('sha256').update(sql).digest('hex');
      const legacyWindowsHash = createHash('sha256').update(sql.replace(/\n/g, '\r\n')).digest('hex');
      const previous = await client.query('SELECT hash FROM hestia_migrations WHERE name=$1', [name]);
      if (previous.rowCount) {
        if (![hash, legacyWindowsHash].includes(previous.rows[0].hash)) throw new Error(`Applied migration changed: ${name}`);
        // Normalize only line-ending-equivalent hashes from earlier local runs; changed SQL is still rejected.
        if (previous.rows[0].hash !== hash) await client.query('UPDATE hestia_migrations SET hash=$2 WHERE name=$1', [name, hash]);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO hestia_migrations(name,hash) VALUES($1,$2)', [name, hash]);
      console.log(`Applied ${name}`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  await migrate(drizzle(client), { migrationsFolder: drizzleDirectory });
  console.log('Drizzle migrations up to date');
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('hestia:migrations'))").catch(() => undefined);
  client.release();
  await pool.end();
}
