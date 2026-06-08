import { AsyncLocalStorage } from 'node:async_hooks';
import postgres from 'postgres';
import type { AppBindings } from '@server/env';

type DbEnv = Pick<AppBindings, 'HYPERDRIVE'>;
type DbClient = {
  query<T>(sqlText: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>;
};

const dbStorage = new AsyncLocalStorage<DbClient>();

function createDbClient(env: DbEnv): DbClient {
  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
    prepare: false,
    onnotice: () => {},
  });

  return {
    async query<T>(sqlText: string, params: unknown[] = []) {
      return (await sql.unsafe(sqlText, params.map(normalizeParam) as any[], { prepare: false })) as T[];
    },
    async transaction<T>(fn: (tx: DbClient) => Promise<T>) {
      return (await sql.begin(async (t) => {
        const txClient: DbClient = {
          async query<U>(sqlText: string, params: unknown[] = []) {
            return (await t.unsafe(sqlText, params.map(normalizeParam) as any[], { prepare: false })) as U[];
          },
          async transaction<U>(innerFn: (tx: DbClient) => Promise<U>) {
            // Nested transactions could use savepoints, but for now we just reuse the same txClient
            return await innerFn(txClient);
          }
        };
        return await fn(txClient);
      })) as T;
    }
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

export async function queryTransaction<T>(env: DbEnv, fn: (tx: DbClient) => Promise<T>) {
  return getDb(env).transaction<T>(fn);
}

export function parseJsonColumn<T>(value: T | string | null | undefined, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return JSON.parse(value) as T;
  return value;
}
