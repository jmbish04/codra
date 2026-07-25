CREATE TABLE `dismissed_standards` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`owner` text NOT NULL,
	`repo` text NOT NULL,
	`target_path` text NOT NULL,
	`closed_pr_number` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dismissed_standards_owner_repo_target_path_unique` ON `dismissed_standards` (`owner`,`repo`,`target_path`);