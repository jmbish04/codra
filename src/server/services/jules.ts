const JULES_BASE = 'https://jules.googleapis.com/v1alpha';

export type JulesSource = { name: string };

function headers(apiKey: string) {
  return { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey };
}

/** True if the owner/repo is a Jules-connected GitHub source. */
export async function isRepoConnected(
  apiKey: string, owner: string, repo: string, fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const res = await fetchImpl(`${JULES_BASE}/sources`, { headers: headers(apiKey) });
  if (!res.ok) throw new Error(`Jules GET /sources ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { sources?: JulesSource[] };
  const target = `sources/github/${owner}/${repo}`;
  return (data.sources ?? []).some((s) => s.name === target);
}

/** Start a Jules session against a connected GitHub repo. */
export async function startJulesSession(
  apiKey: string,
  opts: { owner: string; repo: string; branch: string; prompt: string; title?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: string; url: string; state: string }> {
  const res = await fetchImpl(`${JULES_BASE}/sessions`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({
      prompt: opts.prompt,
      title: opts.title,
      sourceContext: {
        source: `sources/github/${opts.owner}/${opts.repo}`,
        githubRepoContext: { startingBranch: opts.branch },
      },
    }),
  });
  if (!res.ok) throw new Error(`Jules POST /sessions ${res.status}: ${await res.text()}`);
  const s = (await res.json()) as JulesSessionResource;
  return normalizeSession(s);
}

type JulesSessionResource = {
  id?: string;
  name?: string;
  state?: string;
  url?: string;
  outputs?: Array<{ pullRequest?: { url?: string }; url?: string } | null>;
};

/** Prefer `id`, fall back to the resource name's trailing segment. */
function sessionIdOf(s: JulesSessionResource): string {
  return s.id || s.name?.split('/').pop() || '';
}

/** Best-effort extraction of a merged/opened PR url from the session outputs. */
function pullRequestUrlOf(s: JulesSessionResource): string | null {
  for (const out of s.outputs ?? []) {
    const url = out?.pullRequest?.url ?? out?.url;
    if (url && url.includes('/pull/')) return url;
  }
  return null;
}

function normalizeSession(s: JulesSessionResource): { id: string; url: string; state: string; pullRequestUrl: string | null } {
  const id = sessionIdOf(s);
  if (!id) throw new Error(`Jules session response returned no session id: ${JSON.stringify(s)}`);
  return {
    id,
    url: s.url ?? `https://jules.google.com/session/${id}`,
    state: s.state ?? 'QUEUED',
    pullRequestUrl: pullRequestUrlOf(s),
  };
}

/** Fetch the current state of an existing session (realtime status). */
export async function getJulesSession(
  apiKey: string, sessionId: string, fetchImpl: typeof fetch = fetch,
): Promise<{ id: string; url: string; state: string; pullRequestUrl: string | null }> {
  const res = await fetchImpl(`${JULES_BASE}/sessions/${encodeURIComponent(sessionId)}`, { headers: headers(apiKey) });
  if (!res.ok) throw new Error(`Jules GET /sessions/${sessionId} ${res.status}: ${await res.text()}`);
  return normalizeSession((await res.json()) as JulesSessionResource);
}
