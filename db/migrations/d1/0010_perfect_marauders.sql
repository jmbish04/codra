CREATE TABLE `standardization_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`target_path` text NOT NULL,
	`source_url` text NOT NULL,
	`strategy` text DEFAULT 'create_if_missing' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT INTO `standardization_rules` (`id`, `target_path`, `source_url`, `strategy`, `enabled`, `sort_order`) VALUES
 (lower(hex(randomblob(16))), '.vscode/settings.json', 'https://github.com/jmbish04/core-github-standardization/blob/e3be46e0a7a1a0d22addb9c02abc8d6a51142321/.vscode/settings.json', 'merge_json', 1, 10),
 (lower(hex(randomblob(16))), '.assetsignore', 'https://github.com/jmbish04/core-github-standardization/blob/e3be46e0a7a1a0d22addb9c02abc8d6a51142321/.assetsignore', 'create_if_missing', 1, 20),
 (lower(hex(randomblob(16))), '.gitignore', 'https://github.com/jmbish04/core-github-standardization/blob/e3be46e0a7a1a0d22addb9c02abc8d6a51142321/.gitignore', 'create_if_missing', 1, 30),
 (lower(hex(randomblob(16))), '.wranglerignore', 'https://github.com/jmbish04/core-github-standardization/blob/e3be46e0a7a1a0d22addb9c02abc8d6a51142321/.wranglerignore', 'create_if_missing', 1, 40),
 (lower(hex(randomblob(16))), 'mcp.json', 'https://github.com/jmbish04/core-github-standardization/blob/e3be46e0a7a1a0d22addb9c02abc8d6a51142321/mcp.json', 'merge_mcp_servers', 1, 50),
 (lower(hex(randomblob(16))), 'utils/secrets.ts', 'https://github.com/jmbish04/core-github-standardization/blob/e3be46e0a7a1a0d22addb9c02abc8d6a51142321/workers/src/backend/src/utils/secrets.ts', 'create_if_missing', 1, 60);
