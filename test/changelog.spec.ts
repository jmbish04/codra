import { buildChangelogSlug } from '@server/db/changelog';
import { changelogModelOutputSchema } from '@shared/schema';

describe('buildChangelogSlug', () => {
  it('builds a url-safe slug from the PR coordinates', () => {
    expect(
      buildChangelogSlug({ owner: 'jmbish04', repo: 'codra', prNumber: 12, commitSha: 'abcdef1234567890' }),
    ).toBe('jmbish04-codra-pr12-abcdef1');
  });

  it('normalizes owners and repos that contain url-unsafe characters', () => {
    expect(
      buildChangelogSlug({ owner: 'My Org.', repo: 'core_remodel', prNumber: 7, commitSha: 'ff00aa9911' }),
    ).toBe('my-org-core-remodel-pr7-ff00aa9');
  });

  it('is stable for the same commit and changes when the commit changes', () => {
    const base = { owner: 'o', repo: 'r', prNumber: 1 };
    const a = buildChangelogSlug({ ...base, commitSha: '1111111aaa' });
    const b = buildChangelogSlug({ ...base, commitSha: '1111111bbb' });
    const c = buildChangelogSlug({ ...base, commitSha: '2222222aaa' });
    expect(a).toBe(b); // same 7-char prefix → same entry, so a re-review upserts
    expect(a).not.toBe(c);
  });
});

describe('changelogModelOutputSchema', () => {
  const valid = {
    title: 'Add batch review',
    summary: 'Queues file reviews on the Workers AI batch API.',
    area: 'Backend',
    problem: 'Sync reviews hit capacity errors.',
    approach: 'Queue them.',
    changes: [{ kind: 'added', text: 'Batch path' }],
    api_changes: ['POST /api/x — y'],
    migrations: [{ tag: '0008', sql: 'ALTER TABLE jobs ADD batch_request_id text;' }],
    diagrams: [{ caption: 'schema', code: 'erDiagram\n  JOBS ||--o{ FILE_REVIEWS : has' }],
    code: [{ title: 'submit', lang: 'ts', code: 'const x = 1;' }],
  };

  it('accepts well-formed model output', () => {
    expect(changelogModelOutputSchema.parse(valid).title).toBe('Add batch review');
  });

  it('defaults the optional collections so the renderer never sees undefined', () => {
    const parsed = changelogModelOutputSchema.parse({
      title: 't',
      summary: 's',
      area: 'a',
      problem: 'p',
      approach: 'ap',
    });
    expect(parsed.changes).toEqual([]);
    expect(parsed.diagrams).toEqual([]);
    expect(parsed.migrations).toEqual([]);
  });

  it('rejects an unknown change kind rather than rendering it', () => {
    expect(() =>
      changelogModelOutputSchema.parse({ ...valid, changes: [{ kind: 'exploded', text: 'x' }] }),
    ).toThrow();
  });

  it('rejects an unsupported code language', () => {
    expect(() =>
      changelogModelOutputSchema.parse({ ...valid, code: [{ title: 't', lang: 'ruby', code: 'x' }] }),
    ).toThrow();
  });

  it('rejects output missing a required narrative field', () => {
    const { problem: _problem, ...withoutProblem } = valid;
    expect(() => changelogModelOutputSchema.parse(withoutProblem)).toThrow();
  });
});
