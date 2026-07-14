import { sqliteTable, integer, unique, index } from 'drizzle-orm/sqlite-core';
import { kb_repos } from './kb-repos';
import { kb_starred_lists } from './kb-starred-lists';

export const kb_repo_lists = sqliteTable('kb_repo_lists', {
  repo_id: integer('repo_id').notNull().references(() => kb_repos.id, { onDelete: 'cascade' }),
  list_id: integer('list_id').notNull().references(() => kb_starred_lists.id, { onDelete: 'cascade' }),
}, (t) => [
  unique().on(t.repo_id, t.list_id),
  index('kb_repo_lists_repo_id_idx').on(t.repo_id),
  index('kb_repo_lists_list_id_idx').on(t.list_id),
]);
