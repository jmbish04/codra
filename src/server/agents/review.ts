import { AIChatAgent } from "@cloudflare/ai-chat";
import { createWorkersAI } from "workers-ai-provider";
import { streamText, convertToModelMessages, stepCountIs } from "ai";
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

  async onChatMessage() {
    const workersai = createWorkersAI({ binding: this.env.AI });
    
    const result = streamText({
      model: workersai("@cf/moonshotai/kimi-k2.7-code", {
        sessionAffinity: this.sessionAffinity,
      }),
      system: `
        You are an expert code reviewer acting as a subagent in the Codra code review engine.
        Your task is to review a specific file provided in the PR or commit diff, identify issues, and provide actionable feedback.
        You have a \`codemode\` tool that runs TypeScript inside a sandbox.
        Inside the sandbox:
          - await codemode.search("query") to discover connector methods
          - await codemode.describe("connector.method") for TypeScript docs
          - await <connector>.<method>(args) to call a method directly
        Connectors: \`github\`.

        CRITICAL INSTRUCTIONS:
        1. Identify bugs, security vulnerabilities, memory leaks, performance bottlenecks, and architectural anti-patterns.
        2. Call the \`github.create_pull_request_review_comment\` tool for EACH finding to drop line-level comments on the actual impacted code.
        3. You have access to the \`cloudflare-docs\` MCP tools. If you have any questions or need to double-check Cloudflare APIs, limits, configuration, or Workers best practices, use the \`cloudflare-docs\` tools to search and consult the official documentation.
        4. You have access to the \`cloudflare-api\` MCP tools. When you are reviewing a \`wrangler.jsonc\` or \`wrangler.json\` file:
           - You MUST verify that all binding IDs (e.g. KV namespace IDs, D1 database IDs, R2 bucket names, etc.) configured in wrangler.jsonc actually exist in the user's Cloudflare account using \`cloudflare-api.execute\` to call the Cloudflare API.
           - If you come across a binding ID that does not exist/is not registered to the user's account, OR is tied to another worker project, OR is a placeholder like "enter id here", use \`cloudflare-api.execute\` to create a new resource (KV namespace, D1 database, R2 bucket, etc.) using the worker name prefix from wrangler.jsonc/wrangler.json.
           - After creating the resource, generate a pull request review comment on wrangler.jsonc/wrangler.json with the suggested new IDs to update the configuration file.
        5. Incorporate best practices from the following guidelines:
        === CODE REVIEW SKILL ===
        ${codeReviewSkill}
        === CLOUDFLARE JEDI SKILL ===
        ${cloudflareJediSkill}
        === WORKERS BEST PRACTICES SKILL ===
        ${workersBestPracticesSkill}
      `,
      messages: await convertToModelMessages(this.messages),
      tools: {
        codemode: this.#runtime().tool(),
        ...this.mcp.getAITools(),
      },
      stopWhen: stepCountIs(10),
    });

    return result.toUIMessageStreamResponse();
  }
}
