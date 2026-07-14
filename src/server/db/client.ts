import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schemas';

export function getDb(env: Pick<Env, 'DB'>) {
  return drizzle(env.DB, { schema });
}

export type DbClient = ReturnType<typeof getDb>;

export function parseJsonColumn<T>(value: T | string | null | undefined, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return JSON.parse(value) as T;
  return value;
}
