import { describe, it, expect } from 'vitest';
import type { JulesClient } from '@google/jules-sdk';
import { getJulesSession, isRepoConnected, startJulesSession } from '@server/services/jules';

/** A minimal fake JulesClient covering only the methods the service calls. */
function fakeClient(overrides: {
  source?: unknown;
  info?: unknown;
  onSession?: (config: unknown) => void;
}): JulesClient {
  const sessionClient = { id: 'sid', info: async () => overrides.info } as any;
  return {
    sources: { get: async (_filter: unknown) => overrides.source },
    session: (arg: unknown) => {
      overrides.onSession?.(arg);
      // session(config) → Promise<SessionClient>; session(id) → SessionClient.
      return typeof arg === 'string' ? sessionClient : Promise.resolve(sessionClient);
    },
  } as unknown as JulesClient;
}

describe('jules service', () => {
  it('reports a connected source as true and a missing one as false', async () => {
    expect(await isRepoConnected('K', 'o', 'r', fakeClient({ source: { id: 'sources/github/o/r' } }))).toBe(true);
    expect(await isRepoConnected('K', 'o', 'r', fakeClient({ source: undefined }))).toBe(false);
  });

  it('starts a session (autonomous, auto-PR) and returns its status', async () => {
    let sentConfig: any;
    const client = fakeClient({
      info: { id: 'sid', state: 'QUEUED', url: 'https://jules.google.com/session/sid', outputs: [] },
      onSession: (c) => { sentConfig = c; },
    });
    const r = await startJulesSession('K', { owner: 'o', repo: 'r', branch: 'main', prompt: 'do docs', title: 'Docs' }, client);
    expect(sentConfig).toMatchObject({
      prompt: 'do docs',
      title: 'Docs',
      source: { github: 'o/r', baseBranch: 'main' },
      requireApproval: false,
      autoPr: true,
    });
    expect(r).toEqual({ id: 'sid', url: 'https://jules.google.com/session/sid', state: 'QUEUED', pullRequestUrl: null });
  });

  it('falls back to a constructed url when the resource omits it', async () => {
    const client = fakeClient({ info: { id: 'sid', state: 'QUEUED', url: '', outputs: [] } });
    const r = await getJulesSession('K', 'sid', client);
    expect(r.url).toBe('https://jules.google.com/session/sid');
  });

  it('fetches live status and extracts the PR url from a pullRequest output', async () => {
    const client = fakeClient({
      info: {
        id: 'sid',
        state: 'IN_PROGRESS',
        url: 'https://jules.google.com/session/sid',
        outputs: [{ type: 'pullRequest', pullRequest: { url: 'https://github.com/o/r/pull/7' } }],
      },
    });
    const r = await getJulesSession('K', 'sid', client);
    expect(r).toEqual({
      id: 'sid',
      url: 'https://jules.google.com/session/sid',
      state: 'IN_PROGRESS',
      pullRequestUrl: 'https://github.com/o/r/pull/7',
    });
  });

  it('prefers the outcome PR url over the outputs list', async () => {
    const client = fakeClient({
      info: {
        id: 'sid',
        state: 'COMPLETED',
        url: 'https://jules.google.com/session/sid',
        outcome: { pullRequest: { url: 'https://github.com/o/r/pull/9' } },
        outputs: [{ type: 'pullRequest', pullRequest: { url: 'https://github.com/o/r/pull/7' } }],
      },
    });
    const r = await getJulesSession('K', 'sid', client);
    expect(r.pullRequestUrl).toBe('https://github.com/o/r/pull/9');
  });

  it('returns a null PR url when no output carries one', async () => {
    const client = fakeClient({ info: { id: 'sid', state: 'QUEUED', url: 'u', outputs: [] } });
    const r = await getJulesSession('K', 'sid', client);
    expect(r.pullRequestUrl).toBeNull();
  });
});
