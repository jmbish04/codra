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
  const s = (await res.json()) as { id?: string; name?: string; state?: string; url?: string };
  // The API returns both `id` and a resource `name` ("sessions/{id}"). Prefer
  // `id`, fall back to the name's trailing segment so the session id is never
  // lost, and fail loudly rather than persist an empty id.
  const id = s.id || s.name?.split('/').pop() || '';
  if (!id) throw new Error(`Jules POST /sessions returned no session id: ${JSON.stringify(s)}`);
  return { id, url: s.url ?? `https://jules.google.com/session/${id}`, state: s.state ?? 'QUEUED' };
}
