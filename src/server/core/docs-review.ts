import { logger } from '@server/core/logger';
import { ModelService } from '@server/services/model';
import type { GitHubService } from '@server/services/github';
import { TokenTracker } from '@server/core/token-tracker';
import type { RepoConfig } from '@shared/schema';
import { DOCS_REVIEW_SCHEMA } from '@server/models/schemas';
import { listEnabledDocsReviewRules, type DocsReviewSkill } from '@server/db/docs-review';
import { createProposedBestPractice } from '@server/db/best-practices';
import { searchCloudflareDocs } from '@server/services/cloudflare-docs';

import agentsSdkSkill from '../skills/agents-sdk/SKILL.md?raw';
import workersBpSkill from '../skills/workers-best-practices/SKILL.md?raw';
import cloudflareJediSkill from '../skills/cloudflare-jedi/SKILL.md?raw';
import cloudflareSkill from '../skills/cloudflare/SKILL.md?raw';

const SKILL_CONTENT: Record<DocsReviewSkill, string> = {
  'agents-sdk': agentsSdkSkill,
  'workers-best-practices': workersBpSkill,
  'cloudflare-jedi': cloudflareJediSkill,
  'cloudflare': cloudflareSkill,
};

/**
 * Run the configured Cloudflare-docs reviews for a PR. For each enabled rule
 * whose trigger matches the diff, compare the code against the official
 * Cloudflare docs/skill for the rule's criteria and record any gotchas as
 * PENDING best practices (applied immediately, awaiting human review).
 * Best-effort — never throws into the review flow.
 */
export async function runDocsReview(
  env: Env,
  github: GitHubService,
  job: { id: string; owner: string; repo: string; prNumber: number },
  config: RepoConfig,
): Promise<number> {
  try {
    const rules = await listEnabledDocsReviewRules(env);
    if (rules.length === 0) return 0;

    const diff = await github.getPullRequestDiff(job.owner, job.repo, job.prNumber);
    if (!diff || diff.trim().length === 0) return 0;

    // Changed file paths, for trigger matching (cheap) alongside the diff body.
    const paths = Array.from(diff.matchAll(/^\+\+\+ b\/(.+)$/gm)).map((m) => m[1]).join('\n');
    const haystack = `${paths}\n${diff}`;

    const model = new ModelService(env, new TokenTracker(), { jobId: job.id });
    let created = 0;

    for (const rule of rules) {
      let matches = false;
      try { matches = new RegExp(rule.trigger, 'i').test(haystack); } catch { matches = haystack.includes(rule.trigger); }
      if (!matches) continue;

      const skillContent = SKILL_CONTENT[rule.skill as DocsReviewSkill];
      if (!skillContent) continue;

      // Optionally augment the bundled skill with a live query to the official
      // Cloudflare docs MCP (search_cloudflare_documentation). Best-effort.
      let liveDocs = '';
      if (rule.use_live_docs) {
        liveDocs = await searchCloudflareDocs(rule.criteria, { maxChars: 8000 });
      }
      const docsBlock = liveDocs
        ? `${skillContent.slice(0, 8000)}\n\n=== LIVE CLOUDFLARE DOCS (search_cloudflare_documentation) ===\n${liveDocs}`
        : skillContent.slice(0, 12000);

      try {
        const res = await model.callModel(
          config.model?.main || '@cf/moonshotai/kimi-k2.7-code',
          {
            systemPrompt: `You are a Cloudflare platform expert. Below is the official Cloudflare documentation (a distilled skill). Review the PR diff ONLY for the following concern and report concrete gotchas where the code diverges from the docs:

CONCERN: ${rule.criteria}

Only report real, specific problems grounded in the docs and visible in the diff. If the code is correct, return an empty array. Do not invent issues.

=== CLOUDFLARE DOCS (${rule.skill}) ===
${docsBlock}`,
            userPrompt: `PR diff (truncated):\n\n${diff.slice(0, 18000)}`,
          },
          DOCS_REVIEW_SCHEMA,
        );

        let parsed: { gotchas?: any[] };
        try { parsed = JSON.parse(res.rawText); } catch { continue; }
        const gotchas = Array.isArray(parsed.gotchas) ? parsed.gotchas : [];

        for (const g of gotchas) {
          if (!g?.title || !g?.instruction) continue;
          await createProposedBestPractice(env, {
            name: String(g.title).slice(0, 200),
            infraId: 'cloudflare-workers',
            criteria: String(g.criteria || rule.criteria).slice(0, 500),
            instructions: String(g.instruction),
            isActive: true,
            source: `docs-review:${rule.skill}`,
            sourcePrNumber: job.prNumber,
            sourceRepo: `${job.owner}/${job.repo}`,
          });
          created++;
        }
      } catch (err) {
        logger.error(`Docs review rule "${rule.name}" failed`, err instanceof Error ? err : new Error(String(err)));
      }
    }

    if (created > 0) {
      logger.info(`Docs review created ${created} pending best practice(s) for ${job.owner}/${job.repo}#${job.prNumber}`);
    }
    return created;
  } catch (err) {
    logger.error('runDocsReview failed', err instanceof Error ? err : new Error(String(err)));
    return 0;
  }
}
