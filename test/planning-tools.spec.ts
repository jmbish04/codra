import { describe, it, expect, beforeEach } from 'vitest';
import {
  mcpListPlanningPackages, mcpGetPlanningPackage, mcpGetPlanningRevision,
  mcpCreatePlanningPackage, mcpSubmitPlanningRevision, mcpExportPlanningPackages,
  mcpUpdatePlanTask,
} from '@server/mcp/planning-tools';
import { createTestEnv } from './helpers';

describe('planning MCP tool handlers', () => {
  let env: Env;
  beforeEach(() => { env = createTestEnv(); });

  it('creates, submits a revision, reads across revisions, and updates a task', async () => {
    const { package: pkg } = await mcpCreatePlanningPackage(env, { repositoryId: 1, title: 'Feature ABC', promptMarkdown: '# plan' });
    expect(pkg.slug).toBe('feature-abc');
    expect(pkg.request_prompt_json).toBe('# plan');

    const sub = await mcpSubmitPlanningRevision(env, pkg.id, {
      source: 'coding_agent',
      codeCards: [{ content: 'export const a = 1;' }],
      tasks: [{ taskKey: 'T1', title: 'do a' }],
      contextText: 'RAW DUMP',
    });
    expect('revision' in sub && sub.revision.revisionNumber).toBe(1);

    const list = await mcpListPlanningPackages(env, { repo: 1, status: 'draft' });
    expect(list.packages).toHaveLength(1);

    // summaries only by default
    const summary = await mcpGetPlanningPackage(env, { packageId: pkg.id });
    expect('revisions' in summary && summary.revisions).toHaveLength(1);

    // full + inlined context
    const full = await mcpGetPlanningPackage(env, { packageId: pkg.id, includeRevisions: true, includeContext: true });
    expect('context' in full && full.context?.['1']).toBe('RAW DUMP');

    const rev = await mcpGetPlanningRevision(env, { packageId: pkg.id, revisionNumber: 1 });
    expect('revision' in rev && rev.revision.codeCards[0].content).toBe('export const a = 1;');

    const upd = await mcpUpdatePlanTask(env, { packageId: pkg.id, taskKey: 'T1', status: 'in_progress', assignee: 'agent-x' });
    expect('ok' in upd && upd.ok).toBe(true);
    const after = await mcpGetPlanningPackage(env, { packageId: pkg.id });
    expect('tasks' in after && after.tasks.find((t) => t.task_key === 'T1')).toMatchObject({ status: 'in_progress', assignee: 'agent-x' });
  });

  it('exports fielded packages for Jules and reports not_found for unknown ids', async () => {
    const { package: pkg } = await mcpCreatePlanningPackage(env, { repositoryId: 1, title: 'ABC' });
    await mcpSubmitPlanningRevision(env, pkg.id, { source: 'jules', problem: 'P' });

    const out = await mcpExportPlanningPackages(env, { planIds: [pkg.id, 'nope'] });
    expect(out.packages).toHaveLength(1);
    expect(out.packages[0].revisions[0].problem).toBe('P');

    expect(await mcpGetPlanningPackage(env, { packageId: 'nope' })).toEqual({ error: 'not_found' });
    expect(await mcpSubmitPlanningRevision(env, 'nope', { source: 'jules' })).toEqual({ error: 'not_found' });
    expect(await mcpUpdatePlanTask(env, { packageId: 'nope', taskKey: 'T1', status: 'done' })).toEqual({ error: 'not_found' });
  });
});
