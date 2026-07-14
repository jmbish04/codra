import { sqliteTable, text, integer, unique } from 'drizzle-orm/sqlite-core';

export const repositories = sqliteTable('repositories', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  installation_id: integer('installation_id', { mode: 'number' }).notNull(),
  owner: text('owner').notNull(),
  repo: text('repo').notNull(),
}, (t) => [
  unique().on(t.owner, t.repo)
]);
