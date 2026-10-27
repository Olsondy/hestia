import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pool, transaction } from '../packages/persistence/src/client';
const directory = new URL('../packages/persistence/migrations/', import.meta.url);
try {
  await transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('hestia:migrations'))");
    await client.query('CREATE TABLE IF NOT EXISTS hestia_migrations (name text PRIMARY KEY, hash text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of (await readdir(directory)).filter(n => n.endsWith('.sql')).sort()) {
      const sql = (await readFile(new URL(name, directory), 'utf8')).replace(/\r\n/g, '\n');
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
  });
} finally { await pool.end(); }
