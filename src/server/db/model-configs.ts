import { getDb } from './client';
import {
  KIMI_K2_5_MODEL,
  llmProviderSchema,
  modelConfigSchema,
  type LlmApiFormat,
  type LlmProvider,
  type ModelConfig,
} from '@shared/schema';
import { llmProviders, modelConfigs } from './schemas';
import { eq, and, sql, not, like, count, inArray } from 'drizzle-orm';

type ProviderRow = typeof llmProviders.$inferSelect;

export type LlmProviderSecret = LlmProvider & {
  encryptedApiKey: string | null;
};

export type ResolvedModelConfig = ModelConfig & {
  providerEnabled: boolean;
  baseUrl: string | null;
  encryptedApiKey: string | null;
};

function mapProvider(row: ProviderRow): LlmProvider {
  return llmProviderSchema.parse({
    id: row.id,
    name: row.name,
    apiFormat: row.api_format,
    baseUrl: row.base_url,
    enabled: Boolean(row.enabled),
    hasApiKey: Boolean(row.encrypted_api_key),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapProviderSecret(row: ProviderRow): LlmProviderSecret {
  return {
    ...mapProvider(row),
    encryptedApiKey: row.encrypted_api_key,
  };
}

function mapModelConfig(row: any): ModelConfig {
  return modelConfigSchema.parse({
    modelId: row.model_id,
    providerId: row.provider_id,
    providerName: row.provider_name,
    apiFormat: row.api_format,
    modelName: row.model_name,
    rpm: row.rpm,
    tpm: row.tpm,
    rpd: row.rpd,
    updatedAt: row.updated_at,
  });
}

export async function listLlmProviders(env: Pick<Env, 'DB'>): Promise<LlmProvider[]> {
  const db = getDb(env);
  const rows = await db.select().from(llmProviders).orderBy(llmProviders.name).all();
  return rows.map(mapProvider);
}

export async function listLlmProviderSecrets(env: Pick<Env, 'DB'>): Promise<LlmProviderSecret[]> {
  const db = getDb(env);
  const rows = await db.select().from(llmProviders).orderBy(llmProviders.name).all();
  return rows.map(mapProviderSecret);
}

export async function getLlmProvider(env: Pick<Env, 'DB'>, id: string): Promise<LlmProviderSecret | null> {
  const db = getDb(env);
  const row = await db.select().from(llmProviders).where(eq(llmProviders.id, id)).get();
  return row ? mapProviderSecret(row) : null;
}

export async function createLlmProvider(
  env: Pick<Env, 'DB'>,
  input: {
    name: string;
    apiFormat: LlmApiFormat;
    baseUrl: string | null;
    encryptedApiKey: string | null;
    enabled: boolean;
  },
) {
  const db = getDb(env);
  const [row] = await db.insert(llmProviders).values({
    name: input.name,
    api_format: input.apiFormat,
    base_url: input.baseUrl,
    encrypted_api_key: input.encryptedApiKey,
    enabled: input.enabled,
    updated_at: new Date().toISOString(),
  }).returning();
  return mapProvider(row);
}

export async function findLlmProviderByName(env: Pick<Env, 'DB'>, name: string): Promise<LlmProvider | null> {
  const db = getDb(env);
  const row = await db.select().from(llmProviders).where(sql`lower(${llmProviders.name}) = lower(${name})`).get();
  return row ? mapProvider(row) : null;
}

export async function updateLlmProvider(
  env: Pick<Env, 'DB'>,
  id: string,
  input: {
    name: string;
    apiFormat: LlmApiFormat;
    baseUrl: string | null;
    encryptedApiKey?: string | null;
    enabled: boolean;
  },
) {
  const db = getDb(env);
  
  const updates: any = {
    name: input.name,
    api_format: input.apiFormat,
    base_url: input.baseUrl,
    enabled: input.enabled,
    updated_at: new Date().toISOString(),
  };
  
  if (input.encryptedApiKey !== undefined) {
    updates.encrypted_api_key = input.encryptedApiKey;
  }

  const [row] = await db.update(llmProviders)
    .set(updates)
    .where(eq(llmProviders.id, id))
    .returning();
    
  return row ? mapProvider(row) : null;
}

export async function deleteLlmProvider(env: Pick<Env, 'DB'>, id: string) {
  const db = getDb(env);
  const { c } = await db.select({ c: count() }).from(modelConfigs).where(eq(modelConfigs.provider_id, id)).get() || { c: 0 };
  
  if (c > 0) {
    return { deleted: false, reason: 'Provider is still used by one or more models.' };
  }

  const result = await db.delete(llmProviders).where(eq(llmProviders.id, id)).returning({ id: llmProviders.id });
  return { deleted: result.length > 0, reason: null };
}

export async function listModelConfigs(env: Pick<Env, 'DB'>): Promise<ModelConfig[]> {
  const db = getDb(env);
  const rows = await db.select({
    model_id: modelConfigs.model_id,
    provider_id: modelConfigs.provider_id,
    provider_name: llmProviders.name,
    api_format: llmProviders.api_format,
    model_name: modelConfigs.model_name,
    rpm: modelConfigs.rpm,
    tpm: modelConfigs.tpm,
    rpd: modelConfigs.rpd,
    updated_at: modelConfigs.updated_at,
  })
  .from(modelConfigs)
  .innerJoin(llmProviders, eq(llmProviders.id, modelConfigs.provider_id))
  .where(not(eq(modelConfigs.model_id, KIMI_K2_5_MODEL)))
  .orderBy(modelConfigs.model_id)
  .all();
  
  return rows.map(mapModelConfig);
}

export async function getModelConfig(env: Pick<Env, 'DB'>, modelId: string): Promise<ModelConfig | null> {
  const db = getDb(env);
  const row = await db.select({
    model_id: modelConfigs.model_id,
    provider_id: modelConfigs.provider_id,
    provider_name: llmProviders.name,
    api_format: llmProviders.api_format,
    model_name: modelConfigs.model_name,
    rpm: modelConfigs.rpm,
    tpm: modelConfigs.tpm,
    rpd: modelConfigs.rpd,
    updated_at: modelConfigs.updated_at,
  })
  .from(modelConfigs)
  .innerJoin(llmProviders, eq(llmProviders.id, modelConfigs.provider_id))
  .where(eq(modelConfigs.model_id, modelId))
  .get();
  
  return row ? mapModelConfig(row) : null;
}

export async function getResolvedModelConfig(
  env: Pick<Env, 'DB'>,
  modelId: string,
): Promise<ResolvedModelConfig | null> {
  const db = getDb(env);
  const row = await db.select({
    model_id: modelConfigs.model_id,
    provider_id: modelConfigs.provider_id,
    provider_name: llmProviders.name,
    api_format: llmProviders.api_format,
    model_name: modelConfigs.model_name,
    rpm: modelConfigs.rpm,
    tpm: modelConfigs.tpm,
    rpd: modelConfigs.rpd,
    updated_at: modelConfigs.updated_at,
    provider_enabled: llmProviders.enabled,
    base_url: llmProviders.base_url,
    encrypted_api_key: llmProviders.encrypted_api_key,
  })
  .from(modelConfigs)
  .innerJoin(llmProviders, eq(llmProviders.id, modelConfigs.provider_id))
  .where(eq(modelConfigs.model_id, modelId))
  .get();

  if (!row) return null;
  return {
    ...mapModelConfig(row),
    providerEnabled: Boolean(row.provider_enabled),
    baseUrl: row.base_url,
    encryptedApiKey: row.encrypted_api_key,
  };
}

export async function updateModelConfig(
  env: Pick<Env, 'DB'>,
  config: Omit<ModelConfig, 'updatedAt' | 'providerName' | 'apiFormat'>,
) {
  const db = getDb(env);
  const providerRow = await db.select({ api_format: llmProviders.api_format }).from(llmProviders).where(eq(llmProviders.id, config.providerId)).get();
  if (!providerRow) return null;
  
  await db.insert(modelConfigs).values({
    model_id: config.modelId,
    provider_id: config.providerId,
    model_name: config.modelName,
    rpm: config.rpm ?? null,
    tpm: config.tpm ?? null,
    rpd: config.rpd ?? null,
    provider: providerRow.api_format,
    updated_at: new Date().toISOString(),
  })
  .onConflictDoUpdate({
    target: modelConfigs.model_id,
    set: {
      provider_id: config.providerId,
      model_name: config.modelName,
      rpm: config.rpm ?? null,
      tpm: config.tpm ?? null,
      rpd: config.rpd ?? null,
      provider: providerRow.api_format,
      updated_at: new Date().toISOString(),
    }
  });
  
  return getModelConfig(env, config.modelId);
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'provider';
}

export async function upsertDiscoveredModelConfigs(
  env: Pick<Env, 'DB'>,
  input: {
    providerId: string;
    providerName: string;
    apiFormat: LlmApiFormat;
    modelNames: string[];
  },
) {
  const db = getDb(env);
  const uniqueModelNames = Array.from(new Set(input.modelNames.map(name => name.trim()).filter(Boolean)));
  if (uniqueModelNames.length === 0) return [];

  const providerSlug = slugify(input.providerName);
  
  const [existingForProvider, existingModelIds] = await Promise.all([
    db.select({ model_id: modelConfigs.model_id, model_name: modelConfigs.model_name })
      .from(modelConfigs).where(eq(modelConfigs.provider_id, input.providerId)).all(),
    db.select({ model_id: modelConfigs.model_id })
      .from(modelConfigs).where(like(modelConfigs.model_id, `${providerSlug}:%`)).all(),
  ]);

  const existingModelNames = new Set(existingForProvider.map(row => row.model_name));
  const usedModelIds = new Set(existingModelIds.map(row => row.model_id));
  
  const rowsToInsert: Array<typeof modelConfigs.$inferInsert> = [];

  for (const modelName of uniqueModelNames) {
    if (existingModelNames.has(modelName)) continue;

    const base = `${providerSlug}:${modelName}`;
    let candidate = base;
    let suffix = 2;
    while (usedModelIds.has(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix++;
    }
    usedModelIds.add(candidate);

    const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
    rowsToInsert.push({
      model_id: candidate,
      provider_id: input.providerId,
      model_name: modelName,
      rpm: null,
      tpm: null,
      rpd: null,
      provider: input.apiFormat,
      created_at: nowStr,
      updated_at: nowStr,
    });
  }

  if (rowsToInsert.length === 0) return [];

  await db.insert(modelConfigs).values(rowsToInsert).onConflictDoNothing();

  const insertedIds = rowsToInsert.map(r => r.model_id!);
  
  const rows = await db.select({
    model_id: modelConfigs.model_id,
    provider_id: modelConfigs.provider_id,
    provider_name: llmProviders.name,
    api_format: llmProviders.api_format,
    model_name: modelConfigs.model_name,
    rpm: modelConfigs.rpm,
    tpm: modelConfigs.tpm,
    rpd: modelConfigs.rpd,
    updated_at: modelConfigs.updated_at,
  })
  .from(modelConfigs)
  .innerJoin(llmProviders, eq(llmProviders.id, modelConfigs.provider_id))
  .where(inArray(modelConfigs.model_id, insertedIds))
  .orderBy(modelConfigs.model_id)
  .all();

  return rows.map(mapModelConfig);
}

export async function deleteModelConfig(env: Pick<Env, 'DB'>, modelId: string) {
  const db = getDb(env);
  const rows = await db.delete(modelConfigs).where(eq(modelConfigs.model_id, modelId)).returning({ model_id: modelConfigs.model_id });
  return rows.length > 0;
}
