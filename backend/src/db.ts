/**
 * db.ts — shared pg.Pool instance for the backend.
 *
 * Import `db` everywhere you need to run a query.  The pool is lazy — it only
 * connects when a query is first issued, so importing this module at startup
 * doesn't require DATABASE_URL to be set (useful in test environments that mock
 * the pool).
 */
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Reasonable defaults for a small API server
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});
