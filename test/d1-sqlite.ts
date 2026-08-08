import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Minimal in-memory D1 shim over node:sqlite for the test harness.
// It implements exactly the surface drizzle-orm/d1's session touches:
//   client.prepare(sql) -> { bind(...params) -> { all(), run(), raw() } }
//   client.batch(boundStmts), client.exec(sql), client.dump()
// See node_modules/.../drizzle-orm/d1/session.js (D1PreparedQuery.run/all/values,
// SQLiteD1Session.batch). Anything drizzle does not call is left unimplemented.

// node:sqlite rejects booleans and number[] as bind params, so coerce:
// - number[] / ArrayBuffer -> Uint8Array (BLOB round-trip: jobs.commit_sha is
//   written as Array.from(hexToBytes(...)) and read back as Uint8Array).
// - boolean -> 1/0, undefined -> null. Everything else passes through.
/**
 * Coerces parameters for the node:sqlite in-memory D1 shim, ensuring types like boolean and number arrays translate to SQLite equivalents.
 */
function coerceParam(param: unknown): unknown {
  if (param === undefined) return null;
  if (typeof param === 'boolean') return param ? 1 : 0;
  if (Array.isArray(param)) return Uint8Array.from(param as number[]);
  if (param instanceof ArrayBuffer) return new Uint8Array(param);
  return param;
}

/**
 * Creates an in-memory D1 shim using node:sqlite, applying local database migrations for tests.
 */
export function createD1(migrationsDir: string): D1Database {
  const db = new DatabaseSync(':memory:');

  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  db.exec(`
    CREATE TABLE IF NOT EXISTS d1_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )
  `);
  for (const file of files) {
    const sqlText = readFileSync(path.join(migrationsDir, file), 'utf8');
    for (const statement of sqlText.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) db.exec(trimmed);
    }
    const tag = file.replace(/\.sql$/, '');
    db.prepare('INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)').run(tag);
  }

  /**
   * Prepares an SQL statement within the in-memory D1 shim.
   */
  function prepare(sql: string) {
    // node:sqlite reuses one StatementSync; drizzle reuses the prepared stmt
    // across all()/raw() calls, so toggle the return mode per call.
    const stmt = db.prepare(sql);

    /**
     * Binds parameters to a prepared SQL statement in the in-memory D1 shim.
     */
    function bind(...params: unknown[]) {
      const bound = params.map(coerceParam) as any[];
      return {
        async all() {
          stmt.setReturnArrays(false);
          return { results: stmt.all(...bound), success: true, meta: {} };
        },
        async first<T = unknown>() {
          stmt.setReturnArrays(false);
          return (stmt.get(...bound) ?? null) as T | null;
        },
        async run() {
          const result = stmt.run(...bound);
          return {
            success: true,
            results: [],
            meta: {
              changes: Number(result.changes),
              last_row_id: Number(result.lastInsertRowid),
            },
          };
        },
        async raw() {
          stmt.setReturnArrays(true);
          const rows = stmt.all(...bound);
          stmt.setReturnArrays(false);
          return rows;
        },
      };
    }

    return { bind, first: async () => {
      stmt.setReturnArrays(false);
      return stmt.get() ?? null;
    } };
  }

  return {
    prepare: prepare as any,
    async batch(statements: any[]) {
      const results = [];
      for (const statement of statements) {
        results.push(await statement.all());
      }
      return results;
    },
    async exec(sql: string) {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
    dump() {
      throw new Error('D1 dump() is not supported by the node:sqlite test shim');
    },
  } as unknown as D1Database;
}
