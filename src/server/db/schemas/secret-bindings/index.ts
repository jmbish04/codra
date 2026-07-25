import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * The secret-store secrets the user marked as "standard" for Cloudflare Worker
 * repos. During standardization, codra ensures each of these has a
 * secrets_store_secrets binding in the target repo's wrangler.jsonc.
 */
export const standardSecretBindings = sqliteTable('standard_secret_bindings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  binding_name: text('binding_name').notNull(),
  secret_name: text('secret_name').notNull(),
  store_id: text('store_id').notNull(),
  description: text('description'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  updated_at: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * When codra goes to add a standard secret binding but the secret no longer
 * exists in the store, it skips it and records it here for review.
 */
export const missingSecretReports = sqliteTable('missing_secret_reports', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  owner: text('owner').notNull(),
  repo: text('repo').notNull(),
  secret_name: text('secret_name').notNull(),
  store_id: text('store_id').notNull(),
  triggering_pr_number: integer('triggering_pr_number'),
  resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
});
