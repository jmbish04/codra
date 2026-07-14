import { getDb, parseJsonColumn } from './client';
import { repositories, webhookDeliveries } from './schemas';
import { eq, and } from 'drizzle-orm';

export async function recordWebhookDelivery(
  env: Pick<Env, 'DB'>,
  input: {
    deliveryId: string;
    eventName: string;
    owner: string | null;
    repo: string | null;
    payload: unknown;
  },
) {
  const db = getDb(env);
  let repositoryId: number | null = null;

  if (input.owner && input.repo) {
    const repoRow = await db.select({ id: repositories.id })
      .from(repositories)
      .where(and(eq(repositories.owner, input.owner), eq(repositories.repo, input.repo)))
      .limit(1)
      .get();
    if (repoRow) {
      repositoryId = repoRow.id;
    }
  }

  const result = await db.insert(webhookDeliveries)
    .values({
      delivery_id: input.deliveryId,
      event_name: input.eventName,
      repository_id: repositoryId,
      payload: input.payload,
    })
    .onConflictDoNothing()
    .returning({ id: webhookDeliveries.id });

  return result.length > 0;
}

export async function getWebhookDelivery(
  env: Pick<Env, 'DB'>,
  deliveryId: string,
) {
  const db = getDb(env);
  const row = await db.select({
    delivery_id: webhookDeliveries.delivery_id,
    event_name: webhookDeliveries.event_name,
    payload: webhookDeliveries.payload,
  })
  .from(webhookDeliveries)
  .where(eq(webhookDeliveries.delivery_id, deliveryId))
  .limit(1)
  .get();

  return row ? { ...row, payload: parseJsonColumn(row.payload, null) } : null;
}
