import type { AppBindings } from '@server/env';
import { queryRows } from './client';
import { defaultRepoConfig, repoConfigRecordSchema, repoConfigSchema, type RepoConfig } from '@shared/schema';

type RepoConfigRow = {
  owner: string;
  repo: string;
  raw_yaml: string | null;
  parsed_json: RepoConfig | null;
  config_missing: boolean;
  updated_at: string;
  last_job_created_at: string | null;
  last_job_verdict: 'approve' | 'comment' | null;
};

function mapRepo(row: RepoConfigRow) {
  return repoConfigRecordSchema.parse({
    owner: row.owner,
    repo: row.repo,
    rawYaml: row.raw_yaml,
    parsedJson: repoConfigSchema.parse(row.parsed_json ?? defaultRepoConfig),
    configMissing: row.config_missing,
    updatedAt: row.updated_at,
    lastJobCreatedAt: row.last_job_created_at,
    lastJobVerdict: row.last_job_verdict,
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
  },
) {
  await queryRows(
    env,
    `
      INSERT INTO repo_configs (installation_id, owner, repo, raw_yaml, parsed_json, config_missing)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      ON CONFLICT (owner, repo)
      DO UPDATE
      SET installation_id = EXCLUDED.installation_id,
          raw_yaml = EXCLUDED.raw_yaml,
          parsed_json = EXCLUDED.parsed_json,
          config_missing = EXCLUDED.config_missing,
          updated_at = now()
    `,
    [input.installationId, input.owner, input.repo, input.rawYaml, JSON.stringify(input.parsedJson), input.configMissing],
  );
}

export async function listRepoConfigs(env: Pick<AppBindings, 'NEON_DATABASE_URL'>) {
  const rows = await queryRows<RepoConfigRow>(
    env,
    `
      SELECT
        rc.owner,
        rc.repo,
        rc.raw_yaml,
        rc.parsed_json,
        rc.config_missing,
        rc.updated_at,
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
        rc.owner,
        rc.repo,
        rc.raw_yaml,
        rc.parsed_json,
        rc.config_missing,
        rc.updated_at,
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
