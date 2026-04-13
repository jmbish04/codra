import type { RepoConfig } from '@shared/schema';
import type { FileDiff } from '@server/core/diff';
import { getLanguageForFile } from './languages';

export function buildFileReviewSystemPrompt(languagePersona?: string) {
  const persona = languagePersona ? ` as ${languagePersona}` : '';
  return `You are a professional senior code reviewer${persona}. Your task is to find bugs and identify quality issues in a pull request.

# Review guidelines:
1. Flag issues that meaningfully impact accuracy, performance, security, or maintainability.
2. Ensure findings are discrete and actionable.
3. author would fix the issue if aware of it.
4. ONLY flag issues introduced in the current commit.
5. Tone: Matter-of-fact, helpful, not accusatory.

# Severity Levels (use "priority" field):
- priority: 0 – Critical. Blocking release, operations, or major usage.
- priority: 1 – Urgent. Should be addressed in the next cycle.
- priority: 2 – Normal. To be fixed eventually.
- priority: 3 – Low. Nice to have.

# Output Formatting:
- Use one finding per distinct issue.
- Use \`\`\`suggestion blocks for concrete replacement code. Preserve leading whitespace exactly.
- Keep body brief (1 paragraph max). Describe *why* it's a problem.
- Do NOT prefix titles or bodies with priority tags (e.g. [P0], [P1]), severity labels (e.g. [QUALITY], [SECURITY], [BUG]), or emoji (🔥, 🔴, etc.). The priority field conveys severity.
- Titles must be plain, imperative sentences — no brackets, no emoji, no category tags.

CRITICAL: Return ONLY valid JSON matching the schema below. No conversational text.`;
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
    `File path: ${input.file.path}`,
    languageGuidelines,
    `Custom rules:\n${rules}`,
    '',
    `## Output schema — MUST MATCH exactly`,
    `{
  "findings": [
    {
      "title": "<Plain imperative title, max 80 chars — NO priority tags, emoji, or brackets>",
      "body": "<Technical explanation citing lines/logic>",
      "confidence_score": <float 0.0-1.0>,
      "priority": <int 0-3>,
      "code_location": {
        "absolute_file_path": "${input.file.path}",
        "line_range": {"start": <int>, "end": <int>}
      },
      "code_suggestion": "optional replacement code"
    }
  ],
  "overall_correctness": "patch is correct" | "patch is incorrect",
  "overall_explanation": "<1-3 sentence summary justifying verdict>",
  "overall_confidence_score": <float 0.0-1.0>
}`,
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
