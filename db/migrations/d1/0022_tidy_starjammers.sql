CREATE TABLE `jules_orchestration_events` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`event` text NOT NULL,
	`payload` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_joe_task` ON `jules_orchestration_events` (`task_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `jules_orchestration_tasks` (
	`task_id` text PRIMARY KEY NOT NULL,
	`package_id` text NOT NULL,
	`repository_id` integer NOT NULL,
	`session_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`iterations` integer DEFAULT 0 NOT NULL,
	`last_pr_url` text,
	`error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_jot_status` ON `jules_orchestration_tasks` (`status`);--> statement-breakpoint
CREATE INDEX `idx_jot_session` ON `jules_orchestration_tasks` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_jot_package` ON `jules_orchestration_tasks` (`package_id`);