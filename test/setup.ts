import { vi } from 'vitest';

// Global mocks for Cloudflare environment
vi.stubGlobal('QUEUE', {
  send: async (msg: any) => {
    console.log('Mock Queue Send:', msg);
  },
});

// Neon Database URL for testing
// Provided by user: postgresql://neondb_owner:npg_SZg5DNCBdl0T@ep-twilight-bonus-a1xcg0jb-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
process.env.TEST_DATABASE_URL = 'postgresql://neondb_owner:npg_SZg5DNCBdl0T@ep-twilight-bonus-a1xcg0jb-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

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
        const sql = getDb({ NEON_DATABASE_URL: process.env.TEST_DATABASE_URL });
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
