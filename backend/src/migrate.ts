#!/usr/bin/env ts-node
/**
 * migrate.ts — raw SQL migration runner.
 *
 * Applies all numbered SQL files under backend/migrations/ in lexicographic
 * order, skipping any that have already been recorded in the schema_migrations
 * table.  This is a lightweight alternative to Prisma Migrate for plain SQL.
 *
 * Usage:
 *   pnpm --filter backend run migrate         # run pending migrations
 *   pnpm --filter backend run migrate:dry-run # print pending filenames only
 */
import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../.env") });
dotenv.config({ path: path.join(__dirname, "../../../.env") });

const DRY_RUN = process.argv.includes("--dry-run");
const MIGRATIONS_DIR = path.join(__dirname, "../migrations");

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Ensure the tracking table exists (idempotent).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT        PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Collect migration filenames, sorted lexicographically.
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // Determine which migrations have already been applied.
  const { rows } = await pool.query<{ filename: string }>(
    "SELECT filename FROM schema_migrations"
  );
  const applied = new Set(rows.map((r) => r.filename));

  let ran = 0;

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  ✓ ${file} (already applied)`);
      continue;
    }

    if (DRY_RUN) {
      console.log(`  → ${file} (pending)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");

    console.log(`  ▶ Applying ${file}…`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1)",
        [file]
      );
      await client.query("COMMIT");
      console.log(`  ✓ ${file}`);
      ran++;
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }

  if (!DRY_RUN) {
    console.log(`\nMigrations complete. ${ran} applied.`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
