import { vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const TEST_ENV_FILES = ['.env.test', '.env.local', '.env', '.dev.vars', '.env.test.example'];
const REQUIRED_TEST_ENV_KEYS = [
  'GITHUB_APP_SLUG',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'AUTH_CALLBACK_URL',
  'APP_URL',
  'DASHBOARD_ALLOWED_USERS',
  'BOT_USERNAME',
];

// Global mocks for Cloudflare environment
vi.stubGlobal('QUEUE', {
  send: async (msg: any) => {
    console.log('Mock Queue Send:', msg);
  },
});

function parseEnvValue(value: string) {
  let trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1);
  }

  return trimmed.replace(/\\n/g, '\n');
}

function usableEnvValue(value: string | undefined) {
  return value && value !== 'undefined' && value !== 'null' ? value : null;
}

function loadTestEnvFromFiles() {
  const keys = new Set(REQUIRED_TEST_ENV_KEYS);

  for (const file of TEST_ENV_FILES) {
    try {
      const content = readFileSync(path.join(process.cwd(), file), 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) continue;

        const key = trimmed.slice(0, separatorIndex).trim();
        if (keys.has(key) && process.env[key] === undefined) {
          process.env[key] = parseEnvValue(trimmed.slice(separatorIndex + 1));
        }
      }
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

function assertRequiredTestEnv() {
  const missing = REQUIRED_TEST_ENV_KEYS.filter((key) => !usableEnvValue(process.env[key]));
  if (missing.length === 0) return;

  throw new Error([
    `Missing required test environment variables: ${missing.join(', ')}.`,
    'Set these values in .env.test, .env.local, .env, .dev.vars, .env.test.example, or CI.',
  ].join('\n'));
}

loadTestEnvFromFiles();
assertRequiredTestEnv();

// Database-backed review flow tests can be slow on CI.
vi.setConfig({ testTimeout: 300000 });

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
// DB-backed specs use a fresh in-memory node:sqlite D1 per createTestEnv()
// (see test/d1-sqlite.ts), so there is no shared external database to reset
// between tests. This app runs entirely on D1 — there is no Postgres.
