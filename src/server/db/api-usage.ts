import { getDb } from './client';
import { apiUsage } from './schemas';
import { sql } from 'drizzle-orm';
import { getSecretStoreBinding } from '@server/utils/secrets';
import { logger } from '@server/core/logger';

export interface ApiUsageLog {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  source: 'local' | 'gateway';
  gatewayId?: string;
  datetimeHour?: string;
}

export async function logApiUsage(
  env: { DB: D1Database },
  params: ApiUsageLog
) {
  const db = getDb(env);
  const totalTokens = params.promptTokens + params.completionTokens;
  const source = params.source;
  const gatewayId = params.gatewayId || '';
  const datetimeHour = params.datetimeHour || '';

  try {
    if (source === 'gateway') {
      await db.insert(apiUsage)
        .values({
          provider: params.provider,
          model: params.model,
          prompt_tokens: params.promptTokens,
          completion_tokens: params.completionTokens,
          total_tokens: totalTokens,
          source,
          gateway_id: gatewayId,
          datetime_hour: datetimeHour,
        })
        .onConflictDoUpdate({
          target: [apiUsage.source, apiUsage.provider, apiUsage.model, apiUsage.gateway_id, apiUsage.datetime_hour],
          set: {
            prompt_tokens: params.promptTokens,
            completion_tokens: params.completionTokens,
            total_tokens: totalTokens,
          }
        });
    } else {
      await db.insert(apiUsage).values({
        provider: params.provider,
        model: params.model,
        prompt_tokens: params.promptTokens,
        completion_tokens: params.completionTokens,
        total_tokens: totalTokens,
        source,
        gateway_id: gatewayId,
        datetime_hour: datetimeHour,
      });
    }
  } catch (err) {
    logger.error('Failed to log API usage to D1', err);
  }
}

export async function syncGatewayUsage(env: any) {
  const gatewayId = env.AI_GATEWAY_ID;
  if (!gatewayId) {
    logger.info('AI_GATEWAY_ID not configured, skipping AI Gateway metrics sync.');
    return;
  }

  try {
    const accountId = await getSecretStoreBinding(env, 'CF_ACCOUNT_ID');
    const apiToken = await getSecretStoreBinding(env, 'CF_API_TOKEN');

    if (!accountId || !apiToken) {
      logger.warn('CF_ACCOUNT_ID or CF_API_TOKEN missing. Skipping AI Gateway sync.');
      return;
    }

    // Set time window for last 7 days
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startStr = sevenDaysAgo.toISOString().split('.')[0] + 'Z';
    const endStr = now.toISOString().split('.')[0] + 'Z';

    const query = `
      query GetAIGatewayMetrics($accountTag: String!, $start: String!, $end: String!) {
        viewer {
          accounts(filter: { accountTag: $accountTag }) {
            aiGatewayRequestsAdaptiveGroups(
              filter: { datetimeHour_geq: $start, datetimeHour_leq: $end },
              limit: 1000,
              orderBy: [datetimeHour_DESC]
            ) {
              count
              dimensions {
                gateway
                provider
                model
                datetimeHour
              }
              sum {
                cachedTokensIn
                cachedTokensOut
                uncachedTokensIn
                uncachedTokensOut
              }
            }
          }
        }
      }
    `;

    const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiToken}`,
      },
      body: JSON.stringify({
        query,
        variables: {
          accountTag: accountId,
          start: startStr,
          end: endStr,
        }
      })
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error(`Cloudflare GraphQL API error: ${response.status} ${text}`);
      return;
    }

    const resBody = await response.json() as any;
    if (resBody.errors && resBody.errors.length > 0) {
      logger.error('Cloudflare GraphQL query returned errors', resBody.errors);
      return;
    }

    const groups = resBody?.data?.viewer?.accounts?.[0]?.aiGatewayRequestsAdaptiveGroups || [];
    logger.info(`Fetched ${groups.length} metrics groups from AI Gateway.`);

    for (const group of groups) {
      // Only sync records matching our gateway ID
      if (group.dimensions.gateway !== gatewayId) {
        continue;
      }

      const provider = group.dimensions.provider;
      const model = group.dimensions.model;
      const datetimeHour = group.dimensions.datetimeHour;
      
      const promptTokens = (group.sum.cachedTokensIn || 0) + (group.sum.uncachedTokensIn || 0);
      const completionTokens = (group.sum.cachedTokensOut || 0) + (group.sum.uncachedTokensOut || 0);

      await logApiUsage(env, {
        provider,
        model,
        promptTokens,
        completionTokens,
        source: 'gateway',
        gatewayId,
        datetimeHour,
      });
    }

    logger.info('AI Gateway metrics sync completed successfully.');
  } catch (err) {
    logger.error('Failed to sync AI Gateway metrics', err);
  }
}

export async function getApiUsageStats(env: { DB: D1Database }) {
  const db = getDb(env);
  return db.select().from(apiUsage).orderBy(sql`${apiUsage.created_at} DESC`);
}
