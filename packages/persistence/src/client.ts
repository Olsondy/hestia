import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

const globalDb = globalThis as unknown as { hestiaPool?: pg.Pool };
export const pool = globalDb.hestiaPool ?? new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000,
});
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Run pnpm setup:local.');
globalDb.hestiaPool = pool;
export const db = drizzle(pool);
export const query = pool.query.bind(pool);
export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
