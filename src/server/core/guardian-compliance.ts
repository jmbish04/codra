/**
 * @fileoverview Always-on core-guardian compliance check for pull requests.
 *
 * This runs on EVERY pull request Codra sees — opened / synchronize / reopened —
 * **regardless of the repo's review settings**. Its single job is a financial
 * guardrail: catch a PR that adds AI inference (any provider, any language) that
 * is NOT routed through core-guardian, and comment surgical instructions for
 * wiring it in. Skipping it — the way an opted-out review would — could let
 * through an app that hammers a provider and runs up a four-figure bill with no
 * budget cap or kill switch. That is the exact exposure guardian exists to close.
 *
 * The check is deliberately cheap and side-effect-light: fetch the PR diff, scan
 * the *added* lines for inference signatures, and post at most ONE comment per PR
 * (deduped via APP_KV) with:
 *   - the files where non-guardian inference was detected,
 *   - copy-paste integration steps (guardian base URL, OpenAI-compat mode),
 *   - a note when the inference targets a LOCAL model service (keep a guardian
 *     integration anyway, for usage comparison + instant cutover),
 *   - a nudge to record the guardian mandate in the project's AGENTS.md.
 *
 * It never throws into the webhook path and never blocks a review.
 */

import type { GitHubClient } from './github';
import { parseUnifiedDiff } from './diff';
import { logger } from './logger';

/** HTML marker so the comment is identifiable (and future-updatable). */
const COMMENT_MARKER = '<!-- codra:guardian-compliance -->';
/** Dedup TTL — one comment per PR is plenty; re-arm after 30 days. */
const DEDUP_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Paths we never scan — vendored code, lockfiles, and docs create noise. */
const SKIP_PATH = /(^|\/)(node_modules|dist|build|vendor|\.next|coverage)\/|(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$|\.(md|mdx|lock|snap)$/i;

/** The vendored guardian client itself is guardian-routed by definition. */
const GUARDIAN_SELF_PATH = /guardian-client|guardian-ai|guardian-workers-ai|guardian-compliance/i;

/**
 * Signatures that indicate a line performs (or wires) AI inference. Case-insensitive.
 * Kept broad on purpose — a false positive costs one comment; a false negative
 * could cost a runaway bill.
 */
const AI_INFERENCE_SIGNATURES: RegExp[] = [
  /\bfrom\s+['"]openai['"]/i, /\bnew\s+OpenAI\s*\(/, /api\.openai\.com/i, /chat\.completions/i,
  /@anthropic-ai\/sdk/i, /\bnew\s+Anthropic\s*\(/, /api\.anthropic\.com/i, /anthropic-version/i,
  /@google\/gener(ative|ai)/i, /generativelanguage\.googleapis\.com/i, /GoogleGenerativeAI/, /google\.generativeai/i, /\bgenai\b/i,
  /env\.AI\.run/i, /createWorkersAI/, /workers-ai-provider/i, /gateway\.ai\.cloudflare\.com/i,
  /@ai-sdk\//i, /\bfrom\s+['"]ai['"]/i, /\b(generateText|streamText|generateObject|streamObject)\s*\(/,
  /\bollama\b/i, /\bgroq\b/i, /together\.(ai|xyz)/i, /\breplicate\b/i, /\bcohere\b/i, /mistralai/i,
  /huggingface|hf\.co\/models/i, /bedrock-runtime/i, /aiplatform\.googleapis\.com/i,
];

/** Signatures that indicate the inference is already routed through core-guardian. */
const GUARDIAN_SIGNATURES: RegExp[] = [
  /core-guardian/i, /guardian\.hacolby/i, /ai-router\/run/i, /GuardianClient/, /runGuardianInference/, /createGuardianWorkersAI/, /guardian\.ai\.run/i,
];

/** Signatures that indicate the target is a LOCAL model service, not a paid API. */
const LOCAL_SERVICE_SIGNATURES: RegExp[] = [
  /\bollama\b/i, /localhost:11434/i, /127\.0\.0\.1:11434/, /:11434\b/, /lm[\s-]?studio/i, /text-generation-webui/i,
  /http:\/\/localhost/i, /http:\/\/127\.0\.0\.1/, /host\.docker\.internal/i,
];

function matchesAny(line: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(line));
}

export interface ComplianceFinding {
  file: string;
  snippet: string;
  local: boolean;
}

export interface ComplianceScan {
  /** Files with non-guardian AI inference (the ones we flag). */
  findings: ComplianceFinding[];
  /** True when the diff already references core-guardian anywhere. */
  guardianPresent: boolean;
  /** True when at least one finding targets a local model service. */
  anyLocal: boolean;
}

/**
 * Scans a unified diff's ADDED lines for AI-inference usage that is not routed
 * through core-guardian. Pure — this is the unit-testable core.
 */
export function scanDiffForCompliance(rawDiff: string): ComplianceScan {
  const files = parseUnifiedDiff(rawDiff);
  const findings: ComplianceFinding[] = [];
  let guardianPresent = false;
  const seenFiles = new Set<string>();

  for (const file of files) {
    if (SKIP_PATH.test(file.path) || GUARDIAN_SELF_PATH.test(file.path)) continue;

    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.kind !== 'add') continue;
        const content = line.content;

        if (matchesAny(content, GUARDIAN_SIGNATURES)) {
          guardianPresent = true;
          continue; // A guardian-routed line is compliant, not a finding.
        }

        // A local model service (Ollama, LM Studio, …) is AI inference too — its
        // own signature qualifies even without a hosted-provider signature.
        const isLocal = matchesAny(content, LOCAL_SERVICE_SIGNATURES);
        if ((matchesAny(content, AI_INFERENCE_SIGNATURES) || isLocal) && !seenFiles.has(file.path)) {
          seenFiles.add(file.path);
          findings.push({
            file: file.path,
            snippet: content.trim().slice(0, 160),
            local: isLocal,
          });
        }
      }
    }
  }

  // A guardian-routed line anywhere in the PR clears the whole PR: the author is
  // clearly wiring guardian in, and per-line precision would nag on refactors.
  const effectiveFindings = guardianPresent ? [] : findings;
  return {
    findings: effectiveFindings,
    guardianPresent,
    anyLocal: effectiveFindings.some((f) => f.local),
  };
}

/**
 * Builds the PR comment body from a non-empty scan. Uses template literals with
 * real newlines (never `.join('\n')`) so the markdown survives transport intact.
 */
export function buildComplianceComment(scan: ComplianceScan): string {
  const fileList = scan.findings
    .map((f) => `- \`${f.file}\`${f.local ? ' _(local model service)_' : ''} — \`${f.snippet}\``)
    .join('\n');

  const localNote = scan.anyLocal
    ? `

### You're calling a local model service

That's fine — but still add a core-guardian integration for it:

- **Track it.** Register local usage with guardian so you can compare local vs. hosted spend and latency in one place (\`POST /api/guardian/usage/register\`).
- **Make cutover instant.** Wire guardian as an available provider now, so if the local model ever stops cutting it, switching to a hosted model is a one-line change — no re-plumbing under deadline.`
    : '';

  return `${COMMENT_MARKER}
## 🛡️ core-guardian compliance — action needed

This PR adds **AI inference that does not route through core-guardian**. Every AI call in our fleet must go through the guardian proxy so spend is **metered, budget-capped, and killable** — a direct provider call is invisible to the budget and can run up a large bill with no circuit breaker.

**Detected in:**
${fileList}

### How to route it through core-guardian (surgical)

**1. OpenAI-style SDKs / OpenAI Agents** — point the client at guardian and pass the project:

\`\`\`ts
import { GuardianClient } from "./lib/guardian/guardian-client"; // vendor: see below
const g = GuardianClient.fromEnv(env); // needs GUARDIAN var + GUARDIAN_AI_TOKEN/GUARDIAN_API_KEY
const r = await g.ai.run({
  provider: "openai",        // or "anthropic" | "google-ai-studio" | "workers-ai"
  model: "gpt-4o-mini",
  importance: "medium",
  input: { messages: [{ role: "user", content: "…" }] }, // native provider body, no model field
});
// r.body is the provider's native response; r.tokens_in / r.tokens_out / r.cost_usd are metered.
\`\`\`

Vendor the client once:

\`\`\`bash
curl -fsSL --create-dirs -o src/lib/guardian/guardian-client.ts \\
  https://raw.githubusercontent.com/jmbish04/core-guardian/main/clients/ts/guardian-client.ts
\`\`\`

**2. Cloudflare Workers AI** — drop the \`env.AI\` binding and call \`POST /api/ai/workers-ai/{model}\` (or route it through \`ai-router\` as above) so the neuron spend is attributed.

**3. Compat mode** — if you can't swap the SDK, use the AI router's \`mode: "openai-compat"\`; the request/response stay OpenAI-shaped while guardian meters the call.

Contract (source of truth): https://core-guardian.hacolby.workers.dev/openapi.json
${localNote}

### Also update your \`AGENTS.md\`

Record the mandate so future agents keep to it — for example:

> **AI operations:** every AI inference routes through core-guardian
> (\`https://core-guardian.hacolby.workers.dev\`), project \`<your-project>\`,
> authenticated with \`GUARDIAN_AI_TOKEN\`. No direct provider calls or \`env.AI.run\`.

---
_This is an automated, always-on check from Codra and runs on every PR regardless of review settings. It does not block your PR._`;
}

/**
 * Runs the always-on guardian-compliance check for one PR. Idempotent (one
 * comment per PR via APP_KV), best-effort, and never throws into the caller.
 */
export async function runGuardianComplianceCheck(
  env: Pick<Env, 'APP_KV'>,
  gh: GitHubClient,
  target: { owner: string; repo: string; prNumber: number },
): Promise<{ flagged: boolean; skipped?: string }> {
  const { owner, repo, prNumber } = target;
  const dedupKey = `guardian-compliance:posted:${owner}/${repo}#${prNumber}`;

  try {
    if (await env.APP_KV.get(dedupKey)) {
      return { flagged: false, skipped: 'already_commented' };
    }

    const rawDiff = await gh.getPullRequestDiff(owner, repo, prNumber);
    const scan = scanDiffForCompliance(rawDiff);
    if (scan.findings.length === 0) {
      return { flagged: false, skipped: scan.guardianPresent ? 'guardian_present' : 'no_ai_inference' };
    }

    await gh.createIssueComment(owner, repo, prNumber, buildComplianceComment(scan));
    // Set the marker only AFTER a successful post so a failed post retries next push.
    await env.APP_KV.put(dedupKey, new Date().toISOString(), { expirationTtl: DEDUP_TTL_SECONDS });
    logger.info(`Guardian-compliance: flagged ${owner}/${repo}#${prNumber}`, {
      files: scan.findings.map((f) => f.file),
      anyLocal: scan.anyLocal,
    });
    return { flagged: true };
  } catch (err) {
    logger.warn(`Guardian-compliance check failed for ${owner}/${repo}#${prNumber}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return { flagged: false, skipped: 'error' };
  }
}
