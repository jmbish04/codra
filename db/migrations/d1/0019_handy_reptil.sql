CREATE TABLE `file_review_costs` (
	`id` text PRIMARY KEY NOT NULL,
	`file_review_id` text NOT NULL,
	`job_id` text NOT NULL,
	`usage_type` text NOT NULL,
	`usage_amount` real DEFAULT 0 NOT NULL,
	`unit_price` real DEFAULT 0 NOT NULL,
	`per_units` real DEFAULT 1 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`total_cost` real DEFAULT 0 NOT NULL,
	`rate_source` text DEFAULT 'fallback' NOT NULL,
	`priced_at` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`file_review_id`) REFERENCES `file_reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `file_review_costs_file_review_idx` ON `file_review_costs` (`file_review_id`);--> statement-breakpoint
CREATE INDEX `file_review_costs_job_idx` ON `file_review_costs` (`job_id`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `total_cost_usd` real;--> statement-breakpoint
ALTER TABLE `file_reviews` ADD `total_cost_usd` real;