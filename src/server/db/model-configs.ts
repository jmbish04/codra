import type { AppBindings } from '@server/env';
import { queryRows } from './client';
import { modelConfigSchema, type ModelConfig } from '@shared/schema';

type ModelConfigRow = {
  model_id: string;
  rpm: number;
  tpm: number;
  rpd: number;
  provider: string;
  updated_at: string;
};

function mapModelConfig(row: ModelConfigRow): ModelConfig {
  return modelConfigSchema.parse({
    modelId: row.model_id,
    rpm: row.rpm,
    tpm: row.tpm,
    rpd: row.rpd,
    provider: row.provider,
    updatedAt: row.updated_at,
  });
}

export async function listModelConfigs(env: Pick<AppBindings, 'NEON_DATABASE_URL'>): Promise<ModelConfig[]> {
  const rows = await queryRows<ModelConfigRow>(
    env,
    `SELECT model_id, rpm, tpm, rpd, provider, updated_at FROM model_configs ORDER BY model_id ASC`
  );
  return rows.map(mapModelConfig);
}

export async function getModelConfig(env: Pick<AppBindings, 'NEON_DATABASE_URL'>, modelId: string): Promise<ModelConfig | null> {
  const [row] = await queryRows<ModelConfigRow>(
    env,
    `SELECT model_id, rpm, tpm, rpd, provider, updated_at FROM model_configs WHERE model_id = $1`,
    [modelId]
  );
  return row ? mapModelConfig(row) : null;
}

export async function updateModelConfig(
  env: Pick<AppBindings, 'NEON_DATABASE_URL'>,
  config: Omit<ModelConfig, 'updatedAt'>
) {
  await queryRows(
    env,
    `
    INSERT INTO model_configs (model_id, rpm, tpm, rpd, provider, updated_at)
    VALUES ($1, $2, $3, $4, $5, now())
    ON CONFLICT (model_id)
    DO UPDATE SET
      rpm = EXCLUDED.rpm,
      tpm = EXCLUDED.tpm,
      rpd = EXCLUDED.rpd,
      provider = EXCLUDED.provider,
      updated_at = now()
    `,
    [config.modelId, config.rpm, config.tpm, config.rpd, config.provider]
  );
}
