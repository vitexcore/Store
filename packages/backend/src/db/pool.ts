/**
 * PostgreSQL connection pool.
 *
 * Security notes:
 *  - Connection string is read from config only, never from request context.
 *  - All queries MUST use parameterized form ($1, $2 …). Never concatenate user input.
 *  - The DB user should have only the minimum required permissions (see migrations/README).
 *  - SSL is enabled when DB_SSL=true (required for any non-local deployment).
 */

import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: config.db.url,
      max: config.db.poolMax,
      ssl: config.db.ssl ? { rejectUnauthorized: true } : false,
      // Abort idle clients after 30 s to avoid connection exhaustion
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    _pool.on('error', (err) => {
      // Log but do not crash — the pool will reconnect
      console.error('[db] idle client error:', err.message);
    });
  }

  return _pool;
}

/** Run a query using a parameterized statement. Never accept raw user input as SQL text. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(sql, params);
}

/** Check whether the database is reachable. Returns 'ok' or 'error'. */
export async function checkDatabaseHealth(): Promise<'ok' | 'error'> {
  try {
    await query('SELECT 1');
    return 'ok';
  } catch {
    return 'error';
  }
}

/** Close the pool — used in tests and graceful shutdown. */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
