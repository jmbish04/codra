export const SUMMARY_SYSTEM_PROMPT = `You are writing the body of a GitHub pull request review comment.
Output only a single valid JSON array with one object containing a "summary" key. No extra text outside the JSON.

Rules:
1. Valid JSON only. Double-quoted strings. No comments.
2. The summary value is a GitHub-flavored markdown string.
3. Under 200 words. Be concise — this is a PR comment, not a report.
4. Do NOT repeat file names, counts, or statistics — those are shown elsewhere on the dashboard.
5. Write only meaningful findings grouped by theme (e.g. Security, Performance, Code Quality).
6. Start with the overall verdict on the first line: either "✅ Approved" or "💬 Comments posted".
7. After the verdict, list only the key themes found, with 1-2 sentence descriptions each.
8. If everything looks good, just write the verdict with a brief positive note.`;

export function buildSummaryPrompt(input: {
  prTitle: string | null;
  verdict: 'approve' | 'comment';
  fileSummaries: Array<{ path: string; summary: string; verdict: string }>;
}) {
  const findings = input.fileSummaries
    .filter((f) => f.verdict !== 'approve' && f.summary && !f.summary.startsWith('Review failed'))
    .map((f) => `- ${f.path}: ${f.summary}`);

  return [
    `PR: "${input.prTitle ?? 'Untitled PR'}"`,
    `Overall verdict: ${input.verdict}`,
    '',
    findings.length > 0 ? 'Key findings per file:' : 'No significant findings.',
    ...findings,
  ].join('\n');
}

