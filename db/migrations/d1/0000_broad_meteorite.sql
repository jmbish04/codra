CREATE TABLE `repositories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`installation_id` integer NOT NULL,
	`owner` text NOT NULL,
	`repo` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`retry_of_job_id` text,
	`check_run_id` integer,
	`review_id` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`started_at` text,
	`finished_at` text,
	`repository_id` integer NOT NULL,
	`pr_number` integer NOT NULL,
	`total_input_tokens` integer DEFAULT 0,
	`total_output_tokens` integer DEFAULT 0,
	`file_count` integer DEFAULT 0,
	`comment_count` integer DEFAULT 0,
	`overall_confidence_score` real,
	`commit_sha` blob NOT NULL,
	`base_sha` blob NOT NULL,
	`trigger` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`verdict` text,
	`pr_title` text,
	`pr_author` text,
	`head_ref` text,
	`base_ref` text,
	`summary_model` text,
	`overall_correctness` text,
	`error_msg` text,
	`summary_markdown` text,
	`config_snapshot` text,
	`steps` text DEFAULT '[]',
	`check_run_completed_at` text,
	`lease_owner` text,
	`lease_expires_at` text,
	`heartbeat_at` text,
	`recovery_count` integer DEFAULT 0 NOT NULL,
	`last_queue_message_at` text,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `file_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`diff_line_count` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`duration_ms` integer,
	`confidence_score` real,
	`file_status` text NOT NULL,
	`verdict` text,
	`file_path` text NOT NULL,
	`model_used` text NOT NULL,
	`model_provider` text,
	`overall_correctness` text,
	`file_summary` text,
	`error_msg` text,
	`diff_input` text,
	`raw_ai_output` text,
	`transient_error_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `review_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_review_id` text NOT NULL,
	`line` integer,
	`position` integer,
	`path` text NOT NULL,
	`severity` text NOT NULL,
	`category` text DEFAULT 'quality' NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`code_suggestion` text,
	FOREIGN KEY (`file_review_id`) REFERENCES `file_reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `repo_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`repository_id` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`main_model` text,
	`parsed_json` text,
	`fallback_models` text DEFAULT '[]',
	`size_overrides` text,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repo_configs_repository_id_unique` ON `repo_configs` (`repository_id`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`received_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`repository_id` integer,
	`delivery_id` text NOT NULL,
	`event_name` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_deliveries_delivery_id_unique` ON `webhook_deliveries` (`delivery_id`);--> statement-breakpoint
CREATE TABLE `llm_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`api_format` text NOT NULL,
	`base_url` text,
	`encrypted_api_key` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `llm_providers_name_unique` ON `llm_providers` (`name`);--> statement-breakpoint
CREATE TABLE `model_configs` (
	`model_id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	`rpm` integer,
	`tpm` integer,
	`rpd` integer,
	`provider` text NOT NULL,
	`provider_id` text NOT NULL,
	`model_name` text NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `llm_providers`(`id`) ON UPDATE no action ON DELETE no action
);
