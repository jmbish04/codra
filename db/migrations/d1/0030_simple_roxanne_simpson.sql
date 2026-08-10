ALTER TABLE `jules_sessions` ADD `category` text DEFAULT 'INTERNAL_CODRA' NOT NULL;--> statement-breakpoint
ALTER TABLE `jules_sessions` ADD `kind` text DEFAULT 'docs' NOT NULL;--> statement-breakpoint
ALTER TABLE `jules_sessions` ADD `target_files` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `jules_sessions` ADD `automation_mode` text;