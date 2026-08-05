CREATE TABLE `agent_heartbeats` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`hostname` text,
	`version` text,
	`active_sessions` integer DEFAULT 0 NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
