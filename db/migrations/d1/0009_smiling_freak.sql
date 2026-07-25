ALTER TABLE `webhook_deliveries` ADD `outcome` text DEFAULT 'received' NOT NULL;--> statement-breakpoint
ALTER TABLE `webhook_deliveries` ADD `action` text;--> statement-breakpoint
ALTER TABLE `webhook_deliveries` ADD `pr_number` integer;--> statement-breakpoint
ALTER TABLE `webhook_deliveries` ADD `job_id` text;--> statement-breakpoint
ALTER TABLE `webhook_deliveries` ADD `error` text;