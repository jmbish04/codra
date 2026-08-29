ALTER TABLE `jobs` ADD `batch_account_id` text;--> statement-breakpoint
ALTER TABLE `api_usage` ADD `account_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `api_usage` ADD `account_label` text DEFAULT '' NOT NULL;