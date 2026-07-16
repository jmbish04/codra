CREATE TABLE `changelog_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`job_id` text NOT NULL,
	`repository_id` integer NOT NULL,
	`pr_number` integer NOT NULL,
	`pr_url` text,
	`head_ref` text,
	`commit_sha` text,
	`tag` text,
	`area` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`date` text NOT NULL,
	`changes_json` text,
	`detail_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `changelog_entries_slug_unique` ON `changelog_entries` (`slug`);--> statement-breakpoint
CREATE INDEX `changelog_entries_job_idx` ON `changelog_entries` (`job_id`);--> statement-breakpoint
CREATE INDEX `changelog_entries_repo_pr_idx` ON `changelog_entries` (`repository_id`,`pr_number`);--> statement-breakpoint
CREATE INDEX `changelog_entries_created_idx` ON `changelog_entries` (`created_at`);