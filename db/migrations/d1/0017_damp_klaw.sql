CREATE TABLE `docs_review_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`trigger` text NOT NULL,
	`skill` text NOT NULL,
	`criteria` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT INTO `docs_review_rules` (`id`,`name`,`trigger`,`skill`,`criteria`,`enabled`,`sort_order`) VALUES
('a1000000-0000-4000-8000-000000000001','Agents SDK — Durable Objects & migrations','agents/|from [''"]agents[''"]|routeAgentRequest|AIChatAgent|extends Agent[^a-zA-Z]|useAgent','agents-sdk','When the Agents SDK is involved, verify Durable Objects are handled correctly: all interactions with the DO go through Agents SDK methods (not raw DO stubs); DO migrations are declared in wrangler.jsonc; and the DO classes are properly exported from the Worker entrypoint.',1,0),
('a1000000-0000-4000-8000-000000000002','Raw Durable Objects — billing & routing','extends DurableObject|DurableObjectNamespace|idFromName|idFromString|state.acceptWebSocket|blockConcurrencyWhile|\.fetch\(.*stub','workers-best-practices','When interacting with raw Durable Objects (e.g. a WebSocket DO, not the Agents SDK), ensure the code engages DOs correctly for alarms, routing, and stubs — and that the approach will not cause excessive Durable Object billed wall-clock/duration (avoid holding the DO awake, prefer alarms over polling, close idle WebSockets).',1,1);
