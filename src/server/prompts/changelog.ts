import type { ParsedReviewComment } from '@shared/schema';

export const CHANGELOG_SYSTEM_PROMPT = `You are a staff engineer writing the changelog entry for a pull request that was just reviewed.

Write for a developer who did not read the diff. Be concrete and specific — name the actual routes, tables, columns, and functions that changed. Never invent a change that is not in the diff.

Diagram rules (Mermaid source only, no markdown fences):
- If D1/SQL schema files or migrations changed, include an "erDiagram" showing the affected tables, their key columns, and the relations between them.
- If HTTP routes or MCP tools changed, include a "classDiagram" showing the affected surface and its methods/params.
- Use a "flowchart" only when the control flow itself is the point of the change.
- Emit no diagram at all rather than a vague or speculative one.
- Keep node labels plain: letters, numbers, spaces, dots, slashes, dashes. Never put HTML, script tags, URLs, or quotes in a label.

Code rules:
- Include only snippets that are genuinely new or significantly rewritten, taken from the diff.
- Keep each snippet under 40 lines and pick the part that carries the meaning.

Return only the structured object.`;

export interface ChangelogPromptInput {
  prTitle: string | null;
  prBody: string | null;
  headRef: string | null;
  baseRef: string | null;
  files: Array<{ path: string; summary: string | null; lineCount: number }>;
  diff: string;
  findings: ParsedReviewComment[];
}

/** Caps the diff so a large PR cannot blow the model's context window. */
const MAX_DIFF_CHARS = 60_000;

export function buildChangelogPrompt(input: ChangelogPromptInput) {
  const fileList = input.files
    .map((file) => `- ${file.path} (${file.lineCount} lines)${file.summary ? `: ${file.summary}` : ''}`)
    .join('\n');

  const findings = input.findings.length
    ? input.findings.map((f) => `- [${f.severity}] ${f.path}: ${f.title}`).join('\n')
    : 'None.';

  const diff = input.diff.length > MAX_DIFF_CHARS
    ? `${input.diff.slice(0, MAX_DIFF_CHARS)}\n\n[diff truncated at ${MAX_DIFF_CHARS} characters]`
    : input.diff;

  return [
    `Pull request: ${input.prTitle ?? 'Untitled'}`,
    input.headRef ? `Branch: ${input.headRef}${input.baseRef ? ` → ${input.baseRef}` : ''}` : '',
    input.prBody ? `\nDescription:\n${input.prBody}` : '',
    `\nFiles changed:\n${fileList}`,
    `\nReview findings:\n${findings}`,
    `\nUnified diff:\n${diff}`,
  ]
    .filter(Boolean)
    .join('\n');
}
