import postgres from 'postgres';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(rootDir, 'db', 'migrations');
const initialMigration = '001_initial.sql';
const migrationLockId = 93741624;

function parseEnvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

async function readDatabaseUrlFromEnvFiles() {
  const envFiles = ['.dev.vars', '.env.local', '.env'];

  for (const file of envFiles) {
    try {
      const content = await readFile(path.join(rootDir, file), 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) continue;

        const key = trimmed.slice(0, separatorIndex).trim();
        if (key === 'DATABASE_URL') {
          return parseEnvValue(trimmed.slice(separatorIndex + 1));
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return null;
}

const databaseUrl = process.env.DATABASE_URL ?? await readDatabaseUrlFromEnvFiles();

if (!databaseUrl) {
  console.error([
    'DATABASE_URL is required to run database migrations.',
    'Cloudflare Worker secrets are not readable by this local Node script.',
    'Set DATABASE_URL in your shell/CI environment or add it to .dev.vars, .env.local, or .env.',
  ].join('\n'));
  process.exit(1);
}

const sql = postgres(databaseUrl, {
  max: 1,
  fetch_types: false,
  prepare: false,
  onnotice: false,
});

function query(sqlText, params = []) {
  return sql.unsafe(sqlText, params, { prepare: false });
}

async function tableExists(tableName) {
  const rows = await query('SELECT to_regclass($1) AS name', [`public.${tableName}`]);
  return rows[0]?.name !== null;
}

async function appliedMigrations() {
  const rows = await query('SELECT name FROM schema_migrations ORDER BY name ASC');
  return new Set(rows.map((row) => row.name));
}

function readDollarQuoteTag(sqlText, index) {
  if (sqlText[index] !== '$') return null;

  let cursor = index + 1;
  while (cursor < sqlText.length && /[A-Za-z0-9_]/.test(sqlText[cursor])) {
    cursor += 1;
  }

  if (sqlText[cursor] !== '$') return null;
  return sqlText.slice(index, cursor + 1);
}

function splitSqlStatements(sqlText) {
  const statements = [];
  let start = 0;
  let index = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  let lineComment = false;
  let blockComment = false;
  let dollarQuoteTag = null;

  while (index < sqlText.length) {
    const char = sqlText[index];
    const next = sqlText[index + 1];

    if (lineComment) {
      if (char === '\n') lineComment = false;
      index += 1;
      continue;
    }

    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (dollarQuoteTag) {
      if (sqlText.startsWith(dollarQuoteTag, index)) {
        index += dollarQuoteTag.length;
        dollarQuoteTag = null;
        continue;
      }
      index += 1;
      continue;
    }

    if (singleQuoted) {
      if (char === "'" && next === "'") {
        index += 2;
        continue;
      }
      if (char === "'") singleQuoted = false;
      index += 1;
      continue;
    }

    if (doubleQuoted) {
      if (char === '"' && next === '"') {
        index += 2;
        continue;
      }
      if (char === '"') doubleQuoted = false;
      index += 1;
      continue;
    }

    if (char === '-' && next === '-') {
      lineComment = true;
      index += 2;
      continue;
    }

    if (char === '/' && next === '*') {
      blockComment = true;
      index += 2;
      continue;
    }

    const tag = readDollarQuoteTag(sqlText, index);
    if (tag) {
      dollarQuoteTag = tag;
      index += tag.length;
      continue;
    }

    if (char === "'") {
      singleQuoted = true;
      index += 1;
      continue;
    }

    if (char === '"') {
      doubleQuoted = true;
      index += 1;
      continue;
    }

    if (char === ';') {
      const statement = sqlText.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }

    index += 1;
  }

  const finalStatement = sqlText.slice(start).trim();
  if (finalStatement) statements.push(finalStatement);

  return statements;
}

async function ensureMigrationTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function bootstrapLegacyDatabase(migrationFiles) {
  const applied = await appliedMigrations();
  if (applied.size > 0 || applied.has(initialMigration) || !migrationFiles.includes(initialMigration)) {
    return;
  }

  const hasExistingSchema = await tableExists('jobs');
  if (!hasExistingSchema) {
    return;
  }

  await query(
    'INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
    [initialMigration],
  );
  console.log(`Marked ${initialMigration} as applied for existing database.`);
}

async function runMigration(name) {
  const filePath = path.join(migrationsDir, name);
  const migrationSql = await readFile(filePath, 'utf8');

  console.log(`Applying ${name}...`);
  for (const statement of splitSqlStatements(migrationSql)) {
    await query(statement);
  }
  await query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
  console.log(`Applied ${name}.`);
}

async function main() {
  await query('SELECT pg_advisory_lock($1)', [migrationLockId]);
  try {
    await ensureMigrationTable();

    const migrationFiles = (await readdir(migrationsDir))
      .filter((name) => /^\d+_.+\.sql$/.test(name))
      .sort();

    await bootstrapLegacyDatabase(migrationFiles);

    const applied = await appliedMigrations();
    for (const migration of migrationFiles) {
      if (!applied.has(migration)) {
        await runMigration(migration);
      }
    }

    console.log('Database migrations are up to date.');
  } finally {
    await query('SELECT pg_advisory_unlock($1)', [migrationLockId]);
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
