import { z } from 'zod';
import type { RevisionInput } from '@server/db/planning-packages';

/**
 * Pure orchestration logic for the PlanAgent DO — prompt builders and parsers,
 * with no I/O so they are unit-testable. The DO wires these to Jules and the
 * review model.
 *
 * The contract with Jules: it must emit ONE fenced ```json block whose
 * `planningPackage` matches the shape below. We parse the LAST such block.
 */

export type PlanPhase = 'idle' | 'planning' | 'reviewing' | 'merging' | 'accepted' | 'failed';

// The plan block Jules emits — RevisionInput minus `source` (the DO sets that).
const planBlockSchema = z.object({
  summary: z.string().optional(),
  problem: z.string().optional(),
  approach: z.string().optional(),
  verification: z.string().optional(),
  prdMarkdown: z.string().optional(),
  designBriefMarkdown: z.string().optional(),
  promptMarkdown: z.string().optional(),
  changeItems: z.array(z.object({ kind: z.string(), text: z.string() })).optional(),
  tasks: z.array(z.object({
    taskKey: z.string(), workstream: z.string().optional(), phase: z.number().optional(),
    title: z.string(), description: z.string().optional(), targetPath: z.string().optional(),
    changeType: z.string().optional(), dependsOn: z.array(z.string()).optional(),
  })).optional(),
  fileChanges: z.array(z.object({ path: z.string(), changeType: z.string(), note: z.string().optional() })).optional(),
  codeCards: z.array(z.object({ filePath: z.string().optional(), language: z.string().optional(), intent: z.string().optional(), content: z.string() })).optional(),
  apiChanges: z.array(z.object({ method: z.string(), path: z.string(), description: z.string().optional() })).optional(),
  migrations: z.array(z.object({ tag: z.string().optional(), sql: z.string() })).optional(),
  diagrams: z.array(z.object({ caption: z.string().optional(), mermaid: z.string() })).optional(),
});

export type PlanBlock = z.infer<typeof planBlockSchema>;

const CONTRACT = `Emit exactly ONE fenced code block tagged \`json\` containing an object with a single top-level key "planningPackage". Shape:
{"planningPackage": {
  "summary": string, "problem": string, "approach": string, "verification": string,
  "prdMarkdown": string, "designBriefMarkdown": string, "promptMarkdown": string,
  "changeItems": [{"kind": "add|modify|delete", "text": string}],
  "tasks": [{"taskKey": string, "workstream": string, "phase": number, "title": string, "description": string, "targetPath": string, "changeType": string, "dependsOn": [string]}],
  "fileChanges": [{"path": string, "changeType": "add|modify|delete", "note": string}],
  "codeCards": [{"filePath": string, "language": string, "intent": string, "content": string}],
  "apiChanges": [{"method": string, "path": string, "description": string}],
  "migrations": [{"tag": string, "sql": string}],
  "diagrams": [{"caption": string, "mermaid": string}]
}}
RULES: Put the FULL content in each codeCards.content and migrations.sql — never abbreviate with "...", "unchanged", or elisions. Every field is optional but include everything you can. Output nothing after the JSON block.`;

/** Short kickoff used as the session's initial prompt; the real ask carries the contract. */
export function buildKickoffPrompt(owner: string, repo: string): string {
  return `You are planning a feature for ${owner}/${repo}. Study the codebase. When asked, produce a detailed implementation plan.`;
}

export function buildPlanningPrompt(input: { title: string; requestPrompt?: string | null }): string {
  return [
    `Produce a complete implementation plan for this feature: "${input.title}".`,
    input.requestPrompt ? `\nFeature request details:\n${input.requestPrompt}` : '',
    `\nReview the actual code so the plan is concrete: exact file paths, real code in code cards, real SQL in migrations.`,
    `\n${CONTRACT}`,
  ].join('');
}

export function buildImprovePrompt(feedback: string): string {
  return [
    `The plan needs improvement before it can be accepted:`,
    feedback,
    `\nProduce the FULL revised plan again (not a diff). ${CONTRACT}`,
  ].join('\n');
}

export function buildMergePrompt(input: { exportUrl: string; planIds: string[] }): string {
  const curl = `curl -sX POST '${input.exportUrl}' -H 'content-type: application/json' -d '${JSON.stringify({ planIds: input.planIds })}'`;
  return [
    `Merge every revision of these planning packages into one lossless super-plan.`,
    `Pull the full fielded content (all revisions) with:`,
    `\n${curl}\n`,
    `Reconcile across all revisions so NOTHING is lost — if two revisions disagree, keep the most complete content; never drop a code card, task, or migration that appeared in any revision.`,
    `Then emit the merged result. ${CONTRACT}`,
  ].join('\n');
}

/** Extract and validate the LAST ```json planningPackage block from agent text. */
export function parsePlanFromText(text: string): { ok: true; input: Omit<RevisionInput, 'source'> } | { ok: false; reason: string } {
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  if (matches.length === 0) return { ok: false, reason: 'no ```json block found' };
  const raw = matches[matches.length - 1][1].trim();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch (e) { return { ok: false, reason: `invalid JSON: ${String(e)}` }; }
  const wrapped = (parsed as { planningPackage?: unknown })?.planningPackage ?? parsed;
  const result = planBlockSchema.safeParse(wrapped);
  if (!result.success) return { ok: false, reason: `schema mismatch: ${result.error.issues.map((i) => i.path.join('.')).join(', ')}` };
  return { ok: true, input: result.data };
}

const reviewSchema = z.object({ satisfied: z.boolean(), feedback: z.string().default('') });

export function buildReviewPrompt(input: { title: string; revisionJson: string }): string {
  return [
    `You are the codra orchestrator reviewing a proposed implementation plan for "${input.title}".`,
    `Reject it if: code cards or migrations contain "...", "unchanged", or other elisions instead of full content; tasks are vague; the approach is incomplete; or it does not actually address the request.`,
    `\nPlan (JSON):\n${input.revisionJson}`,
    `\nReply with exactly one fenced \`json\` block: {"satisfied": boolean, "feedback": string}. feedback must be actionable when satisfied is false.`,
  ].join('\n');
}

export function parseReviewVerdict(text: string): { satisfied: boolean; feedback: string } {
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  const raw = matches.length ? matches[matches.length - 1][1].trim() : text.trim();
  try {
    const v = reviewSchema.safeParse(JSON.parse(raw));
    if (v.success) return v.data;
  } catch { /* fall through */ }
  // Conservative default: if the reviewer's output is unparseable, treat as not satisfied
  // so the loop asks Jules to try again rather than accepting an unvetted plan.
  return { satisfied: false, feedback: 'Review output was unparseable; regenerate the full plan.' };
}
