import type { AppBindings } from '@server/env';
import { queryRows } from './client';
import { defaultRepoConfig, repoConfigRecordSchema, repoConfigSchema, type RepoConfig } from '@shared/schema';

type RepoConfigRow = {
  installation_id: string;
  owner: string;
  repo: string;
  raw_yaml: string | null;
  parsed_json: RepoConfig | null;
  config_missing: boolean;
  updated_at: string;
  main_model: string | null;
  fallback_models: string[] | null;
  size_overrides: any | null;
  enabled: boolean;
  last_job_created_at: string | null;
  last_job_verdict: 'approve' | 'comment' | null;
};

function mapRepo(row: RepoConfigRow) {
  const parsedJson = repoConfigSchema.parse(row.parsed_json ?? defaultRepoConfig);
  return repoConfigRecordSchema.parse({
    installationId: row.installation_id,
    owner: row.owner,
    repo: row.repo,
    rawYaml: row.raw_yaml,
    parsedJson,
    configMissing: row.config_missing,
    updatedAt: row.updated_at,
    lastJobCreatedAt: row.last_job_created_at,
    lastJobVerdict: row.last_job_verdict,
    mainModel: row.main_model,
    fallbackModels: row.fallback_models,
    sizeOverrides: row.size_overrides,
    enabled: row.enabled,
  });
}

export async function upsertRepoConfig(
  env: Pick<AppBindings, 'NEON_DATABASE_URL'>,
  input: {
    installationId: string;
    owner: string;
    repo: string;
    rawYaml: string | null;
    parsedJson: RepoConfig;
    configMissing: boolean;
    enabled?: boolean;
  },
) {
  const model = input.parsedJson.model;
  await queryRows(
    env,
    `
      INSERT INTO repo_configs (installation_id, owner, repo, raw_yaml, parsed_json, config_missing, updated_at, main_model, fallback_models, size_overrides, enabled)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, now(), $7, $8::jsonb, $9::jsonb, COALESCE($10, TRUE))
      ON CONFLICT (owner, repo)
      DO UPDATE
      SET installation_id = EXCLUDED.installation_id,
          raw_yaml = EXCLUDED.raw_yaml,
          parsed_json = EXCLUDED.parsed_json,
          config_missing = EXCLUDED.config_missing,
          updated_at = EXCLUDED.updated_at,
          main_model = EXCLUDED.main_model,
          fallback_models = EXCLUDED.fallback_models,
          size_overrides = EXCLUDED.size_overrides,
          enabled = COALESCE($10, repo_configs.enabled)
    `,
    [
      input.installationId, 
      input.owner, 
      input.repo, 
      input.rawYaml, 
      JSON.stringify(input.parsedJson), 
      input.configMissing,
      model?.main ?? 'gemma-4-31b-it',
      JSON.stringify(model?.fallbacks ?? []),
      model?.size_overrides ? JSON.stringify(model.size_overrides) : null,
      input.enabled ?? null
    ],
  );
}

export async function listRepoConfigs(env: Pick<AppBindings, 'NEON_DATABASE_URL'>) {
  const rows = await queryRows<RepoConfigRow>(
    env,
    `
      SELECT
        rc.installation_id,
        rc.owner,
        rc.repo,
        rc.raw_yaml,
        rc.parsed_json,
        rc.config_missing,
        rc.updated_at,
        rc.main_model,
        rc.fallback_models,
        rc.size_overrides,
        rc.enabled,
        lj.created_at AS last_job_created_at,
        lj.verdict AS last_job_verdict
      FROM repo_configs rc
      LEFT JOIN LATERAL (
        SELECT created_at, verdict
        FROM jobs
        WHERE owner = rc.owner AND repo = rc.repo
        ORDER BY created_at DESC
        LIMIT 1
      ) lj ON true
      ORDER BY rc.owner ASC, rc.repo ASC
    `,
  );

  return rows.map(mapRepo);
}

export async function getRepoConfigRecord(env: Pick<AppBindings, 'NEON_DATABASE_URL'>, owner: string, repo: string) {
  const [row] = await queryRows<RepoConfigRow>(
    env,
    `
      SELECT
        rc.installation_id,
        rc.owner,
        rc.repo,
        rc.raw_yaml,
        rc.parsed_json,
        rc.config_missing,
        rc.updated_at,
        rc.main_model,
        rc.fallback_models,
        rc.size_overrides,
        rc.enabled,
        lj.created_at AS last_job_created_at,
        lj.verdict AS last_job_verdict
      FROM repo_configs rc
      LEFT JOIN LATERAL (
        SELECT created_at, verdict
        FROM jobs
        WHERE owner = rc.owner AND repo = rc.repo
        ORDER BY created_at DESC
        LIMIT 1
      ) lj ON true
      WHERE rc.owner = $1 AND rc.repo = $2
      LIMIT 1
    `,
    [owner, repo],
  );

  return row ? mapRepo(row) : null;
}
