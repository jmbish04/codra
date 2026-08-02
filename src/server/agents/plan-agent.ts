import { Agent } from 'agents';
import { generateText } from 'ai';
import { createWorkersAI } from 'workers-ai-provider';
import { eq } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { repositories } from '@server/db/schemas';
import { getPackage, acceptRevision } from '@server/db/planning-packages';
import { upsertRevision } from '@server/services/planning-packages';
import { askJulesForPlan, askJulesSession } from '@server/services/jules';
import { getSecretStoreBinding } from '@server/utils/secrets';
import { logger } from '@server/core/logger';
import {
  type PlanPhase, buildKickoffPrompt, buildPlanningPrompt, buildImprovePrompt,
  buildMergePrompt, buildReviewPrompt, parsePlanFromText, parseReviewVerdict,
} from '@server/services/plan-orchestrator';

type PlanState = {
  packageId: string;
  phase: PlanPhase;
  sessionId: string | null;
  iterations: number;
  error: string | null;
  updatedAt: string;
};

const MAX_REVIEW_ITERATIONS = 3;
const REVIEW_MODEL = '@cf/moonshotai/kimi-k2.7-code';

/**
 * PlanAgent — one Durable Object per planning package. Drives Jules to produce a
 * plan, reviews it, re-assigns on gaps, then merges across revisions into an
 * accepted super-plan.
 *
 * ponytail: the loop runs inline in `run()` (Jules `ask()` blocks per turn). If
 * a planning turn ever outlives the DO invocation limit, split this into an
 * alarm-stepped machine keyed on the persisted `phase`.
 */
export class PlanAgent extends Agent<any> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/start') && request.method === 'POST') {
      const { packageId } = await request.json<{ packageId: string }>();
      if (!packageId) return new Response('packageId required', { status: 400 });
      this.ctx.waitUntil(this.run(packageId));
      return Response.json({ ok: true, phase: 'planning' }, { status: 202 });
    }
    if (url.pathname.endsWith('/status')) {
      const state = (await this.ctx.storage.get<PlanState>('state')) ?? null;
      return Response.json({ state });
    }
    return new Response('Not found', { status: 404 });
  }

  private async persistState(patch: Partial<PlanState> & Pick<PlanState, 'packageId' | 'phase'>) {
    const defaults: Pick<PlanState, 'sessionId' | 'iterations' | 'error'> = { sessionId: null, iterations: 0, error: null };
    const prev = (await this.ctx.storage.get<PlanState>('state')) ?? ({} as Partial<PlanState>);
    const next: PlanState = { ...defaults, ...prev, ...patch, updatedAt: new Date().toISOString() };
    await this.ctx.storage.put('state', next);
    return next;
  }

  private async review(title: string, revisionJson: string): Promise<{ satisfied: boolean; feedback: string }> {
    const workersai = createWorkersAI({ binding: this.env.AI });
    const { text } = await generateText({
      model: workersai(REVIEW_MODEL as any),
      system: 'You are the codra orchestrator. Judge plans strictly and reply only with the requested JSON block.',
      prompt: buildReviewPrompt({ title, revisionJson }),
    });
    return parseReviewVerdict(text);
  }

  async run(packageId: string): Promise<void> {
    try {
      await this.persistState({ packageId, phase: 'planning', iterations: 0, error: null });
      const pkg = await getPackage(this.env, packageId);
      if (!pkg) throw new Error(`package ${packageId} not found`);

      const repo = await getDb(this.env).select().from(repositories)
        .where(eq(repositories.id, pkg.repository_id)).get();
      if (!repo) throw new Error(`repository ${pkg.repository_id} not found`);
      const branch = 'main'; // ponytail: default branch; read from repo config if repos ever track it.

      const apiKey = await getSecretStoreBinding(this.env, 'JULES_API_KEY').catch(() => '');
      if (!apiKey) throw new Error('JULES_API_KEY not configured');

      // 1. Ask Jules for the initial plan.
      const { sessionId, message } = await askJulesForPlan(apiKey, {
        owner: repo.owner, repo: repo.repo, branch,
        kickoff: buildKickoffPrompt(repo.owner, repo.repo),
        planPrompt: buildPlanningPrompt({ title: pkg.title, requestPrompt: pkg.request_prompt_json }),
        title: pkg.title,
      });
      await this.persistState({ packageId, phase: 'reviewing', sessionId });

      // 2. Review loop — each parseable plan is a new immutable revision.
      let text = message;
      for (let iteration = 1; iteration <= MAX_REVIEW_ITERATIONS; iteration++) {
        await this.persistState({ packageId, phase: 'reviewing', sessionId, iterations: iteration });
        const parsed = parsePlanFromText(text);
        if (parsed.ok) {
          const rev = await upsertRevision(this.env, packageId, {
            ...parsed.input, source: 'jules', julesSessionId: sessionId, status: 'proposed', contextText: text,
          });
          const verdict = await this.review(pkg.title, JSON.stringify(parsed.input));
          if (verdict.satisfied) {
            await acceptRevision(this.env, packageId, rev.id);
            await this.persistState({ packageId, phase: 'accepted', sessionId });
            return;
          }
          text = await askJulesSession(apiKey, sessionId, buildImprovePrompt(verdict.feedback));
        } else {
          text = await askJulesSession(apiKey, sessionId, buildImprovePrompt(`Your output was not a valid plan (${parsed.reason}).`));
        }
      }

      // 3. Not satisfied after MAX iterations — merge every revision into a super-plan.
      await this.persistState({ packageId, phase: 'merging', sessionId });
      const exportUrl = `${this.env.APP_URL}/api/public/planning-packages/export`;
      const merged = await askJulesSession(apiKey, sessionId, buildMergePrompt({ exportUrl, planIds: [packageId] }));
      const mergedParsed = parsePlanFromText(merged);
      if (mergedParsed.ok) {
        const rev = await upsertRevision(this.env, packageId, {
          ...mergedParsed.input, source: 'merge', julesSessionId: sessionId, status: 'proposed', contextText: merged,
        });
        const verdict = await this.review(pkg.title, JSON.stringify(mergedParsed.input));
        if (verdict.satisfied) {
          await acceptRevision(this.env, packageId, rev.id);
          await this.persistState({ packageId, phase: 'accepted', sessionId });
          return;
        }
      }
      await this.persistState({ packageId, phase: 'failed', sessionId, error: 'no satisfactory plan after review + merge' });
    } catch (err) {
      logger.error(`PlanAgent run failed for ${packageId}`, err instanceof Error ? err : new Error(String(err)));
      await this.persistState({ packageId, phase: 'failed', error: String(err instanceof Error ? err.message : err) });
    }
  }
}
