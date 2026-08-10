
-- Seed ORM Best Practice for Cloudflare Workers
INSERT INTO best_practices (id, name, infra_id, criteria, instructions, is_active) VALUES
('bp-orm-cf-workers', 'ORM Enforcement for Cloudflare Workers', 'cloudflare-workers', 'sql, select, insert, update, delete', '[{"type":"h3","children":[{"text":"ORM Enforcement for Cloudflare Workers"}]},{"type":"p","children":[{"text":"Raw SQL is forbidden in standard worker code. Always use Drizzle ORM and migrations when database interactions are targeted for D1."}]},{"type":"p","children":[{"text":"Raw SQL is ONLY allowed within Durable Objects or the Cloudflare Agents SDK."}]}]', 1)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  infra_id = excluded.infra_id,
  criteria = excluded.criteria,
  instructions = excluded.instructions,
  is_active = excluded.is_active,
  updated_at = CURRENT_TIMESTAMP;

-- Seed ORM Best Practice for Python
INSERT INTO best_practices (id, name, infra_id, criteria, instructions, is_active) VALUES
('bp-orm-python', 'ORM Enforcement for Python', 'python', 'sql, select, insert, update, delete', '[{"type":"h3","children":[{"text":"ORM Enforcement for Python"}]},{"type":"p","children":[{"text":"Raw SQL is forbidden in Python code. Always use SQLAlchemy ORM."}]}]', 1)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  infra_id = excluded.infra_id,
  criteria = excluded.criteria,
  instructions = excluded.instructions,
  is_active = excluded.is_active,
  updated_at = CURRENT_TIMESTAMP;

-- Seed D1 Bulk Insert Batching Required Integration Pattern for Cloudflare Workers
INSERT INTO best_practices (id, name, infra_id, criteria, instructions, is_active) VALUES
('bp-d1-batch-chunking', 'D1 Bulk Insert Batching', 'cloudflare-workers', 'd1, db.insert, .values, db.batch, bulk insert', '[{"type":"h3","children":[{"text":"D1 Bulk Insert Batching (Required Integration Pattern)"}]},{"type":"p","children":[{"text":"CHECK PROCEDURE — evaluate this file and report pass or violation for the practice \"D1 Bulk Insert Batching\"."}]},{"type":"p","children":[{"text":"Trigger: this file reads/writes Cloudflare D1 (Drizzle db.insert/db.update, SQL, or a migration). If it does not, status = pass."}]},{"type":"p","children":[{"text":"When triggered, it is a VIOLATION if any of these fail:"}]},{"type":"ul","children":[{"type":"li","children":[{"text":"Bulk/multi-row inserts must be chunked by "},{"text":"Math.floor(100 / COLUMNS_PER_ROW)","code":true},{"text":" (D1 caps a query at 100 bound parameters)."}]},{"type":"li","children":[{"text":"Chunks must be flushed in a single "},{"text":"db.batch()","code":true},{"text":" call, not a sequential loop of awaited db.insert() calls."}]},{"type":"li","children":[{"text":"Database access uses Drizzle ORM + migrations (no raw SQL in standard worker code)."}]}]},{"type":"p","children":[{"text":"Report: { practice: \"D1 Bulk Insert Batching\", status: \"pass\" | \"violation\", note: \"<what you found>\" }."}]}]', 1)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  infra_id = excluded.infra_id,
  criteria = excluded.criteria,
  instructions = excluded.instructions,
  is_active = excluded.is_active,
  updated_at = CURRENT_TIMESTAMP;
