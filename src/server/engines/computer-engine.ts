import type { EngineReviewResult, ReviewContext, ReviewEngine, ReviewerUsage } from '@server/core/review-engine';
import type { ParsedReviewComment } from '@shared/schema';
import type { FileDiff } from '@server/core/diff';
import type { ReviewerDef } from '@server/prompts/reviewers';
import { parsedReviewCommentSchema } from '@shared/schema';
import { planReviewers } from '@server/core/reviewer-plan';
import { REVIEWERS, buildReviewerSystemPrompt } from '@server/prompts/reviewers';
import { logger } from '@server/core/logger';

/**
 * GitHub's tarball CDN (not the REST API host) — serves a repo's contents
 * at a given ref/sha as a `.tar.gz`, no auth needed for public repos.
 * A private-repo Authorization header is a `populateFromTarball` concern
 * for the real factory once it's actually wired (see RealComputerWorkspaceFactory).
 */
const GITHUB_CODELOAD_HOST = 'https://codeload.github.com';

/**
 * What ComputerEngine needs from a `@cloudflare/computer` `Workspace`.
 * Deliberately narrower than the real package's `WorkspaceClient` (fs/git/
 * runtime/assets/artifacts) — this is the adapter surface, dependency-
 * injected so the engine compiles and is fully unit-testable whether or
 * not `@cloudflare/computer`'s actual DO/container binding is provisioned.
 */
export interface ComputerWorkspace {
  /** Fills the SQLite VFS from the repo tarball at `pr.head.sha`. */
  populateFromTarball(url: string): Promise<void>;
  readFile(path: string): Promise<string | null>;
  exec(cmd: string, opts?: { backend?: 'isolate' | 'container' }): Promise<{ stdout: string; exitCode: number }>;
}

export interface ComputerWorkspaceFactory {
  /** Constructs a Workspace on the DO, keyed by e.g. `owner/repo/pr/sha`. */
  create(env: Env, key: string): Promise<ComputerWorkspace>;
  /** Whether the `@cloudflare/computer` DO/container binding is present. */
  isAvailable(env: Env): boolean;
}

/**
 * Bindings for the real `@cloudflare/computer` integration. Not part of the
 * generated `Env` type (mirrors OpenCodeClient's defensive-bindings pattern
 * in opencode-client.ts) — provisioning the actual Durable Object plus an
 * exec backend (a Container running `computerd`, or the worker-shell/
 * worker-javascript backends behind the `experimental` compatibility flag)
 * is an ops/runbook step, not something this engine wires unilaterally.
 * The npm package itself ships as preview-only ("NOT suitable for
 * production use" per its README), reinforcing that this is a deliberate
 * gate, not an oversight.
 */
type ComputerBindings = {
  COMPUTER_WORKSPACE?: unknown;
};

// ponytail: `@cloudflare/computer` is intentionally NOT a dependency here —
// nothing imports it (this whole file is adapter-typed), and it's an
// `unreleased`-tagged preview package that drags native transitive deps
// (@mongodb-js/zstd, node-liblzma via just-bash). When COMPUTER_WORKSPACE
// is actually provisioned in wrangler.jsonc, wire `create()` with a
// DYNAMIC `import('@cloudflare/computer')` INSIDE this method (already
// gated behind the isAvailable() check above, so it only ever loads when
// the binding is real) and add `@cloudflare/computer` to
// `optionalDependencies` at that point — so its resolution/native-build
// can never break `npm install`/CI for everyone else. Real wiring: a DO
// class extending `withWorkspace`, `getWorkspace(stub)`, tarball
// extraction into `ws.fs`. Until then `create` is unreachable in prod.
export class RealComputerWorkspaceFactory implements ComputerWorkspaceFactory {
  isAvailable(env: Env): boolean {
    return !!(env as unknown as ComputerBindings).COMPUTER_WORKSPACE;
  }

  async create(env: Env, _key: string): Promise<ComputerWorkspace> {
    if (!this.isAvailable(env)) {
      throw new Error('COMPUTER_WORKSPACE binding not configured');
    }
    throw new Error('COMPUTER_WORKSPACE binding present but Workspace wiring is not implemented yet');
  }
}

export class ComputerEngineError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
    this.name = 'ComputerEngineError';
  }
}

export function isRetryableComputerEngineError(err: unknown): boolean {
  return err instanceof ComputerEngineError && err.retryable;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type ComputerReviewerRunResult = {
  /** Raw candidate findings — validated against parsedReviewCommentSchema
   *  by the engine before being included in the result. */
  findings: unknown[];
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

/**
 * Runs one specialized reviewer against one file, with read access to the
 * populated workspace (so it can inspect real source, not just the diff
 * hunk). The actual model+tool orchestration through `@cloudflare/computer`
 * (giving the reviewer read/ls/exec+git tools via `createAITools`) is
 * infra-dependent and lands in a follow-up task; this seam is what makes
 * that swap-in possible without touching `reviewPullRequest`.
 */
export type ComputerReviewerRunner = (args: {
  reviewer: ReviewerDef;
  systemPrompt: string;
  file: FileDiff;
  workspace: ComputerWorkspace;
}) => Promise<ComputerReviewerRunResult>;

const notConfiguredRunner: ComputerReviewerRunner = async () => {
  throw new ComputerEngineError(
    'ComputerEngine reviewer runner not configured — model+tool orchestration via @cloudflare/computer ships in a follow-up task',
    false,
  );
};

export class ComputerEngine implements ReviewEngine {
  readonly name = 'computer' as const;

  constructor(
    private readonly env: Env,
    private readonly factory: ComputerWorkspaceFactory = new RealComputerWorkspaceFactory(),
    private readonly reviewerRunner: ComputerReviewerRunner = notConfiguredRunner,
  ) {}

  async healthCheck(_signal?: AbortSignal): Promise<boolean> {
    try {
      if (!this.factory.isAvailable(this.env)) return false;
      await this.factory.create(this.env, '__healthcheck__');
      return true;
    } catch {
      return false;
    }
  }

  async reviewPullRequest(ctx: ReviewContext): Promise<EngineReviewResult> {
    // Connectivity/availability failures throw retryable — the caller
    // (resolveEngine's delegation branch, Task 5) trips the breaker and
    // falls back to native. Returning an empty result here would look like
    // "reviewed, found nothing" instead of "couldn't reach Computer".
    if (!this.factory.isAvailable(this.env)) {
      throw new ComputerEngineError('computer engine not available: binding missing', true);
    }

    const sha = ctx.pr.head?.sha;
    if (!sha) {
      throw new ComputerEngineError('PR head sha missing; cannot populate workspace', false);
    }

    const key = `${ctx.job.owner}/${ctx.job.repo}/${ctx.job.prNumber}/${sha}`;
    let workspace: ComputerWorkspace;
    try {
      workspace = await this.factory.create(this.env, key);
    } catch (err) {
      throw new ComputerEngineError(`failed to create workspace: ${describeError(err)}`, true);
    }

    const tarballUrl = `${GITHUB_CODELOAD_HOST}/${ctx.job.owner}/${ctx.job.repo}/tar.gz/${sha}`;
    try {
      await workspace.populateFromTarball(tarballUrl);
    } catch (err) {
      throw new ComputerEngineError(`failed to populate workspace from tarball: ${describeError(err)}`, true);
    }

    const plan = planReviewers(ctx.totalLineCount, ctx.files.length, ctx.config.review);
    const comments: ParsedReviewComment[] = [];
    const perReviewer: ReviewerUsage[] = [];

    for (const file of ctx.files) {
      for (const id of plan) {
        const reviewer = REVIEWERS[id];
        const systemPrompt = buildReviewerSystemPrompt(reviewer, ctx.config.review);
        const result = await this.reviewerRunner({ reviewer, systemPrompt, file, workspace });

        let validatedCount = 0;
        for (const candidate of result.findings) {
          const parsed = parsedReviewCommentSchema.safeParse(candidate);
          if (!parsed.success) {
            logger.debug('ComputerEngine: skipping finding failing parsedReviewCommentSchema', {
              error: parsed.error.message,
            });
            continue;
          }
          comments.push(parsed.data);
          validatedCount++;
        }

        perReviewer.push({
          reviewer: id, file: file.path,
          inputTokens: result.inputTokens ?? 0, outputTokens: result.outputTokens ?? 0,
          cacheReadTokens: result.cacheReadTokens ?? 0, cacheWriteTokens: result.cacheWriteTokens ?? 0,
          findings: validatedCount,
        });
      }
    }

    return { comments, perReviewer };
  }
}
