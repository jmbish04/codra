CREATE TABLE `jules_interactions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`repository` text,
	`pr_number` integer,
	`direction` text DEFAULT 'outbound' NOT NULL,
	`kind` text NOT NULL,
	`text` text,
	`status` text DEFAULT 'started' NOT NULL,
	`error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_jint_session` ON `jules_interactions` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_jint_pr` ON `jules_interactions` (`repository`,`pr_number`);--> statement-breakpoint
ALTER TABLE `jules_sessions` ADD `created_pr_number` integer;--> statement-breakpoint
ALTER TABLE `jules_sessions` ADD `created_pr_url` text;