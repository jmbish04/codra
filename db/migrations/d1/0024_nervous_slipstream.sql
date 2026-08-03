CREATE TABLE `jules_activity_cache` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`task_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`type` text NOT NULL,
	`originator` text,
	`name` text,
	`create_time` text,
	`description` text,
	`message` text,
	`title` text,
	`reason` text,
	`plan_id` text,
	`plan_json` text,
	`artifacts_json` text,
	`ingested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_activity_task_seq` ON `jules_activity_cache` (`task_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_activity_session_id` ON `jules_activity_cache` (`session_id`,`activity_id`);--> statement-breakpoint
CREATE TABLE `jules_activity_sync` (
	`session_id` text PRIMARY KEY NOT NULL,
	`synced_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
