import { connect, MemoryStorage, MemorySessionStorage } from '@google/jules-sdk';
import type { JulesClient, SessionResource, SessionOutput, StorageFactory } from '@google/jules-sdk';

/**
 * Storage pinned to memory. A Cloudflare Worker has no persistent filesystem,
 * so the SDK's default NodeFile storage (which calls node:fs) must not be used.
 * Only the SDK's REST control plane runs inside the isolate — the coding agents
 * themselves execute in Google's cloud — so an ephemeral in-memory cache per
 * request is exactly right.
 */
const MEMORY_STORAGE_FACTORY: StorageFactory = {
  activity: () => new MemoryStorage(),
  session: () => new MemorySessionStorage(),
};

/**
 * Build a Jules client bound to `apiKey`. The default arg on each exported
 * function makes the client injectable, which keeps the functions unit-testable
 * with a fake client (no network, no SDK internals).
 */
export function createJulesClient(apiKey: string): JulesClient {
  return connect({ apiKey, storageFactory: MEMORY_STORAGE_FACTORY });
}

/** Normalized status shape the rest of Codra persists and renders. */
export type JulesSessionStatus = { id: string; url: string; state: string; pullRequestUrl: string | null };

/** Best-effort PR url: prefer the outcome's PR, else any pullRequest output. */
function pullRequestUrlOf(resource: SessionResource): string | null {
  const fromOutcome = resource.outcome?.pullRequest?.url;
  if (fromOutcome) return fromOutcome;
  const prOutput = (resource.outputs ?? []).find(
    (o): o is Extract<SessionOutput, { type: 'pullRequest' }> => o.type === 'pullRequest',
  );
  return prOutput?.pullRequest.url ?? null;
}

function toStatus(resource: SessionResource): JulesSessionStatus {
  return {
    id: resource.id,
    url: resource.url || `https://jules.google.com/session/${resource.id}`,
    state: resource.state,
    pullRequestUrl: pullRequestUrlOf(resource),
  };
}

/** True if the owner/repo is a Jules-connected GitHub source. */
export async function isRepoConnected(
  apiKey: string, owner: string, repo: string, client: JulesClient = createJulesClient(apiKey),
): Promise<boolean> {
  const source = await client.sources.get({ github: `${owner}/${repo}` });
  return Boolean(source);
}

/**
 * Start a Jules session against a connected GitHub repo and return its current
 * status. Runs autonomously (no plan approval) and opens a PR when finished.
 */
export async function startJulesSession(
  apiKey: string,
  opts: { owner: string; repo: string; branch: string; prompt: string; title?: string },
  client: JulesClient = createJulesClient(apiKey),
): Promise<JulesSessionStatus> {
  const session = await client.session({
    prompt: opts.prompt,
    title: opts.title,
    source: { github: `${opts.owner}/${opts.repo}`, baseBranch: opts.branch },
    requireApproval: false,
    autoPr: true,
  });
  return toStatus(await session.info());
}

/** Fetch the current state of an existing session (realtime status). */
export async function getJulesSession(
  apiKey: string, sessionId: string, client: JulesClient = createJulesClient(apiKey),
): Promise<JulesSessionStatus> {
  return toStatus(await client.session(sessionId).info());
}

/**
 * Start a Jules PLANNING session (no PR): create the session, then ask it to
 * produce the plan and return the agent's reply text plus the session id. Used
 * by PlanAgent to generate a proposed revision.
 */
export async function askJulesForPlan(
  apiKey: string,
  opts: { owner: string; repo: string; branch: string; kickoff: string; planPrompt: string; title?: string },
  client: JulesClient = createJulesClient(apiKey),
): Promise<{ sessionId: string; message: string }> {
  const session = await client.session({
    prompt: opts.kickoff,
    title: opts.title,
    source: { github: `${opts.owner}/${opts.repo}`, baseBranch: opts.branch },
    requireApproval: false,
    autoPr: false,
  });
  const reply = await session.ask(opts.planPrompt);
  const info = await session.info();
  return { sessionId: info.id, message: reply.message };
}

/** Send a follow-up message to an existing session and return the agent's reply. */
export async function askJulesSession(
  apiKey: string, sessionId: string, prompt: string, client: JulesClient = createJulesClient(apiKey),
): Promise<string> {
  const reply = await client.session(sessionId).ask(prompt);
  return reply.message;
}

/**
 * Create a plan-only Jules session (no PR) and return its id. Non-blocking: this
 * just registers the session + prompt; the plan arrives asynchronously and is
 * read later by the cron poller via {@link getJulesSnapshot}.
 */
export async function startJulesPlanSession(
  apiKey: string,
  opts: { owner: string; repo: string; branch: string; prompt: string; title?: string },
  client: JulesClient = createJulesClient(apiKey),
): Promise<string> {
  const session = await client.session({
    prompt: opts.prompt,
    title: opts.title,
    source: { github: `${opts.owner}/${opts.repo}`, baseBranch: opts.branch },
    requireApproval: false,
    autoPr: false,
  });
  return (await session.info()).id;
}

// Activities are kept raw (the SDK flattens each union's `type` to top-level);
// consumers read `type`/`message` for decisions and the full shape for caching.
export type JulesSnapshot = { state: string; activities: Array<Record<string, any>>; prUrl: string | null };

/** One bounded read of a session's current state, activities, and PR (if any). */
export async function getJulesSnapshot(
  apiKey: string, sessionId: string, client: JulesClient = createJulesClient(apiKey),
): Promise<JulesSnapshot> {
  const snap = await client.session(sessionId).snapshot({ activities: true });
  return {
    state: snap.state,
    activities: (snap.activities ?? []) as unknown as Array<Record<string, any>>,
    prUrl: snap.pr?.url ?? null,
  };
}

/** Fire-and-forget message to a session (non-blocking — never awaits a reply). */
export async function sendJulesMessage(
  apiKey: string, sessionId: string, text: string, client: JulesClient = createJulesClient(apiKey),
): Promise<void> {
  await client.session(sessionId).send(text);
}
