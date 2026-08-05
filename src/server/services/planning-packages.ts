import { createRevision, type RevisionInput } from '@server/db/planning-packages';

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type UpsertRevisionInput = RevisionInput & {
  /** Raw transcript/context. Streamed to R2 (content-addressed); never inlined in D1. */
  contextText?: string | null;
  coverageNote?: string | null;
};

/**
 * Persist a new immutable revision. If `contextText` is supplied, it is written
 * to R2 at a content-addressed key (`planning/<pkg>/<sha256>.md`) — identical
 * content re-submitted maps to the same key, and each revision keeps its own
 * pointer, so no transcript is ever overwritten by a later revision.
 *
 * Shared by the HTTP route and the MCP `submit_planning_revision` tool.
 */
export async function upsertRevision(
  env: Pick<Env, 'DB' | 'PLANNING_ARTIFACTS'>, packageId: string, input: UpsertRevisionInput,
): Promise<{ id: string; revisionNumber: number }> {
  let context = input.context ?? null;
  if (input.contextText != null && input.contextText.length > 0) {
    const bytes = new TextEncoder().encode(input.contextText);
    const sha256 = toHex(await crypto.subtle.digest('SHA-256', bytes));
    const r2Key = `planning/${packageId}/${sha256}.md`;
    await env.PLANNING_ARTIFACTS.put(r2Key, bytes);
    context = { r2Key, bytes: bytes.byteLength, sha256, coverageNote: input.coverageNote ?? null };
  }
  return createRevision(env, packageId, { ...input, context });
}
