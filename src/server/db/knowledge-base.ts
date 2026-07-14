import { getDb } from './client';
import { kb_repos, kb_users, kb_starred_lists, kb_repo_lists, kb_tags, kb_repo_tags } from './schemas';
import { eq, and, sql, or, like, desc, asc, inArray } from 'drizzle-orm';
import type { AppEnv } from '@server/env';

export async function upsertRepo(env: Pick<Env, 'DB'>, data: {
  github_id: number;
  full_name: string;
  language?: string | null;
  topics?: string[];
  is_starred?: boolean;
  is_watched?: boolean;
  is_forked_by_me?: boolean;
  stargazers_count?: number;
  starred_at?: string;
}) {
  const db = getDb(env);
  const now = new Date().toISOString();
  
  const [row] = await db.insert(kb_repos).values({
    github_id: data.github_id,
    full_name: data.full_name,
    language: data.language ?? null,
    topics: data.topics ? JSON.stringify(data.topics) : '[]',
    is_starred: data.is_starred ?? false,
    is_watched: data.is_watched ?? false,
    is_forked_by_me: data.is_forked_by_me ?? false,
    stargazers_count: data.stargazers_count,
    starred_at: data.starred_at,
    created_at: now,
    updated_at: now,
  }).onConflictDoUpdate({
    target: kb_repos.github_id,
    set: {
      full_name: data.full_name,
      language: data.language !== undefined ? data.language : sql`${kb_repos.language}`,
      topics: data.topics !== undefined ? (data.topics ? JSON.stringify(data.topics) : '[]') : sql`${kb_repos.topics}`,
      is_starred: data.is_starred !== undefined ? data.is_starred : sql`${kb_repos.is_starred}`,
      is_watched: data.is_watched !== undefined ? data.is_watched : sql`${kb_repos.is_watched}`,
      is_forked_by_me: data.is_forked_by_me !== undefined ? data.is_forked_by_me : sql`${kb_repos.is_forked_by_me}`,
      stargazers_count: data.stargazers_count !== undefined ? data.stargazers_count : sql`${kb_repos.stargazers_count}`,
      starred_at: data.starred_at !== undefined ? data.starred_at : sql`${kb_repos.starred_at}`,
      updated_at: now,
    }
  }).returning();
  
  return row;
}

export async function markAllReposUnstarred(env: Pick<Env, 'DB'>) {
  const db = getDb(env);
  await db.update(kb_repos).set({ is_starred: false, updated_at: new Date().toISOString() });
}

export async function markAllReposUnwatched(env: Pick<Env, 'DB'>) {
  const db = getDb(env);
  await db.update(kb_repos).set({ is_watched: false, updated_at: new Date().toISOString() });
}

export async function upsertUser(env: Pick<Env, 'DB'>, data: {
  github_id: number;
  login: string;
  avatar_url?: string | null;
  bio?: string | null;
  is_following?: boolean;
  followers_count?: number;
}) {
  const db = getDb(env);
  const now = new Date().toISOString();
  
  const [row] = await db.insert(kb_users).values({
    github_id: data.github_id,
    login: data.login,
    avatar_url: data.avatar_url,
    bio: data.bio,
    is_following: data.is_following ?? false,
    followers_count: data.followers_count,
    created_at: now,
    updated_at: now,
  }).onConflictDoUpdate({
    target: kb_users.github_id,
    set: {
      login: data.login,
      avatar_url: data.avatar_url !== undefined ? data.avatar_url : sql`${kb_users.avatar_url}`,
      bio: data.bio !== undefined ? data.bio : sql`${kb_users.bio}`,
      is_following: data.is_following !== undefined ? data.is_following : sql`${kb_users.is_following}`,
      followers_count: data.followers_count !== undefined ? data.followers_count : sql`${kb_users.followers_count}`,
      updated_at: now,
    }
  }).returning();
  
  return row;
}

export async function markAllUsersUnfollowed(env: Pick<Env, 'DB'>) {
  const db = getDb(env);
  await db.update(kb_users).set({ is_following: false, updated_at: new Date().toISOString() });
}

export async function upsertList(env: Pick<Env, 'DB'>, data: {
  name: string;
  github_slug: string;
  description?: string | null;
}) {
  const db = getDb(env);
  const now = new Date().toISOString();
  
  const [row] = await db.insert(kb_starred_lists).values({
    name: data.name,
    github_slug: data.github_slug,
    description: data.description,
    created_at: now,
    updated_at: now,
  }).onConflictDoUpdate({
    target: kb_starred_lists.github_slug,
    set: {
      name: data.name,
      description: data.description ?? sql`${kb_starred_lists.description}`,
      updated_at: now,
    }
  }).returning();
  
  return row;
}

export async function getRepos(env: Pick<Env, 'DB'>, options?: { is_starred?: boolean, is_watched?: boolean, limit?: number }) {
  const db = getDb(env);
  let q = db.select().from(kb_repos).$dynamic();
  
  const conditions = [];
  if (options?.is_starred !== undefined) conditions.push(eq(kb_repos.is_starred, options.is_starred));
  if (options?.is_watched !== undefined) conditions.push(eq(kb_repos.is_watched, options.is_watched));
  
  if (conditions.length > 0) {
    q = q.where(and(...conditions));
  }
  
  if (options?.limit) {
    q = q.limit(options.limit);
  }
  
  return await q.all();
}

export async function getTags(env: Pick<Env, 'DB'>) {
  const db = getDb(env);
  return await db.select().from(kb_tags).all();
}
