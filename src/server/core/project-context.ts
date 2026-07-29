import type { GitHubService } from '../services/github';
import { logger } from './logger';

/**
 * The project's own instructions + stack declaration, handed to the review
 * agent so it respects what the repo has already chosen. Without this the model
 * makes stack-blind suggestions (e.g. "drop D1, use Supabase") that contradict
 * the wrangler bindings and the repo's AGENTS.md/CLAUDE.md conventions.
 */

// Agent/assistant instruction files, in priority order. Kept small — each is a
// GitHub subrequest on the review hot path (cached after the first chunk).
const INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md'];
// Stack/binding declarations — first one that exists is included.
const CONFIG_FILES = ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'];

const PER_FILE_CAP = 6000;
const TOTAL_CAP = 16000;

function cap(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[...truncated for length...]`;
}

/**
 * Fetch and assemble the repo's instruction files + stack config at `ref`,
 * cached in APP_KV per (owner/repo@ref) so the per-chunk review phase pays the
 * GitHub subrequests at most once. Returns '' when the repo declares nothing.
 */
export async function getProjectContext(
  env: Pick<Env, 'APP_KV'>,
  github: GitHubService,
  owner: string,
  repo: string,
  ref: string,
): Promise<string> {
  const cacheKey = `projctx:${owner}/${repo}@${ref}`;
  try {
    const cached = await env.APP_KV.get(cacheKey);
    if (cached !== null) return cached;
  } catch (err) {
    logger.warn('Failed to read cached project context', err);
  }

  const parts: string[] = [];

  for (const path of INSTRUCTION_FILES) {
    try {
      const result = await github.getRepoFileWithRefOrNull(owner, repo, path, ref);
      if (result?.content) parts.push(`### ${path}\n${cap(result.content.trim(), PER_FILE_CAP)}`);
    } catch (err) {
      logger.warn(`Failed to fetch ${path} for project context`, err);
    }
  }

  for (const path of CONFIG_FILES) {
    try {
      const result = await github.getRepoFileWithRefOrNull(owner, repo, path, ref);
      if (result?.content) {
        parts.push(`### ${path} (declared stack / bindings — treat as authoritative)\n${cap(result.content.trim(), PER_FILE_CAP)}`);
        break; // one wrangler config is enough
      }
    } catch (err) {
      logger.warn(`Failed to fetch ${path} for project context`, err);
    }
  }

  const context = cap(parts.join('\n\n'), TOTAL_CAP);
  try {
    // Short TTL: instruction files change rarely, but a new commit gets a fresh
    // ref and therefore a fresh key anyway.
    await env.APP_KV.put(cacheKey, context, { expirationTtl: 60 * 60 });
  } catch (err) {
    logger.warn('Failed to cache project context', err);
  }
  return context;
}
