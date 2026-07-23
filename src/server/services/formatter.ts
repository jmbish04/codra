import type { ParsedReviewComment } from '@shared/schema';

export class FormatterService {
  private baseUrl: string;
  constructor(baseUrl: string) {
    // Normalize once so every `${this.baseUrl}/path` avoids a double slash.
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  toReviewEvent(verdict: 'approve' | 'comment') {
    return verdict === 'approve' ? 'APPROVE' as const : 'COMMENT' as const;
  }

  severityIcon(severity: ParsedReviewComment['severity']) {
    const iconBase = `${this.baseUrl}/icons`;
    const img = (name: string, alt: string) =>
      `<img src="${iconBase}/${name}-icon.svg" width="20" height="20" alt="${alt}" style="vertical-align:middle" />`;
    switch (severity) {
      case 'P0':  return img('p0',  'P0');
      case 'P1':  return img('p1',  'P1');
      case 'P2':  return img('p2',  'P2');
      case 'P3':  return img('p3',  'P3');
      case 'nit': return img('nit', 'nit');
      default:    return '⚪';
    }
  }

  /** Strip leading emoji / legacy tag prefixes from a string (same logic as model-output cleanText). */
  stripLeadingTags(text: string): string {
    let current = text.trim();
    let prev = '';
    while (current !== prev) {
      prev = current;
      current = current
        .replace(/^([\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}]|\[QUALITY\]|\[SECURITY\]|\[BUG\]|\[P[0-3]\]|\[NIT\]|QUALITY|SECURITY|BUG|P[0-3]|NIT|[:\-\s\uFE0F]|[^\w\s])+/giu, '')
        .trim();
    }
    return current;
  }

  formatInlineComment(comment: ParsedReviewComment) {
    // Clean the body: strip any residual prefix tags, then remove a leading line
    // that duplicates the title (can happen with stale DB records).
    let body = this.stripLeadingTags(comment.body);
    const firstLine = body.split('\n')[0].trim();
    const cleanFirstLine = this.stripLeadingTags(firstLine);
    if (
      cleanFirstLine.toLowerCase().startsWith(comment.title.toLowerCase()) ||
      comment.title.toLowerCase().startsWith(cleanFirstLine.toLowerCase())
    ) {
      body = body.slice(firstLine.length).replace(/^[\n\r]+/, '');
    }

    return `${this.severityIcon(comment.severity)} <strong>${comment.title}</strong>\n\n${body}`;
  }

  summarizeVerdict(comments: ParsedReviewComment[], hasFailures: boolean) {
    const p0 = comments.filter((c) => c.severity === 'P0').length;
    const p1 = comments.filter((c) => c.severity === 'P1').length;
    const p2 = comments.filter((c) => c.severity === 'P2').length;

    if (p0 > 0 || p1 > 0 || hasFailures || p2 > 0) {
      return { verdict: 'comment' as const, errors: p0 + p1, warnings: p2 };
    }

    return { verdict: 'approve' as const, errors: 0, warnings: 0 };
  }

  formatReviewOverview(commitSha: string, botUsername: string) {
    const shortSha = commitSha.slice(0, 10);

    return `### Codra Review

Here are some automated review suggestions for this pull request.

**Reviewed commit:** \`${shortSha}\`
${this.commandFooter(botUsername)}`;
  }

  /** Direct link to a review job's live progress in the Codra dashboard. */
  jobUrl(jobId: string) {
    return `${this.baseUrl}/jobs/${jobId}`;
  }

  /**
   * Standard collapsed footer for main-PR comments (status comment and review
   * overview). NOT used on inline code comments. Walks through how to invoke
   * Codra and links to the configuration and help surfaces.
   */
  commandFooter(botUsername: string) {
    const mention = `@${botUsername}`;
    return `
<details>
<summary><b>Using Codra</b></summary>
<br>

Codra reviews pull requests automatically and responds when you mention it. Reviews run when you **open** a PR, **mark** a draft ready, or **comment** to trigger one. Below are the supported commands.

Feature | Command | Description
--- | --- | ---
Code Review | \`${mention} review\` | Reviews the pull request in its current state.
Follow-up | \`${mention} address that feedback\` | Ask Codra to act on the review feedback or answer a question.
Mention | ${mention} | Responds when explicitly tagged in a pull request comment.

<b>Configuration</b>

Repository maintainers can enable/disable Codra, choose models, and tune review behavior on the [repository settings page](${this.baseUrl}/repos). Global model and provider settings live on the [settings page](${this.baseUrl}/settings).

<b>Help & feedback</b>

See the [full list of commands](${this.baseUrl}/commands), the [dashboard](${this.baseUrl}/dashboard) for every review job and its live progress, or the [setup guide](${this.baseUrl}/setup) to configure a repository. Codra can make mistakes — react with :thumbsup: / :thumbsdown: on its comments to leave feedback.
</details>`;
  }
}
