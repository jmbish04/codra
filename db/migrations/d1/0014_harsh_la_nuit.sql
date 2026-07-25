CREATE TABLE `test_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`owner` text NOT NULL,
	`repo` text NOT NULL,
	`pr_number` integer NOT NULL,
	`kind` text NOT NULL,
	`method` text,
	`target` text NOT NULL,
	`reason` text,
	`params` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`status_code` integer,
	`result` text,
	`screenshot_url` text,
	`error` text,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
