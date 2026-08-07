import { sanitizeForPrompt } from '@server/core/prompt-safety';
import type { RepoConfig } from '@shared/schema';

export function buildSharedContext(input: {
  pr: { title: string | null; body: string | null };
  config: RepoConfig;
  projectContext: string;
}): string {
  const rules = input.config.review.custom_rules.map((r) => `- ${sanitizeForPrompt(r)}`).join('\n') || '- None';
  return [
    '=== SHARED PR CONTEXT ===',
    `Title: ${sanitizeForPrompt(input.pr.title) || 'Untitled PR'}`,
    `Description: ${sanitizeForPrompt(input.pr.body) || '(none)'}`,
    'Custom rules:', rules,
    input.projectContext ? `Project context:\n${sanitizeForPrompt(input.projectContext)}` : '',
    '=== END SHARED PR CONTEXT ===',
  ].filter(Boolean).join('\n');
}
