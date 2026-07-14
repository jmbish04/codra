CREATE TABLE `kb_repo_lists` (
	`repo_id` integer NOT NULL,
	`list_id` integer NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `kb_repos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`) REFERENCES `kb_starred_lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kb_repo_lists_repo_id_list_id_unique` ON `kb_repo_lists` (`repo_id`,`list_id`);--> statement-breakpoint
CREATE TABLE `kb_repo_tags` (
	`repo_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `kb_repos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `kb_tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kb_repo_tags_repo_id_tag_id_unique` ON `kb_repo_tags` (`repo_id`,`tag_id`);--> statement-breakpoint
CREATE TABLE `kb_repos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`github_id` integer NOT NULL,
	`full_name` text NOT NULL,
	`language` text,
	`topics` text DEFAULT '[]',
	`is_starred` integer DEFAULT false NOT NULL,
	`is_watched` integer DEFAULT false NOT NULL,
	`is_forked_by_me` integer DEFAULT false NOT NULL,
	`stargazers_count` integer,
	`starred_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kb_repos_github_id_unique` ON `kb_repos` (`github_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `kb_repos_full_name_unique` ON `kb_repos` (`full_name`);--> statement-breakpoint
CREATE TABLE `kb_starred_lists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`github_slug` text NOT NULL,
	`description` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kb_starred_lists_github_slug_unique` ON `kb_starred_lists` (`github_slug`);--> statement-breakpoint
CREATE TABLE `kb_tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`parent_id` integer,
	`color` text,
	`is_system` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `kb_tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kb_tags_name_unique` ON `kb_tags` (`name`);--> statement-breakpoint
CREATE TABLE `kb_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`github_id` integer NOT NULL,
	`login` text NOT NULL,
	`avatar_url` text,
	`bio` text,
	`is_following` integer DEFAULT false NOT NULL,
	`followers_count` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kb_users_github_id_unique` ON `kb_users` (`github_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `kb_users_login_unique` ON `kb_users` (`login`);