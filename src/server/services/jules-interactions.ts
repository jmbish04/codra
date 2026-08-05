import { sendJulesMessage } from '@server/services/jules';
import { recordInteraction, updateInteractionStatus, type InteractionKind } from '@server/db/jules-interactions';
import { logger } from '@server/core/logger';

/**
 * Send a message to a Jules session AND index it in `jules_interactions`, so
 * codra always knows what it has asked Jules to do and where it stands. Every
 * codra→Jules prompt should go through here.
 */
export async function sendJulesLogged(
  env: Pick<Env, 'DB'>, apiKey: string,
  input: { sessionId: string; kind: InteractionKind; text: string; repository?: string | null; prNumber?: number | null },
): Promise<{ ok: boolean; interactionId: string }> {
  const row = await recordInteraction(env, {
    sessionId: input.sessionId, repository: input.repository, prNumber: input.prNumber,
    kind: input.kind, text: input.text, direction: 'outbound', status: 'started',
  });
  try {
    await sendJulesMessage(apiKey, input.sessionId, input.text);
    await updateInteractionStatus(env, row.id, 'sent').catch(() => {});
    return { ok: true, interactionId: row.id };
  } catch (err) {
    // Guard the status write too — a failed send must not be masked by a DB error.
    await updateInteractionStatus(env, row.id, 'error', err instanceof Error ? err.message : String(err)).catch(() => {});
    logger.error(`sendJulesLogged failed for ${input.sessionId}`, err instanceof Error ? err : new Error(String(err)));
    return { ok: false, interactionId: row.id };
  }
}

/** Log that codra launched a session (the prompt is already sent by startJulesSession). */
export async function logLaunch(
  env: Pick<Env, 'DB'>, input: { sessionId: string; repository: string; prNumber?: number | null; text: string },
): Promise<void> {
  await recordInteraction(env, {
    sessionId: input.sessionId, repository: input.repository, prNumber: input.prNumber,
    kind: 'launch', text: input.text, direction: 'outbound', status: 'sent',
  }).catch(() => {});
}
