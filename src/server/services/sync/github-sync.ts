import { getSecret } from '@server/utils/secrets';
import { logger } from '@server/core/logger';
import { 
  upsertRepo, 
  markAllReposUnstarred, 
  markAllReposUnwatched,
  upsertUser,
  markAllUsersUnfollowed
} from '@server/db/knowledge-base';

export async function runFullSync(env: Env) {
  logger.info('Starting full GitHub Knowledge Base sync...');
  
  await syncStarredRepos(env);
  await syncWatchedRepos(env);
  await syncFollowing(env);
  
  logger.info('Finished full GitHub Knowledge Base sync.');
}

async function fetchAllPages<T>(url: string, token: string): Promise<T[]> {
  const results: T[] = [];
  let currentUrl: string | null = url;

  while (currentUrl) {
    const response: Response = await fetch(currentUrl, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'codra-kb-sync',
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`GitHub API error (${response.status}) for ${currentUrl}: ${errText}`);
    }

    const data = await response.json() as T[];
    results.push(...data);

    // Parse Link header for pagination
    const linkHeader: string | null = response.headers.get('link');
    if (linkHeader) {
      const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      currentUrl = match ? match[1] : null;
    } else {
      currentUrl = null;
    }
  }

  return results;
}

export async function syncStarredRepos(env: Env) {
  logger.info('Syncing starred repos...');
  const token = getSecret(env, 'GITHUB_TOKEN');
  if (!token) throw new Error('GITHUB_TOKEN is missing');

  // We want to handle starred_at so we need application/vnd.github.star+json
  // Actually, the standard Accept header with star+json gives starred_at.
  // Wait, let's just use standard repos for now unless we need the exact timestamp.
  // We'll stick to basic repo response for now, which doesn't have starred_at but it's okay.
  const repos = await fetchAllPages<any>('https://api.github.com/user/starred?per_page=100', token);

  await markAllReposUnstarred(env);

  for (const repo of repos) {
    await upsertRepo(env, {
      github_id: repo.id,
      full_name: repo.full_name,
      language: repo.language,
      topics: repo.topics,
      is_starred: true,
      stargazers_count: repo.stargazers_count,
    });
  }
  
  logger.info(`Synced ${repos.length} starred repos.`);
}

export async function syncWatchedRepos(env: Env) {
  logger.info('Syncing watched repos...');
  const token = getSecret(env, 'GITHUB_TOKEN');
  if (!token) throw new Error('GITHUB_TOKEN is missing');

  const repos = await fetchAllPages<any>('https://api.github.com/user/subscriptions?per_page=100', token);

  await markAllReposUnwatched(env);

  for (const repo of repos) {
    await upsertRepo(env, {
      github_id: repo.id,
      full_name: repo.full_name,
      language: repo.language,
      topics: repo.topics,
      is_watched: true,
      stargazers_count: repo.stargazers_count,
    });
  }
  
  logger.info(`Synced ${repos.length} watched repos.`);
}

export async function syncFollowing(env: Env) {
  logger.info('Syncing following users...');
  const token = getSecret(env, 'GITHUB_TOKEN');
  if (!token) throw new Error('GITHUB_TOKEN is missing');

  const users = await fetchAllPages<any>('https://api.github.com/user/following?per_page=100', token);

  await markAllUsersUnfollowed(env);

  for (const user of users) {
    // Note: the following endpoint only gives minimal user info (no followers_count or bio).
    // A full sync might require fetching each user, but this is enough to track the relationship.
    await upsertUser(env, {
      github_id: user.id,
      login: user.login,
      avatar_url: user.avatar_url,
      is_following: true,
    });
  }
  
  logger.info(`Synced ${users.length} following users.`);
}
