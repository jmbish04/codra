import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * Config-driven repository standardization rules. When codra reviews a PR in a
 * Cloudflare Worker repo, it checks the repo's default branch against these
 * rules and, for any that are missing or drifted, opens a SEPARATE follow-up
 * PR (never touching the PR under review).
 *
 * strategy:
 *  - 'create_if_missing'   add the source file only if the target is absent or
 *                          empty; leave a non-empty existing file untouched.
 *  - 'merge_json'          deep-merge the source's top-level keys into the
 *                          target JSON (e.g. .vscode/settings.json).
 *  - 'merge_mcp_servers'   ensure every server under mcpServers/servers in the
 *                          source exists in the target; append missing ones.
 *  - 'overwrite'           always replace the target with the source content.
 */
export const standardizationRules = sqliteTable('standardization_rules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  target_path: text('target_path').notNull(),
  source_url: text('source_url').notNull(),
  strategy: text('strategy').notNull().default('create_if_missing'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  sort_order: integer('sort_order').notNull().default(0),
  updated_at: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});
