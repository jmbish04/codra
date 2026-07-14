CREATE TABLE `best_practices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`infra_id` text NOT NULL,
	`criteria` text NOT NULL,
	`instructions` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`infra_id`) REFERENCES `infrastructures`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `infrastructures` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `infrastructures_name_unique` ON `infrastructures` (`name`);
--> statement-breakpoint
INSERT OR IGNORE INTO `infrastructures` (`id`, `name`) VALUES
('cloudflare-workers', 'Cloudflare Workers'),
('appsscript', 'Apps Script'),
('python', 'Python'),
('other', 'Other');