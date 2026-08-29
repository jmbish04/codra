import { generateText } from 'ai';
import { createGuardianWorkersAI } from '@server/ai/guardian-workers-ai';
import { eq } from 'drizzle-orm';
import { getDb } from '@server/db/client';
import { repositories } from '@server/db/schemas';
import { getPackage, acceptRevision, listRevisions } from '@server/db/planning-packages';
import { upsertRevision } from '@server/services/planning-packages';
import {
  createOrchestrationTask, getTaskByToken, listActiveTasks, updateTaskStatus,
  incrementTaskIteration, logTaskEvent, ACTIVE_STATUSES, type OrchestrationTaskRow,
} from '@server/db/jules-orchestration';
import { startJulesPlanSession, getJulesSnapshot } from '@server/services/jules';
import { upsertActivities } from '@server/db/jules-activities';
import { sendJulesLogged } from '@server/services/jules-interactions';
import { searchCloudflareDocs } from '@server/services/cloudflare-docs';
import { getSecretStoreBinding } from '@server/utils/secrets';
import { logger } from '@server/core/logger';
import {
  buildKickoffPrompt, buildPlanningPrompt, buildImprovePrompt, buildReviewPrompt,
  parsePlanFromText, parseReviewVerdict, extractLatestAgentMessage, decideNextAction,
} from '@server/services/plan-orchestrator';

const MAX_ITERATIONS = 3;
// codra's system model — Jules is Gemini 3.1 Pro (1M ctx), so we hand it the full docs.
const REVIEW_MODEL = '@cf/moonshotai/kimi-k2.7-code';
const DOCS_FOR_JULES_MAX = 120_000;

/**
 * Kick off a plan-only Jules session for a package. Non-blocking: creates the D1
 * task row + Jules session and returns. The cron poller advances it from there.
 */
export async function startPlanningSession(
  env: Pick<Env, 'DB' | 'JULES_API_KEY'>, packageId: string,
): Promise<{ taskId: string; sessionId: string } | { error: string }> {
  const pkg = await getPackage(env, packageId);
  if (!pkg) return { error: 'package not found' };
  const repo = await getDb(env).select().from(repositories).where(eq(repositories.id, pkg.repository_id)).get();
  if (!repo) return { error: 'repository not found' };
  const apiKey = await getSecretStoreBinding(env, 'JULES_API_KEY').catch(() => '');
  if (!apiKey) return { error: 'JULES_API_KEY not configured' };

  const task = await createOrchestrationTask(env, { packageId, repositoryId: pkg.repository_id });
  try {
    const sessionId = await startJulesPlanSession(apiKey, {
      owner: repo.owner, repo: repo.repo, branch: 'main',
      prompt: `${buildKickoffPrompt(repo.owner, repo.repo)}\n\n${buildPlanningPrompt({ title: pkg.title, requestPrompt: pkg.request_prompt_json })}`,
      title: pkg.title,
    });
    await updateTaskStatus(env, task.task_id, { status: 'planning', sessionId });
    await logTaskEvent(env, task.task_id, 'SESSION_STARTED', { sessionId });
    return { taskId: task.task_id, sessionId };
  } catch (err) {
    await updateTaskStatus(env, task.task_id, { status: 'failed', error: String(err instanceof Error ? err.message : err) });
    return { error: 'failed to start Jules session' };
  }
}

type PollerEnv = Pick<Env, 'DB' | 'AI_GATEWAY_TOKEN' | 'GUARDIAN' | 'JULES_API_KEY' | 'PLANNING_ARTIFACTS'>;

/** Cron entry point. No-op when no active tasks — the tick returns immediately. */
export async function advanceJulesOrchestration(env: PollerEnv): Promise<{ advanced: number }> {
  const tasks = await listActiveTasks(env);
  if (tasks.length === 0) return { advanced: 0 };
  const apiKey = await getSecretStoreBinding(env, 'JULES_API_KEY').catch(() => '');
  if (!apiKey) return { advanced: 0 };

  let advanced = 0;
  for (const task of tasks) {
    try { await advanceTask(env, apiKey, task); advanced++; }
    catch (err) { logger.error(`advanceTask failed for ${task.task_id}`, err instanceof Error ? err : new Error(String(err))); }
  }
  return { advanced };
}

/**
 * Advance one task by its uuid token — the entry point for an external real-time
 * trigger (the Mac OpenTUI daemon POSTs here when Jules emits an activity). Same
 * bounded single-step logic the cron uses; safe to call concurrently with cron.
 */
export async function advanceTaskById(env: PollerEnv, taskId: string): Promise<{ advanced: boolean; reason?: string }> {
  const task = await getTaskByToken(env, taskId);
  if (!task) return { advanced: false, reason: 'task not found' };
  if (!ACTIVE_STATUSES.includes(task.status as (typeof ACTIVE_STATUSES)[number])) return { advanced: false, reason: 'task not active' };
  const apiKey = await getSecretStoreBinding(env, 'JULES_API_KEY').catch(() => '');
  if (!apiKey) return { advanced: false, reason: 'no api key' };
  await advanceTask(env, apiKey, task);
  return { advanced: true };
}

async function reviewWithKimi(env: Pick<Env, 'AI_GATEWAY_TOKEN' | 'GUARDIAN'>, title: string, revisionJson: string): Promise<{ satisfied: boolean; feedback: string }> {
  const workersai = createGuardianWorkersAI(env);
  const { text } = await generateText({
    model: workersai(REVIEW_MODEL as any),
    system: 'You are the codra orchestrator. Judge plans strictly and reply only with the requested JSON block.',
    prompt: buildReviewPrompt({ title, revisionJson }),
  });
  return parseReviewVerdict(text);
}

/** Give Jules the full Cloudflare docs for a query — Jules' 1M context can hold it. */
async function docsForJules(query: string): Promise<string> {
  const docs = await searchCloudflareDocs(query, { maxChars: DOCS_FOR_JULES_MAX });
  return docs ? `\n\n--- Cloudflare documentation (use this to stay correct) ---\n${docs}` : '';
}

/** Exactly one bounded step for one task. No loops, no blocking waits. */
async function advanceTask(
  env: PollerEnv, apiKey: string, task: OrchestrationTaskRow,
): Promise<void> {
  if (!task.session_id) return;
  const pkg = await getPackage(env, task.package_id);
  if (!pkg) { await updateTaskStatus(env, task.task_id, { status: 'failed', error: 'package missing' }); return; }

  const snap = await getJulesSnapshot(apiKey, task.session_id);

  // Cache the activity snapshot for the monitoring dashboard (dedup by activity id),
  // so browser refreshes are cheap D1 reads and never hit the Jules API.
  await upsertActivities(env, { sessionId: task.session_id, taskId: task.task_id, activities: snap.activities })
    .catch((err) => logger.warn(`activity cache failed for ${task.task_id}`, { error: err instanceof Error ? err.message : String(err) }));

  // A PR means the plan session went to code (rare for plan-only) — record and stop polling.
  if (snap.prUrl) {
    await updateTaskStatus(env, task.task_id, { status: 'pr_ready', lastPrUrl: snap.prUrl });
    await logTaskEvent(env, task.task_id, 'PR_CREATED', { url: snap.prUrl });
    return;
  }

  const message = extractLatestAgentMessage(snap.activities);
  const parsed = message ? parsePlanFromText(message) : null;
  const verdict = parsed?.ok ? await reviewWithKimi(env, pkg.title, JSON.stringify(parsed.input)) : null;

  const action = decideNextAction({
    state: snap.state, parsed, verdict, iterations: task.iterations, maxIterations: MAX_ITERATIONS,
  });

  // Capture every parseable plan as an immutable revision first — nothing is lost.
  if (parsed?.ok && message) {
    await upsertRevision(env, task.package_id, {
      ...parsed.input, source: 'jules', julesSessionId: task.session_id, status: 'proposed', contextText: message,
    });
  }

  switch (action.kind) {
    case 'accept': {
      const revs = await listRevisions(env, task.package_id);
      const latest = revs[revs.length - 1];
      if (latest) await acceptRevision(env, task.package_id, latest.id);
      await updateTaskStatus(env, task.task_id, { status: 'accepted' });
      await logTaskEvent(env, task.task_id, 'ACCEPTED', { revisionId: latest?.id });
      return;
    }
    case 'improve': {
      await incrementTaskIteration(env, task.task_id);
      const docs = await docsForJules(`${pkg.title} ${action.feedback}`.slice(0, 300));
      await sendJulesLogged(env, apiKey, { sessionId: task.session_id, kind: 'improve', text: buildImprovePrompt(action.feedback) + docs });
      await updateTaskStatus(env, task.task_id, { status: 'plan_review' });
      await logTaskEvent(env, task.task_id, 'IMPROVE_REQUESTED', { feedback: action.feedback });
      return;
    }
    case 'answer': {
      await incrementTaskIteration(env, task.task_id);
      const question = message ?? pkg.title;
      const docs = await docsForJules(question.slice(0, 300));
      await sendJulesLogged(env, apiKey, { sessionId: task.session_id, kind: 'answer',
        text: `Here is documentation to unblock you.${docs}\n\nContinue with the plan and emit the planningPackage JSON block.` });
      await updateTaskStatus(env, task.task_id, { status: 'executing' });
      await logTaskEvent(env, task.task_id, 'CLARIFIED', { question: question.slice(0, 200) });
      return;
    }
    case 'stuck': {
      await updateTaskStatus(env, task.task_id, { status: 'stuck', error: action.reason });
      await logTaskEvent(env, task.task_id, 'STUCK', { reason: action.reason });
      return;
    }
    case 'wait':
      return;
  }
}

export { getTaskByToken };
