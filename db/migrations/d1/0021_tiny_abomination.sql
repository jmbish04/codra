CREATE TABLE `package_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`package_id` text NOT NULL,
	`revision_number` integer NOT NULL,
	`source` text NOT NULL,
	`jules_session_id` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`summary` text,
	`problem` text,
	`approach` text,
	`verification` text,
	`prd_markdown` text,
	`design_brief_markdown` text,
	`prompt_markdown` text,
	`context_r2_key` text,
	`context_bytes` integer,
	`context_sha256` text,
	`context_coverage_note` text,
	`created_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rev_pkg_created` ON `package_revisions` (`package_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `package_revisions_package_id_revision_number_unique` ON `package_revisions` (`package_id`,`revision_number`);--> statement-breakpoint
CREATE TABLE `package_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`package_id` text NOT NULL,
	`task_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`assignee` text,
	`pr_number` integer,
	`notes` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `package_tasks_package_id_task_key_unique` ON `package_tasks` (`package_id`,`task_key`);--> statement-breakpoint
CREATE TABLE `planning_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` integer NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`current_revision_id` text,
	`request_prompt_json` text,
	`created_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_pkg_repo_status_created` ON `planning_packages` (`repository_id`,`status`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `planning_packages_repository_id_slug_unique` ON `planning_packages` (`repository_id`,`slug`);--> statement-breakpoint
CREATE TABLE `revision_api_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`description` text
);
--> statement-breakpoint
CREATE INDEX `idx_api_changes_rev` ON `revision_api_changes` (`revision_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `revision_change_items` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_change_items_rev` ON `revision_change_items` (`revision_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `revision_code_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`file_path` text,
	`language` text,
	`intent` text,
	`content` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_code_cards_rev` ON `revision_code_cards` (`revision_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `revision_diagrams` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`caption` text,
	`mermaid` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_diagrams_rev` ON `revision_diagrams` (`revision_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `revision_file_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`path` text NOT NULL,
	`change_type` text NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE INDEX `idx_file_changes_rev` ON `revision_file_changes` (`revision_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `revision_migrations` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`tag` text,
	`sql` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_migrations_rev` ON `revision_migrations` (`revision_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `revision_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`task_key` text NOT NULL,
	`workstream` text,
	`phase` integer,
	`title` text NOT NULL,
	`description` text,
	`target_path` text,
	`change_type` text,
	`depends_on` text
);
--> statement-breakpoint
CREATE INDEX `idx_rev_tasks_rev` ON `revision_tasks` (`revision_id`,`ordinal`);