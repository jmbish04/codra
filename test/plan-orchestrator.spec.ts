import { describe, it, expect } from 'vitest';
import {
  buildPlanningPrompt, buildMergePrompt, buildReviewPrompt,
  parsePlanFromText, parseReviewVerdict,
  extractLatestAgentMessage, decideNextAction,
} from '@server/services/plan-orchestrator';

describe('plan-orchestrator pure logic', () => {
  it('parses a valid planningPackage json block (last one wins)', () => {
    const text = [
      'Here is an earlier draft:',
      '```json',
      '{"planningPackage": {"problem": "old"}}',
      '```',
      'Final plan:',
      '```json',
      '{"planningPackage": {"problem": "P", "codeCards": [{"content": "export const a = 1;"}], "tasks": [{"taskKey":"T1","title":"do a"}]}}',
      '```',
    ].join('\n');
    const res = parsePlanFromText(text);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.input.problem).toBe('P');
      expect(res.input.codeCards?.[0].content).toBe('export const a = 1;');
      expect(res.input.tasks?.[0].taskKey).toBe('T1');
    }
  });

  it('accepts an unwrapped object (no planningPackage key)', () => {
    const res = parsePlanFromText('```json\n{"problem":"direct"}\n```');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.input.problem).toBe('direct');
  });

  it('reports missing block and invalid json', () => {
    expect(parsePlanFromText('no code here').ok).toBe(false);
    expect(parsePlanFromText('```json\n{bad json}\n```').ok).toBe(false);
  });

  it('rejects a schema-invalid block (task missing title)', () => {
    const res = parsePlanFromText('```json\n{"planningPackage":{"tasks":[{"taskKey":"T1"}]}}\n```');
    expect(res.ok).toBe(false);
  });

  it('parses a review verdict and defaults to not-satisfied on garbage', () => {
    expect(parseReviewVerdict('```json\n{"satisfied":true,"feedback":""}\n```')).toEqual({ satisfied: true, feedback: '' });
    expect(parseReviewVerdict('```json\n{"satisfied":false,"feedback":"add real code"}\n```').satisfied).toBe(false);
    expect(parseReviewVerdict('the model rambled').satisfied).toBe(false);
  });

  it('planning prompt forbids elisions; merge prompt embeds the export curl', () => {
    const plan = buildPlanningPrompt({ title: 'Feature X', requestPrompt: 'do the thing' });
    expect(plan).toContain('never abbreviate');
    expect(plan).toContain('Feature X');

    const merge = buildMergePrompt({ exportUrl: 'https://app/api/public/planning-packages/export', planIds: ['id-1', 'id-2'] });
    expect(merge).toContain('curl -sX POST');
    expect(merge).toContain('id-1');
    expect(merge).toContain('NOTHING is lost');

    expect(buildReviewPrompt({ title: 'Feature X', revisionJson: '{}' })).toContain('elisions');
  });

  it('extracts the latest agent message', () => {
    expect(extractLatestAgentMessage([
      { type: 'agentMessaged', message: 'first' },
      { type: 'progressUpdated' },
      { type: 'agentMessaged', message: 'latest' },
    ])).toBe('latest');
    expect(extractLatestAgentMessage([])).toBeNull();
    expect(extractLatestAgentMessage(null)).toBeNull();
  });

  it('decides bounded poll actions with a hard circuit breaker', () => {
    const base = { iterations: 0, maxIterations: 3 };
    // circuit breaker trumps everything
    expect(decideNextAction({ ...base, iterations: 3, state: 'inProgress', parsed: { ok: true }, verdict: { satisfied: true, feedback: '' } }))
      .toEqual({ kind: 'stuck', reason: 'max review iterations reached' });
    // failed session
    expect(decideNextAction({ ...base, state: 'failed', parsed: null })).toEqual({ kind: 'stuck', reason: 'jules session failed' });
    // jules asked a question
    expect(decideNextAction({ ...base, state: 'awaitingUserFeedback', parsed: null })).toEqual({ kind: 'answer' });
    // good plan → accept
    expect(decideNextAction({ ...base, state: 'inProgress', parsed: { ok: true }, verdict: { satisfied: true, feedback: '' } })).toEqual({ kind: 'accept' });
    // bad plan → improve with feedback
    expect(decideNextAction({ ...base, state: 'inProgress', parsed: { ok: true }, verdict: { satisfied: false, feedback: 'add code' } }))
      .toEqual({ kind: 'improve', feedback: 'add code' });
    // completed with no plan → nudge for JSON
    expect(decideNextAction({ ...base, state: 'completed', parsed: { ok: false } }).kind).toBe('improve');
    // still working → wait
    expect(decideNextAction({ ...base, state: 'planning', parsed: null })).toEqual({ kind: 'wait' });
  });
});
