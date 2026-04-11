import type { RepoConfig } from '@shared/schema';
import type { FileDiff } from '@server/core/diff';
import { getLanguageForFile } from './languages';

export function buildFileReviewSystemPrompt(languagePersona?: string) {
  const persona = languagePersona ? ` as ${languagePersona}` : '';
  return `You are a senior code reviewer for pull requests${persona}.
Return only valid JSON.
Do not use markdown fences.
Only comment on lines present in the diff.
Prefer actionable feedback.
Use severity values: error, warning, suggestion, nitpick.
Use category values: security, bugs, performance, correctness, quality.
Use file_verdict values: "approve" (no issues) or "comment" (has findings). Never use "request_changes".
When a fix is straightforward, provide code_suggestion without markdown fences.`;
}

export function buildFileReviewPrompts(input: {
  file: FileDiff;
  prTitle: string | null;
  prDescription: string | null;
  config: RepoConfig['review'];
}) {
  const languageInfo = getLanguageForFile(input.file.path);
  const focus = input.config.focus.join(', ');
  const rules = input.config.custom_rules.length > 0 ? input.config.custom_rules.map((rule) => `- ${rule}`).join('\n') : '- None';
  
  const systemPrompt = buildFileReviewSystemPrompt(languageInfo?.persona);
  const languageGuidelines = languageInfo 
    ? `Language: ${languageInfo.language}\nSpecific Guidelines:\n${languageInfo.guidelines.map(g => `- ${g}`).join('\n')}`
    : 'Language: Generic\nSpecific Guidelines: Follow general best practices.';

  const userPrompt = [
    `PR title: ${input.prTitle ?? 'Untitled PR'}`,
    `PR description: ${input.prDescription ?? 'No description provided.'}`,
    `File path: ${input.file.path}`,
    `Review focus: ${focus}`,
    languageGuidelines,
    `Custom rules:\n${rules}`,
    '',
    'Return JSON in this shape:',
    `{"comments":[{"line":42,"position":12,"side":"RIGHT","severity":"warning","category":"quality","title":"Short title","body":"Markdown explanation","code_suggestion":"optional replacement"}],"file_verdict":"comment","file_summary":"One-sentence summary."}`,
    '',
    'Unified diff:',
    renderFileDiff(input.file),
  ].join('\n');

  return { systemPrompt, userPrompt };
}

function renderFileDiff(file: FileDiff) {
  const lines = [`diff --git a/${file.previousPath ?? file.path} b/${file.path}`];
  for (const hunk of file.hunks) {
    lines.push(hunk.header);
    for (const line of hunk.lines) {
      const prefix = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' ';
      const left = line.oldLineNumber ?? '';
      const right = line.newLineNumber ?? '';
      lines.push(`${String(left).padStart(4, ' ')} ${String(right).padStart(4, ' ')} ${prefix}${line.content}`);
    }
  }

  if (file.isTruncated) {
    lines.push('');
    lines.push(`[NOTE: This diff has been truncated from ${file.originalLineCount} lines to ${file.lineCount} lines for brevity.]`);
  }

  return lines.join('\n');
}
