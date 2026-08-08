import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createD1 } from './d1-sqlite';
import {
  assertD1MigrationsCurrent,
  EXPECTED_LATEST_D1_MIGRATION,
  PendingD1MigrationError,
} from '@server/db/migration-check';

describe('assertD1MigrationsCurrent', () => {
  it('passes when d1_migrations matches the shipped journal tag', async () => {
    const env = { DB: createD1(path.resolve(process.cwd(), 'db/migrations/d1')) };
    await expect(assertD1MigrationsCurrent(env)).resolves.toBeUndefined();
  });

  it('throws PendingD1MigrationError with migrate:remote guidance when behind', async () => {
    const env = { DB: createD1(path.resolve(process.cwd(), 'db/migrations/d1')) };
    await env.DB.prepare('DELETE FROM d1_migrations WHERE name = ?')
      .bind(EXPECTED_LATEST_D1_MIGRATION)
      .run();

    await expect(assertD1MigrationsCurrent(env)).rejects.toMatchObject({
      name: 'PendingD1MigrationError',
      expected: EXPECTED_LATEST_D1_MIGRATION,
    });

    try {
      await assertD1MigrationsCurrent(env);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PendingD1MigrationError);
      expect((error as PendingD1MigrationError).message).toContain('npm run migrate:remote');
      expect((error as PendingD1MigrationError).applied).not.toBe(EXPECTED_LATEST_D1_MIGRATION);
    }
  });
});
