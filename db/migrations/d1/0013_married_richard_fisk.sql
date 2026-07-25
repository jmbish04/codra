CREATE TABLE `missing_secret_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`owner` text NOT NULL,
	`repo` text NOT NULL,
	`secret_name` text NOT NULL,
	`store_id` text NOT NULL,
	`triggering_pr_number` integer,
	`resolved` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `standard_secret_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`binding_name` text NOT NULL,
	`secret_name` text NOT NULL,
	`store_id` text NOT NULL,
	`description` text,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
