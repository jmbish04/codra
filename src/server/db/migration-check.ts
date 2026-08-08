import journal from '../../../db/migrations/d1/meta/_journal.json';

/** Latest D1 migration tag shipped with this Worker build (from drizzle journal). */
export const EXPECTED_LATEST_D1_MIGRATION =
  journal.entries[journal.entries.length - 1]!.tag;

export class PendingD1MigrationError extends Error {
  readonly name = 'PendingD1MigrationError';

  constructor(
    public readonly applied: string | null,
    public readonly expected: string,
  ) {
    super(
      applied
        ? `Remote D1 schema is behind deployed code (applied: ${applied}, expected: ${expected}). Run: npm run migrate:remote`
        : `Remote D1 has no migrations applied; deployed code expects ${expected}. Run: npm run migrate:remote`,
    );
  }
}

/**
 * Fail fast when remote D1 migrations lag the code bundle. Compares the latest
 * row in wrangler's d1_migrations table to the drizzle journal baked into the
 * build — cheap, one query, no per-insert column probes.
 */
export async function assertD1MigrationsCurrent(env: Pick<Env, 'DB'>): Promise<void> {
  const expected = EXPECTED_LATEST_D1_MIGRATION;
  const row = await env.DB.prepare(
    'SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1',
  ).first<{ name: string }>();

  const applied = row?.name ?? null;
  if (applied !== expected) {
    throw new PendingD1MigrationError(applied, expected);
  }
}
