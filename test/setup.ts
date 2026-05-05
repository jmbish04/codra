import { vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Global mocks for Cloudflare environment
vi.stubGlobal('QUEUE', {
  send: async (msg: any) => {
    console.log('Mock Queue Send:', msg);
  },
});

function parseEnvValue(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function readTestDatabaseUrlFromEnvFiles() {
  for (const file of ['.env.test', '.env.local', '.env', '.dev.vars']) {
    try {
      const content = readFileSync(path.join(process.cwd(), file), 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) continue;

        const key = trimmed.slice(0, separatorIndex).trim();
        if (key === 'TEST_DATABASE_URL') {
          return parseEnvValue(trimmed.slice(separatorIndex + 1));
        }
      }
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return null;
}

// Postgres database URL for integration tests. Set TEST_DATABASE_URL or put
// TEST_DATABASE_URL in .env.test/.env.local/.env/.dev.vars.
const configuredDatabaseUrl = process.env.TEST_DATABASE_URL || readTestDatabaseUrlFromEnvFiles();
if (configuredDatabaseUrl && configuredDatabaseUrl !== 'undefined' && configuredDatabaseUrl !== 'null') {
  process.env.TEST_DATABASE_URL = configuredDatabaseUrl;
}

// Standard test timeout
vi.setConfig({ testTimeout: 20000 });

if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query.includes('dark'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

const originalConsoleWarn = console.warn;
console.warn = (...args: any[]) => {
  if (typeof args[0] === 'string' && args[0].includes('The width(-1) and height(-1) of chart should be greater than 0')) {
    return;
  }
  originalConsoleWarn(...args);
};

const isJsonLog = (args: any[]) => {
  if (typeof args[0] === 'string' && args[0].includes('"timestamp"') && args[0].includes('"level"')) return true;
  return false;
};

const originalConsoleInfo = console.info;
console.info = (...args: any[]) => {
  if (isJsonLog(args)) return;
  originalConsoleInfo(...args);
};

const originalConsoleError = console.error;
console.error = (...args: any[]) => {
  if (isJsonLog(args)) return;
  originalConsoleError(...args);
};

const originalConsoleLog = console.log;
console.log = (...args: any[]) => {
  if (isJsonLog(args)) return;
  originalConsoleLog(...args);
};
// Global cleanup for database tables (Disabled temporarily to debug race conditions)
/*
beforeEach(async () => {
    if (process.env.TEST_DATABASE_URL) {
        const { getDb } = await import('@server/db/client');
        const sql = getDb({ HYPERDRIVE: { connectionString: process.env.TEST_DATABASE_URL } });
        try {
            await sql.query('DELETE FROM webhook_deliveries');
            await sql.query('DELETE FROM file_reviews');
            await sql.query('DELETE FROM jobs');
            await sql.query('DELETE FROM repo_configs');
        } catch (e) {
            console.warn('Database cleanup failed, tables might be empty or missing:', e);
        }
    }
});
*/
