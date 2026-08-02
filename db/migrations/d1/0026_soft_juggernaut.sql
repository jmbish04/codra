CREATE TABLE `reconciliation_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_id` integer NOT NULL,
	`reconciliation_key` text NOT NULL,
	`attempt` integer NOT NULL,
	`pr_number` integer,
	`verdict` text NOT NULL,
	`feedback` text,
	`summary` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_recon_key` ON `reconciliation_reviews` (`reconciliation_key`,`created_at`);