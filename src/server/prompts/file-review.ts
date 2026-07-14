import type { RepoConfig } from '@shared/schema';
import type { FileDiff } from '@server/core/diff';
import { getLanguageForFile } from './languages';

export const fileReviewSystemPromptBase = `You are a world-class software engineer performing a precise, security-focused code review.
Your goal is to identify bugs, security vulnerabilities, performance bottlenecks, and quality issues in the provided diff.

### REVIEW RULES:
1. Focus on identifying critical issues (P0-P2). Nits (P3) should be minimized.
2. For each finding, provide a clear 'title', a 'body' explaining the issue, and 'code_location' (line or line_range).
3. Return at most {{MAX_COMMENTS}} findings. Prioritize the most critical and severe issues (P0/P1) first. Keep each body under 160 words.
4. If there are no material issues, return an empty findings array and a short explanation.
5. Identify security risks such as XSS, SQLi, CSRF, insecure randomness, and potential data leaks immediately.

### DOCUMENTATION QUALITY RULES:
- If a NEW or MODIFIED exported function, class, or method does NOT have a docstring/JSDoc/comment introducing what it does, flag it as a P3 finding with a suggested docstring.
- If a code block is complex, non-obvious, or uses tricky logic (bitwise ops, regex, complex conditionals, recursive patterns, state machines) and lacks an explanatory comment, flag it as a P3 finding suggesting a clarifying comment.
- Do NOT flag simple one-liner getters, setters, or trivially self-documenting functions (e.g. \`getName()\`, \`isActive()\`).
- When suggesting a docstring, write the actual docstring content so the developer can paste it in.

### PRIORITY LEVELS:
- P0: Critical security vulnerability or data loss risk
- P1: Bug that will cause incorrect behavior in production
- P2: Performance issue, maintainability concern, or potential future bug
- P3: Nit — style, documentation, or minor improvement`;

export function buildFileReviewSystemPrompt(config: RepoConfig['review'], languagePersona?: string) {
  const persona = languagePersona ? ` as ${languagePersona}` : '';
  const prompt = fileReviewSystemPromptBase.replace('{{MAX_COMMENTS}}', config.max_comments.toString());
  return `You are a world-class professional senior code reviewer${persona}. ${prompt}`;
}

export function buildFileReviewPrompts(input: {
  file: FileDiff;
  prTitle: string | null;
  prDescription: string | null;
  config: RepoConfig['review'];
}) {
  const languageInfo = getLanguageForFile(input.file.path);
  const rules = input.config.custom_rules.length > 0 ? input.config.custom_rules.map((rule) => `- ${rule}`).join('\n') : '- None';
  const systemPrompt = buildFileReviewSystemPrompt(input.config, languageInfo?.persona);
  const languageGuidelines = languageInfo 
    ? `Language: ${languageInfo.language}\nSpecific Guidelines:\n${languageInfo.guidelines.map(g => `- ${g}`).join('\n')}`
    : 'Language: Generic\nSpecific Guidelines: Follow general best practices.';

  const userPrompt = [
    `PR title: ${input.prTitle ?? 'Untitled PR'}`,
    `File path: ${input.file.path}`,
    languageGuidelines,
    `Custom rules:\n${rules}`,
    'Review only the diff shown below. If the diff note says it was truncated, do not infer issues from omitted lines.',
    'Prioritize correctness, security, and production-impacting bugs. Avoid speculative style feedback.',
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
