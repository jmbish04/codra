import { Agent } from "agents";

/**
 * Per-repo Durable Object.
 *
 * Reviews are driven end to end by the review queue (see src/server/core/review.ts);
 * this DO no longer forks its own parallel review pipeline. It is kept because the
 * class is declared in wrangler.jsonc migrations and cannot be removed.
 */
export class RepoAgent extends Agent<any> {}
