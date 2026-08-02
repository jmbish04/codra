import { describe, it, expect, vi } from 'vitest';
import { getJulesSession, isRepoConnected, startJulesSession } from '@server/services/jules';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('jules service', () => {
  it('detects a connected source and sends the api-key header', async () => {
    const f = vi.fn(async (url: any, init: any) => {
      expect(String(url)).toBe('https://jules.googleapis.com/v1alpha/sources');
      expect(init.headers['X-Goog-Api-Key']).toBe('K');
      return jsonResponse({ sources: [{ name: 'sources/github/o/r' }] });
    }) as unknown as typeof fetch;
    expect(await isRepoConnected('K', 'o', 'r', f)).toBe(true);
    expect(await isRepoConnected('K', 'o', 'other', f)).toBe(false);
  });

  it('starts a session and returns id + url', async () => {
    const f = vi.fn(async (url: any, init: any) => {
      expect(String(url)).toBe('https://jules.googleapis.com/v1alpha/sessions');
      const body = JSON.parse(init.body);
      expect(body.sourceContext.source).toBe('sources/github/o/r');
      expect(body.sourceContext.githubRepoContext.startingBranch).toBe('main');
      expect(body.prompt).toBe('do docs');
      return jsonResponse({ id: 'sid', name: 'sessions/sid', state: 'QUEUED', url: 'https://jules.google.com/session/sid' });
    }) as unknown as typeof fetch;
    const r = await startJulesSession('K', { owner: 'o', repo: 'r', branch: 'main', prompt: 'do docs', title: 'Docs' }, f);
    expect(r).toEqual({ id: 'sid', url: 'https://jules.google.com/session/sid', state: 'QUEUED', pullRequestUrl: null });
  });

  it('falls back to a constructed url when the response omits it', async () => {
    const f = (async () => jsonResponse({ id: 'sid', name: 'sessions/sid', state: 'QUEUED' })) as unknown as typeof fetch;
    const r = await startJulesSession('K', { owner: 'o', repo: 'r', branch: 'main', prompt: 'p' }, f);
    expect(r.url).toBe('https://jules.google.com/session/sid');
  });

  it('derives the session id from the resource name when id is absent', async () => {
    const f = (async () => jsonResponse({ name: 'sessions/sid', state: 'QUEUED' })) as unknown as typeof fetch;
    const r = await startJulesSession('K', { owner: 'o', repo: 'r', branch: 'main', prompt: 'p' }, f);
    expect(r.id).toBe('sid');
    expect(r.url).toBe('https://jules.google.com/session/sid');
  });

  it('throws when the response carries no session id or name', async () => {
    const f = (async () => jsonResponse({ state: 'QUEUED' })) as unknown as typeof fetch;
    await expect(startJulesSession('K', { owner: 'o', repo: 'r', branch: 'main', prompt: 'p' }, f)).rejects.toThrow(/no session id/);
  });

  it('throws on non-2xx', async () => {
    const f = (async () => jsonResponse({ error: 'nope' }, 403)) as unknown as typeof fetch;
    await expect(startJulesSession('K', { owner: 'o', repo: 'r', branch: 'main', prompt: 'p' }, f)).rejects.toThrow(/403/);
  });

  it('fetches live session status and extracts the PR url from outputs', async () => {
    const f = vi.fn(async (url: any, init: any) => {
      expect(String(url)).toBe('https://jules.googleapis.com/v1alpha/sessions/sid');
      expect(init.headers['X-Goog-Api-Key']).toBe('K');
      return jsonResponse({
        id: 'sid',
        state: 'IN_PROGRESS',
        url: 'https://jules.google.com/session/sid',
        outputs: [{ pullRequest: { url: 'https://github.com/o/r/pull/7' } }],
      });
    }) as unknown as typeof fetch;
    const r = await getJulesSession('K', 'sid', f);
    expect(r).toEqual({
      id: 'sid',
      url: 'https://jules.google.com/session/sid',
      state: 'IN_PROGRESS',
      pullRequestUrl: 'https://github.com/o/r/pull/7',
    });
  });

  it('returns a null PR url when no output carries one', async () => {
    const f = (async () => jsonResponse({ id: 'sid', state: 'QUEUED' })) as unknown as typeof fetch;
    const r = await getJulesSession('K', 'sid', f);
    expect(r.pullRequestUrl).toBeNull();
  });
});
