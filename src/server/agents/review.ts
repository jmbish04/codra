import { AIChatAgent } from "@cloudflare/ai-chat";
import { runGuardianAgent, lastUserText } from "@server/services/guardian-agent";
import { GithubConnector } from "./codemode";
import {
  createCodemodeRuntime,
  DynamicWorkerExecutor,
  type CodemodeRuntimeHandle,
} from "@cloudflare/codemode";
import { getSecretStoreBinding } from "@server/utils/secrets";
import codeReviewSkill from "../skills/code-review/SKILL.md?raw";
import cloudflareJediSkill from "../skills/cloudflare-jedi/SKILL.md?raw";
import workersBestPracticesSkill from "../skills/workers-best-practices/SKILL.md?raw";

export class ReviewAgent extends AIChatAgent<any> {
  async onStart() {
    await this.addMcpServer("github", this.env.GitHubLikeMCP);
    await this.addMcpServer("cloudflare-docs", "https://docs.mcp.cloudflare.com/mcp");

    try {
      const token = await getSecretStoreBinding(this.env, "CF_API_TOKEN");
      if (token && token.trim().length > 0) {
        await this.addMcpServer("cloudflare-api", "https://mcp.cloudflare.com/mcp", {
          transport: {
            headers: {
              Authorization: `Bearer ${token.trim()}`
            }
          }
        });
      }
    } catch (err) {
      // Ignore if binding doesn't exist or fails to authenticate
    }
  }

  #runtime(): CodemodeRuntimeHandle {
    const server = this.mcp.listServers().find((s) => s.name === "github");
    if (!server) throw new Error("GitHub MCP server is not registered.");
    const conn = this.mcp.mcpConnections[server.id];
    if (!conn) throw new Error("GitHub MCP connection is not available.");

    const github = new GithubConnector(this.ctx, this.env, conn);

    return createCodemodeRuntime({
      ctx: this.ctx,
      executor: new DynamicWorkerExecutor({ loader: this.env.LOADER as any }),
      connectors: [github],
    });
  }

  async onChatMessage(): Promise<Response> {
    // Runs the reviewer loop through core-guardian via the OpenAI Agents SDK — no
    // Cloudflare Agents SDK / Durable Object LLM loop. TODO(guardian-agents):
    // (1) port the codemode + MCP tools (post PR review comments) to guardian-agent
    // `Tool`s, and (2) stream the reply. Guardian's OpenAI-compat endpoint is not
    // live yet, so this 404s until the tracked issue ships.
    const text = await runGuardianAgent(this.env, {
      task: "CODE_REVIEW",
      name: "codra-reviewer",
      instructions: `You are an expert code reviewer in the Codra review engine. Identify bugs, security issues, and anti-patterns, and give actionable line-level feedback.\n\n=== CODE REVIEW SKILL ===\n${codeReviewSkill}\n=== CLOUDFLARE JEDI SKILL ===\n${cloudflareJediSkill}\n=== WORKERS BEST PRACTICES SKILL ===\n${workersBestPracticesSkill}`,
      input: lastUserText(this.messages),
    });
    return new Response(text, { headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
