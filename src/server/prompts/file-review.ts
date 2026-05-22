import type { RepoConfig } from '@shared/schema';
import type { FileDiff } from '@server/core/diff';
import { getLanguageForFile } from './languages';

export const fileReviewSystemPrompt = `You are a world-class software engineer performing a precise, security-focused code review.
Your goal is to identify bugs, security vulnerabilities, performance bottlenecks, and quality issues in the provided diff.

### STRICT RULES:
1. Output MUST be valid JSON.
2. DO NOT output any conversational text before or after the JSON.
3. DO NOT output the reviewed source code, diff hunks, or TypeScript interfaces in your response.
4. Output EXACTLY ONE JSON object matching the schema below.
5. Focus on identifying critical issues (P0-P2). Nits (P3) should be minimized.
6. For each finding, provide a clear 'title', a 'body' explaining the issue, and 'code_location' (line or line_range).
7. Return at most 10 findings. Keep each body under 160 words.
8. If there are no material issues, return an empty findings array and a short explanation.

### SCHEMA FORMAT:
{
  "findings": [
    {
      "title": "<Plain title, NO tags/emoji>",
      "body": "<Explanation>",
      "priority": 0 | 1 | 2 | 3,
      "code_location": {
        "line": number,
        "line_range": { "start": number, "end": number }
      },
      "code_suggestion": "Optional replacement code"
    }
  ],
  "overall_explanation": "Summary",
  "overall_correctness": "patch is correct" | "patch is incorrect",
  "overall_confidence_score": number (0 to 1)
}

Identify security risks such as XSS, SQLi, CSRF, insecure randomness, and potential data leaks immediately.`;

export function buildFileReviewSystemPrompt(languagePersona?: string) {
  const persona = languagePersona ? ` as ${languagePersona}` : '';
  return `You are a world-class professional senior code reviewer${persona}. ${fileReviewSystemPrompt}`;
}

export function buildFileReviewPrompts(input: {
  file: FileDiff;
  prTitle: string | null;
  prDescription: string | null;
  config: RepoConfig['review'];
}) {
  const languageInfo = getLanguageForFile(input.file.path);
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
    'Review only the diff shown below. If the diff note says it was truncated, do not infer issues from omitted lines.',
    'Prioritize correctness, security, and production-impacting bugs. Avoid speculative style feedback.',
    '',
    `## Output JSON Schema (STRICTLY REQUIRED)`,
    `{
  "findings": [
    {
      "title": "<Plain title>",
      "body": "<Technical explanation>",
      "priority": <0|1|2|3>,
      "code_location": {
        "absolute_file_path": "${input.file.path}",
        "line": <int>,
        "line_range": {"start": <int>, "end": <int>}
      },
      "code_suggestion": "string"
    }
  ],
  "overall_correctness": "patch is correct" | "patch is incorrect",
  "overall_explanation": "Summary",
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
