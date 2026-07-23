CREATE TABLE `antigravity_interactions` (
	`interaction_id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`file_index` integer NOT NULL,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`output_text` text,
	`error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `antigravity_interactions_job_idx` ON `antigravity_interactions` (`job_id`);--> statement-breakpoint
CREATE TABLE `gemini_webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`received_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`webhook_id` text NOT NULL,
	`event_type` text NOT NULL,
	`interaction_id` text,
	`signature_verified` integer DEFAULT false NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gemini_webhook_events_webhook_id_unique` ON `gemini_webhook_events` (`webhook_id`);