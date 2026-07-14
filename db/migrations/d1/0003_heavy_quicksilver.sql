CREATE TABLE `api_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`source` text NOT NULL,
	`gateway_id` text DEFAULT '' NOT NULL,
	`datetime_hour` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gateway_unique_idx` ON `api_usage` (`source`,`provider`,`model`,`gateway_id`,`datetime_hour`);