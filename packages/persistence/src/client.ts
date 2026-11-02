import pg from 'pg';
import { sql } from 'drizzle-orm';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

const globalDb = globalThis as unknown as { hestiaPool?: pg.Pool };
export const pool = globalDb.hestiaPool ?? new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000,
});
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Run pnpm setup:local.');
globalDb.hestiaPool = pool;
export type Database = NodePgDatabase<typeof schema>;
/** Drizzle over the pool, or over a connection already inside a `transaction()` so both share its state. */
export const orm = (connection: pg.Pool | pg.PoolClient): Database => drizzle(connection, { schema });
export const db: Database = orm(pool);
export const query = pool.query.bind(pool);
/** Transaction-scoped advisory lock on `hashtext(key)`; serialises work that has no row to lock yet. */
export async function advisoryXactLock(tx: Database, key: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
}
/**
 * Drizzle wraps driver errors in DrizzleQueryError (message carries the SQL and bound values). Services and
 * callers match on the Postgres error itself (`code`, `constraint`), so the original error is rethrown.
 */
export function driverError(error: unknown): unknown {
  return error instanceof DrizzleQueryError && error.cause ? error.cause : error;
}
/**
 * One transaction, two views of the same connection: `client` for parameterised SQL (locks, jsonb_set, …)
 * and `tx` for Drizzle queries. Both see the same uncommitted state.
 */
export async function transaction<T>(work: (client: pg.PoolClient, tx: Database) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client, orm(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw driverError(error);
  } finally { client.release(); }
}
