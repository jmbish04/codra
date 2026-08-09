ALTER TABLE `jobs` ADD `scope` text;--> statement-breakpoint
ALTER TABLE `repo_configs` ADD `docstring_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `repo_configs` ADD `toolbox_enabled` integer DEFAULT false NOT NULL;