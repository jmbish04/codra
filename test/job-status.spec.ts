import { describeWait } from '@client/lib/job-status';
import type { JobSummary } from '@shared/schema';

const NOW = new Date('2026-07-15T12:00:00Z').getTime();

function job(overrides: Partial<JobSummary>): JobSummary {
  return {
    id: '00000000-0000-0000-0000-000000000000',
    owner: 'acme',
    repo: 'app',
    installationId: '1',
    prNumber: 1,
    prTitle: null,
    prAuthor: null,
    commitSha: 'abc',
    trigger: 'auto',
    status: 'queued',
    verdict: null,
    fileCount: 0,
    commentCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    nextRetryAt: null,
    startedAt: null,
    finishedAt: null,
    errorMessage: null,
    steps: [],
    ...overrides,
  } as JobSummary;
}

describe('describeWait', () => {
  it('returns null for terminal jobs', () => {
    expect(describeWait(job({ status: 'done' }), NOW)).toBeNull();
    expect(describeWait(job({ status: 'superseded' }), NOW)).toBeNull();
  });

  it('explains provider-backoff pauses via nextRetryAt', () => {
    const info = describeWait(
      job({ status: 'running', startedAt: new Date(NOW - 60_000).toISOString(), nextRetryAt: new Date(NOW + 5 * 60_000).toISOString() }),
      NOW,
    );
    expect(info?.label).toMatch(/Paused/);
    expect(info?.detail).toContain('~5 min');
    expect(info?.tone).toBe('warning');
  });

  it('flags a queue that has waited too long', () => {
    const info = describeWait(job({ status: 'queued', createdAt: new Date(NOW - 20 * 60_000).toISOString() }), NOW);
    expect(info?.tone).toBe('warning');
    expect(info?.detail).toMatch(/backed up|scaling/);
  });

  it('reports a normal short queue wait as neutral', () => {
    const info = describeWait(job({ status: 'queued', createdAt: new Date(NOW - 30_000).toISOString() }), NOW);
    expect(info?.tone).toBe('neutral');
    expect(info?.label).toBe('Waiting for a worker');
  });

  it('reads a queued Workers AI batch as healthy, not as a provider outage', () => {
    // A polling batch also sets nextRetryAt, so without the step check this
    // would be mislabelled "Paused — provider slowdown".
    const info = describeWait(
      job({
        status: 'running',
        startedAt: new Date(NOW - 60_000).toISOString(),
        nextRetryAt: new Date(NOW + 30_000).toISOString(),
        steps: [{ name: 'Batch review', status: 'running', startedAt: new Date(NOW - 30_000).toISOString(), finishedAt: null }],
      }),
      NOW,
    );
    expect(info?.label).toMatch(/batch/i);
    expect(info?.tone).toBe('neutral');
    expect(info?.detail).not.toMatch(/slowdown/);
  });

  it('still reports a provider pause once the batch step is finished', () => {
    const info = describeWait(
      job({
        status: 'running',
        startedAt: new Date(NOW - 60_000).toISOString(),
        nextRetryAt: new Date(NOW + 5 * 60_000).toISOString(),
        steps: [{ name: 'Batch review', status: 'done', startedAt: new Date(NOW - 60_000).toISOString(), finishedAt: new Date(NOW - 30_000).toISOString() }],
      }),
      NOW,
    );
    expect(info?.label).toMatch(/Paused/);
    expect(info?.tone).toBe('warning');
  });

  it('returns null for a healthy running job', () => {
    expect(describeWait(job({ status: 'running', startedAt: new Date(NOW - 10_000).toISOString() }), NOW)).toBeNull();
  });
});
