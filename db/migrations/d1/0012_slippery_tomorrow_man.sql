CREATE TABLE `agent_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`owner` text NOT NULL,
	`repo` text NOT NULL,
	`action_type` text NOT NULL,
	`summary` text NOT NULL,
	`files` text,
	`pr_number` integer,
	`pr_url` text,
	`triggering_pr_number` integer,
	`triggering_job_id` text
);
