import { sqliteTable, integer, unique, index } from 'drizzle-orm/sqlite-core';
import { kb_repos } from './kb-repos';
import { kb_tags } from './kb-tags';

export const kb_repo_tags = sqliteTable('kb_repo_tags', {
  repo_id: integer('repo_id').notNull().references(() => kb_repos.id, { onDelete: 'cascade' }),
  tag_id: integer('tag_id').notNull().references(() => kb_tags.id, { onDelete: 'cascade' }),
}, (t) => [
  unique().on(t.repo_id, t.tag_id),
  index('kb_repo_tags_repo_id_idx').on(t.repo_id),
  index('kb_repo_tags_tag_id_idx').on(t.tag_id),
]);
