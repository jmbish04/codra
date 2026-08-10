import { getDb, parseJsonColumn } from './client';
import { defaultRepoConfig, normalizeRepoConfig, repoConfigRecordSchema, repoConfigSchema, type RepoConfig } from '@shared/schema';
import { getOrCreateRepository } from './repositories';
import { repoConfigs, repositories, jobs } from './schemas';
import { eq, and, sql } from 'drizzle-orm';

function mapRepo(row: any) {
  const parsedJson = normalizeRepoConfig(repoConfigSchema.parse(parseJsonColumn(row.parsed_json, defaultRepoConfig)));
  return repoConfigRecordSchema.parse({
    installationId: String(row.installation_id),
    owner: row.owner,
    repo: row.repo,
    parsedJson,
    updatedAt: row.updated_at,
    lastJobCreatedAt: row.last_job_created_at,
    lastJobVerdict: row.last_job_verdict,
    mainModel: row.main_model,
    fallbackModels: parseJsonColumn(row.fallback_models, null),
    sizeOverrides: parseJsonColumn(row.size_overrides, null),
    enabled: Boolean(row.enabled),
    docstringEnabled: Boolean(row.docstring_enabled),
    toolboxEnabled: Boolean(row.toolbox_enabled),
  });
}

export async function upsertRepoConfig(
  env: Pick<Env, 'DB'>,
  input: {
    installationId: string;
    owner: string;
    repo: string;
    parsedJson: RepoConfig;
    enabled?: boolean;
  },
) {
  const db = getDb(env);
  const repositoryId = await getOrCreateRepository(env, {
    installationId: input.installationId,
    owner: input.owner,
    repo: input.repo,
  });

  const parsedJson = normalizeRepoConfig(input.parsedJson);
  const model = parsedJson.model;

  await db.insert(repoConfigs)
    .values({
      repository_id: repositoryId,
      parsed_json: parsedJson,
      updated_at: sql`CURRENT_TIMESTAMP`,
      main_model: model?.main ?? null,
      fallback_models: model?.fallbacks ?? null,
      size_overrides: model?.size_overrides ?? null,
      enabled: input.enabled ?? true,
    })
    .onConflictDoUpdate({
      target: repoConfigs.repository_id,
      set: {
        parsed_json: parsedJson,
        updated_at: sql`CURRENT_TIMESTAMP`,
        main_model: model?.main ?? null,
        fallback_models: model?.fallbacks ?? null,
        size_overrides: model?.size_overrides ?? null,
        enabled: input.enabled ?? sql`repo_configs.enabled`,
      }
    });
}

export async function syncRepoConfig(
  env: Pick<Env, 'DB'>,
  input: {
    installationId: string;
    owner: string;
    repo: string;
  },
) {
  const db = getDb(env);
  const repositoryId = await getOrCreateRepository(env, {
    installationId: input.installationId,
    owner: input.owner,
    repo: input.repo,
  });

  await db.insert(repoConfigs)
    .values({
      repository_id: repositoryId,
      parsed_json: defaultRepoConfig,
      updated_at: sql`CURRENT_TIMESTAMP`,
      enabled: true,
    })
    .onConflictDoNothing();
}

/**
 * Update any subset of the three per-repo auto-toggles (Code Review / DocString
 * Enforcer / Toolbox Watcher). Only the provided flags are written.
 */
export async function updateRepoConfigFlags(
  env: Pick<Env, 'DB'>,
  input: {
    owner: string;
    repo: string;
    enabled?: boolean;
    docstringEnabled?: boolean;
    toolboxEnabled?: boolean;
  },
) {
  const db = getDb(env);
  const repoRow = await db.select({ id: repositories.id }).from(repositories)
    .where(and(eq(repositories.owner, input.owner), eq(repositories.repo, input.repo)))
    .limit(1).get();
  if (!repoRow) return;

  const set: Record<string, unknown> = { updated_at: sql`CURRENT_TIMESTAMP` };
  if (input.enabled !== undefined) set.enabled = input.enabled;
  if (input.docstringEnabled !== undefined) set.docstring_enabled = input.docstringEnabled;
  if (input.toolboxEnabled !== undefined) set.toolbox_enabled = input.toolboxEnabled;

  await db.update(repoConfigs).set(set).where(eq(repoConfigs.repository_id, repoRow.id));
}

/**
 * Reset button: turn all three auto-toggles off for every repo in one statement.
 * Users then re-enable per repo. Returns the number of repo configs affected.
 */
export async function resetAllRepoConfigs(env: Pick<Env, 'DB'>): Promise<number> {
  const db = getDb(env);
  const rows = await db.update(repoConfigs)
    .set({
      enabled: false,
      docstring_enabled: false,
      toolbox_enabled: false,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .returning({ id: repoConfigs.id });
  return rows.length;
}

export async function listRepoConfigs(env: Pick<Env, 'DB'>) {
  const db = getDb(env);
  
  const lastJobsSq = db.select({
    repository_id: jobs.repository_id,
    last_job_created_at: sql<string>`MAX(${jobs.created_at})`.as('last_job_created_at'),
    last_job_verdict: jobs.verdict,
  })
  .from(jobs)
  .groupBy(jobs.repository_id)
  .as('lj');

  const rows = await db.select({
    installation_id: repositories.installation_id,
    owner: repositories.owner,
    repo: repositories.repo,
    parsed_json: repoConfigs.parsed_json,
    updated_at: repoConfigs.updated_at,
    main_model: repoConfigs.main_model,
    fallback_models: repoConfigs.fallback_models,
    size_overrides: repoConfigs.size_overrides,
    enabled: repoConfigs.enabled,
    docstring_enabled: repoConfigs.docstring_enabled,
    toolbox_enabled: repoConfigs.toolbox_enabled,
    last_job_created_at: lastJobsSq.last_job_created_at,
    last_job_verdict: lastJobsSq.last_job_verdict,
  })
  .from(repoConfigs)
  .innerJoin(repositories, eq(repoConfigs.repository_id, repositories.id))
  .leftJoin(lastJobsSq, eq(lastJobsSq.repository_id, repositories.id))
  // Most recently active repos first (user likely wants reviews on what they're
  // working on now); never-reviewed repos sort last, then alphabetically.
  .orderBy(
    sql`${lastJobsSq.last_job_created_at} IS NULL`,
    sql`${lastJobsSq.last_job_created_at} DESC`,
    repositories.owner,
    repositories.repo,
  )
  .all();

  return rows.map(mapRepo);
}

export async function getRepoConfigRecord(env: Pick<Env, 'DB'>, owner: string, repo: string) {
  const db = getDb(env);
  
  const lastJobsSq = db.select({
    repository_id: jobs.repository_id,
    last_job_created_at: sql<string>`MAX(${jobs.created_at})`.as('last_job_created_at'),
    last_job_verdict: jobs.verdict,
  })
  .from(jobs)
  .groupBy(jobs.repository_id)
  .as('lj');

  const row = await db.select({
    installation_id: repositories.installation_id,
    owner: repositories.owner,
    repo: repositories.repo,
    parsed_json: repoConfigs.parsed_json,
    updated_at: repoConfigs.updated_at,
    main_model: repoConfigs.main_model,
    fallback_models: repoConfigs.fallback_models,
    size_overrides: repoConfigs.size_overrides,
    enabled: repoConfigs.enabled,
    docstring_enabled: repoConfigs.docstring_enabled,
    toolbox_enabled: repoConfigs.toolbox_enabled,
    last_job_created_at: lastJobsSq.last_job_created_at,
    last_job_verdict: lastJobsSq.last_job_verdict,
  })
  .from(repoConfigs)
  .innerJoin(repositories, eq(repoConfigs.repository_id, repositories.id))
  .leftJoin(lastJobsSq, eq(lastJobsSq.repository_id, repositories.id))
  .where(and(eq(repositories.owner, owner), eq(repositories.repo, repo)))
  .limit(1)
  .get();

  return row ? mapRepo(row) : null;
}
