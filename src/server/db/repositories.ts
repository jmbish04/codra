import { getDb } from './client';
import { repositories } from './schemas';

export type RepositoryRow = {
  id: number;
  installation_id: number;
  owner: string;
  repo: string;
};

export async function getOrCreateRepository(
  env: Pick<Env, 'DB'>,
  input: { installationId: string; owner: string; repo: string }
): Promise<number> {
  const db = getDb(env);
  const installationId = parseInt(input.installationId, 10);
  
  const [row] = await db.insert(repositories)
    .values({
      installation_id: installationId,
      owner: input.owner,
      repo: input.repo,
    })
    .onConflictDoUpdate({
      target: [repositories.owner, repositories.repo],
      set: { installation_id: installationId }
    })
    .returning({ id: repositories.id });

  return row.id;
}
