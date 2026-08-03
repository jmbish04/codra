CREATE TABLE `fleet_jobs` (
	`job_id` text PRIMARY KEY NOT NULL,
	`repository_id` integer NOT NULL,
	`kind` text NOT NULL,
	`params_json` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`result_json` text,
	`error` text,
	`claimed_by` text,
	`created_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_fleet_jobs_status` ON `fleet_jobs` (`status`,`created_at`);