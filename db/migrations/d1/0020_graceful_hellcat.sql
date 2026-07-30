CREATE TABLE `jules_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`owner` text NOT NULL,
	`repo` text NOT NULL,
	`triggering_pr_number` integer NOT NULL,
	`triggering_job_id` text,
	`state` text DEFAULT 'staged' NOT NULL,
	`prompt` text NOT NULL,
	`gap_summary` text NOT NULL,
	`session_id` text,
	`session_url` text,
	`session_state` text,
	`error_msg` text,
	`pr_comment_id` integer
);
