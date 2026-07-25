ALTER TABLE `best_practices` ADD `review_status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `best_practices` ADD `rejection_reason` text;--> statement-breakpoint
ALTER TABLE `best_practices` ADD `source` text;--> statement-breakpoint
ALTER TABLE `best_practices` ADD `source_pr_number` integer;--> statement-breakpoint
ALTER TABLE `best_practices` ADD `source_repo` text;