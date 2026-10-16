/**
 * Simple file-based migration runner.
 *
 * Migrations live in src/db/migrations/ and are numbered sequentially:
 *   0001_create_stores.sql
 *   0002_create_users.sql
 *   …
 *
 * Usage:
 *   pnpm db:migrate          # apply pending migrations
 *   pnpm db:migrate:rollback  # roll back the last batch (requires .down.sql files)
 *
 * Security notes:
 *  - Migration scripts are embedded in the source tree and never accepted from user input.
 *  - The migration user may need elevated permissions (CREATE TABLE, etc.).
 *    In production, use a separate migration role distinct from the runtime role.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Use a direct pool for migrations (may need elevated permissions)
function getMigrationPool(): pg.Pool {
  return new pg.Pool({
    connectionString: config.db.url,
    ssl: config.db.ssl ? { rejectUnauthorized: true } : false,
    max: 1,
  });
}

async function ensureMigrationsTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          SERIAL PRIMARY KEY,
      name        TEXT        NOT NULL UNIQUE,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getApplied(client: pg.PoolClient): Promise<Set<string>> {
  const result = await client.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
  return new Set(result.rows.map((r) => r.name));
}

async function applyMigration(client: pg.PoolClient, name: string, sql: string): Promise<void> {
  console.log(`  → applying ${name}`);
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function migrate(): Promise<void> {
  const pool = getMigrationPool();
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);
    const applied = await getApplied(client);

    let files: string[];
    try {
      files = (await fs.readdir(MIGRATIONS_DIR))
        .filter((f) => f.endsWith('.up.sql'))
        .sort();
    } catch {
      console.log('No migrations directory found — skipping.');
      return;
    }

    let count = 0;
    for (const file of files) {
      if (!applied.has(file)) {
        const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf-8');
        await applyMigration(client, file, sql);
        count++;
      }
    }

    console.log(`Migrations complete. ${count} applied.`);
  } finally {
    client.release();
    await pool.end();
  }
}

async function rollback(): Promise<void> {
  const pool = getMigrationPool();
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);
    const result = await client.query<{ name: string }>(
      'SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1',
    );
    if (result.rows.length === 0) {
      console.log('Nothing to roll back.');
      return;
    }
    const lastName = result.rows[0]?.name;
    if (!lastName) return;

    // Derive the down filename: 0001_foo.up.sql → 0001_foo.down.sql
    const downFile = lastName.replace('.up.sql', '.down.sql');
    const downPath = path.join(MIGRATIONS_DIR, downFile);

    let downSql: string;
    try {
      downSql = await fs.readFile(downPath, 'utf-8');
    } catch {
      throw new Error(`Cannot roll back: missing ${downFile}`);
    }

    console.log(`  ← rolling back ${lastName}`);
    await client.query('BEGIN');
    try {
      await client.query(downSql);
      await client.query('DELETE FROM schema_migrations WHERE name = $1', [lastName]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

    console.log('Rollback complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

// CLI entry point
const direction = process.argv[2] ?? 'up';
if (direction === 'up') {
  migrate().catch((err) => { console.error('Migration failed:', err.message); process.exit(1); });
} else if (direction === 'down') {
  rollback().catch((err) => { console.error('Rollback failed:', err.message); process.exit(1); });
} else {
  console.error('Usage: migrate.ts [up|down]');
  process.exit(1);
}
