import { AIChatAgent } from "@cloudflare/ai-chat";
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
    // TODO(guardian-agents): this reviewer streams tool-calls (post PR review
    // comments) through the Vercel AI SDK. All AI now routes through
    // core-guardian, which does not yet expose a streaming/tool-calling surface
    // the AI SDK can drive. Deferred — the live automated review runs in model.ts.
    void codeReviewSkill; void cloudflareJediSkill; void workersBestPracticesSkill;
    throw new Error('ReviewAgent chat is pending migration to core-guardian streaming/tool-calling; unavailable.');
  }
}
