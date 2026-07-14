import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rule1Instructions = [
  {
    type: 'h3',
    children: [{ text: 'ORM Enforcement for Cloudflare Workers' }]
  },
  {
    type: 'p',
    children: [
      { text: 'Raw SQL is forbidden in standard worker code. Always use Drizzle ORM and migrations when database interactions are targeted for D1.' }
    ]
  },
  {
    type: 'p',
    children: [
      { text: 'Raw SQL is ONLY allowed within Durable Objects or the Cloudflare Agents SDK.' }
    ]
  }
];

const rule2Instructions = [
  {
    type: 'h3',
    children: [{ text: 'ORM Enforcement for Python' }]
  },
  {
    type: 'p',
    children: [
      { text: 'Raw SQL is forbidden in Python code. Always use SQLAlchemy ORM.' }
    ]
  }
];

const rule1Json = JSON.stringify(rule1Instructions).replace(/'/g, "''");
const rule2Json = JSON.stringify(rule2Instructions).replace(/'/g, "''");

const sql = `
-- Seed ORM Best Practice for Cloudflare Workers
INSERT INTO best_practices (id, name, infra_id, criteria, instructions, is_active) VALUES
('bp-orm-cf-workers', 'ORM Enforcement for Cloudflare Workers', 'cloudflare-workers', 'sql, select, insert, update, delete', '${rule1Json}', 1)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  infra_id = excluded.infra_id,
  criteria = excluded.criteria,
  instructions = excluded.instructions,
  is_active = excluded.is_active,
  updated_at = CURRENT_TIMESTAMP;

-- Seed ORM Best Practice for Python
INSERT INTO best_practices (id, name, infra_id, criteria, instructions, is_active) VALUES
('bp-orm-python', 'ORM Enforcement for Python', 'python', 'sql, select, insert, update, delete', '${rule2Json}', 1)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  infra_id = excluded.infra_id,
  criteria = excluded.criteria,
  instructions = excluded.instructions,
  is_active = excluded.is_active,
  updated_at = CURRENT_TIMESTAMP;
`;

const outputPath = path.resolve(__dirname, './seed-sql-practices.sql');
fs.writeFileSync(outputPath, sql, 'utf-8');
console.log(`Successfully generated SQL seed file at: ${outputPath}`);
