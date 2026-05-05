import { AsyncLocalStorage } from 'node:async_hooks';
import postgres from 'postgres';
import type { AppBindings } from '@server/env';

type DbEnv = Pick<AppBindings, 'HYPERDRIVE'>;
type DbClient = {
  query<T>(sqlText: string, params?: unknown[]): Promise<T[]>;
};

const dbStorage = new AsyncLocalStorage<DbClient>();

function createDbClient(env: DbEnv): DbClient {
  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
    prepare: true,
    onnotice: () => {},
  });

  return {
    async query<T>(sqlText: string, params: unknown[] = []) {
      return (await sql.unsafe(sqlText, params.map(normalizeParam) as any[], { prepare: true })) as T[];
    },
  };
}

function normalizeParam(param: unknown): unknown {
  return Array.isArray(param) ? toPostgresArrayLiteral(param) : param;
}

function toPostgresArrayLiteral(values: unknown[]) {
  return `{${values.map(toPostgresArrayElement).join(',')}}`;
}

function toPostgresArrayElement(value: unknown) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  const text = String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');

  return `"${text}"`;
}

export function runWithDb<T>(env: DbEnv, fn: () => T): T {
  return dbStorage.run(createDbClient(env), fn);
}

export function getDb(env: DbEnv) {
  return dbStorage.getStore() ?? createDbClient(env);
}

export async function queryRows<T>(env: DbEnv, sqlText: string, params: unknown[] = []) {
  return getDb(env).query<T>(sqlText, params);
}

export function parseJsonColumn<T>(value: T | string | null | undefined, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return JSON.parse(value) as T;
  return value;
}
