import { describe, it, expect, beforeEach } from 'vitest';
import { createPackage, getRevision } from '@server/db/planning-packages';
import { upsertRevision } from '@server/services/planning-packages';
import { createTestEnv } from './helpers';

describe('planning-packages service: upsertRevision', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv(); });

  it('streams context to R2 content-addressed and records the pointer', async () => {
    const p = await createPackage(env, { repositoryId: 1, slug: 'abc', title: 'ABC' });
    const { revisionNumber } = await upsertRevision(env, p.id, {
      source: 'coding_agent', problem: 'P',
      contextText: 'RAW TRANSCRIPT DUMP', coverageNote: 'full',
    });
    const rev = await getRevision(env, p.id, revisionNumber);
    expect(rev?.context_r2_key).toMatch(new RegExp(`^planning/${p.id}/[0-9a-f]{64}\\.md$`));
    expect(rev?.context_bytes).toBe('RAW TRANSCRIPT DUMP'.length);
    expect(rev?.context_coverage_note).toBe('full');

    // transcript is retrievable from R2, never inlined in D1
    const obj = await env.PLANNING_ARTIFACTS.get(rev!.context_r2_key!);
    expect(await obj!.text()).toBe('RAW TRANSCRIPT DUMP');
  });

  it('omits R2 write when no context supplied', async () => {
    const p = await createPackage(env, { repositoryId: 1, slug: 'abc', title: 'ABC' });
    const { revisionNumber } = await upsertRevision(env, p.id, { source: 'jules' });
    const rev = await getRevision(env, p.id, revisionNumber);
    expect(rev?.context_r2_key).toBeNull();
  });
});
