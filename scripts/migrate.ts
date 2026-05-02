import 'dotenv/config';
import { Pool } from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Hand-rolled migrator. Drizzle's built-in PG migrator unconditionally calls
 * `CREATE SCHEMA IF NOT EXISTS` for its bookkeeping table — our role does not
 * have CREATE on the database itself (only on its owned schema), so that
 * fails. This runner does the same job: read drizzle's `_journal.json`, apply
 * each new migration's SQL inside a transaction, and record the hash in a
 * `__drizzle_migrations` table located inside our app schema.
 */

type JournalEntry = { idx: number; tag: string; when: number; breakpoints: boolean };
type Journal = { version: string; dialect: string; entries: JournalEntry[] };

async function main() {
  const url = process.env.DATABASE_URL;
  const schema = process.env.DATABASE_SCHEMA ?? 'standardization_app';
  if (!url) throw new Error('DATABASE_URL not set');

  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
      [schema],
    );
    if (r.rowCount === 0) {
      throw new Error(
        `Schema "${schema}" not found. Have your DBA create it and grant USAGE+CREATE.`,
      );
    }
    await client.query(`SET search_path TO "${schema}", public`);

    await client.query(
      `CREATE TABLE IF NOT EXISTS "${schema}"."__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL UNIQUE,
        created_at bigint NOT NULL
      )`,
    );

    const journalPath = path.join('drizzle', 'meta', '_journal.json');
    const journal: Journal = JSON.parse(await fs.readFile(journalPath, 'utf8'));

    const applied = new Set<string>(
      (await client.query(`SELECT hash FROM "${schema}"."__drizzle_migrations"`)).rows.map(
        (row: { hash: string }) => row.hash,
      ),
    );

    for (const entry of journal.entries.sort((a, b) => a.idx - b.idx)) {
      const sqlPath = path.join('drizzle', `${entry.tag}.sql`);
      const sqlText = await fs.readFile(sqlPath, 'utf8');
      const hash = crypto.createHash('sha256').update(sqlText).digest('hex');
      if (applied.has(hash)) {
        console.log(`✓ ${entry.tag} (already applied)`);
        continue;
      }
      console.log(`→ ${entry.tag}`);
      const statements = sqlText
        .split(/-->\s*statement-breakpoint/)
        .map((s) => s.trim())
        .filter(Boolean);
      await client.query('BEGIN');
      try {
        for (const stmt of statements) await client.query(stmt);
        await client.query(
          `INSERT INTO "${schema}"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`,
          [hash, entry.when],
        );
        await client.query('COMMIT');
        console.log(`  applied ${statements.length} statements`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
  console.log('Migrations applied.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
