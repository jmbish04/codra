import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { AIChatAgent } from "@cloudflare/ai-chat";
import { createWorkersAI } from "workers-ai-provider";
import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { routeAgentRequest, callable } from "agents";
import {
  listBestPractices,
  createBestPractice,
  updateBestPractice,
  deleteBestPractice,
  listInfrastructures,
} from '@server/db/best-practices';
import { getSecretStoreBinding } from '@server/utils/secrets';
import {
  createCodemodeRuntime,
  DynamicWorkerExecutor,
  type CodemodeRuntimeHandle,
  type PendingAction,
  type ExecutionState,
  type Snippet,
} from "@cloudflare/codemode";
import { BrowserConnector, DurableBrowserSessionStore } from "agents/browser";
import { GithubConnector } from "./codemode";
import { RepoApiConnector } from "./codemode";

// ---------------------------------------------------------------------------
// Demo MCP server — a couple of reads and one approval-gated write.
// ---------------------------------------------------------------------------

export class GitHubLikeMCP extends McpAgent<any> {
  override server: any = new McpServer({ name: "GitHub-like Demo", version: "1.0.0" });

  async init() {
    this.server.tool(
      "list_pull_requests",
      "List pull requests for a repository.",
      {
        owner: z.string().describe("Repository owner"),
        repo: z.string().describe("Repository name"),
        state: z.enum(["open", "closed", "all"]).default("open"),
      } as any,
      async ({ owner, repo, state }: { owner: string; repo: string; state: string }) => ({
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              [
                {
                  number: 101,
                  title: "Add codemode connectors",
                  state,
                  url: `https://github.com/${owner}/${repo}/pull/101`,
                },
                {
                  number: 102,
                  title: "Document codemode",
                  state,
                  url: `https://github.com/${owner}/${repo}/pull/102`,
                },
              ],
              null,
              2,
            ),
          },
        ],
      }),
    );

    this.server.tool(
      "search_issues",
      "Search issues and pull requests.",
      { query: z.string().describe("Search query") } as any,
      async ({ query }: { query: string }) => ({
        content: [
          {
            type: "text" as const,
            text: `Search results for ${query}: #101 Add codemode connectors`,
          },
        ],
      }),
    );

    this.server.tool(
      "create_issue",
      "Create a new issue (write — requires approval).",
      {
        owner: z.string(),
        repo: z.string(),
        title: z.string(),
        body: z.string().optional(),
      } as any,
      async ({ owner, repo, title }: { owner: string; repo: string; title: string; body?: string }) => ({
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              number: 103,
              title,
              url: `https://github.com/${owner}/${repo}/issues/103`,
            }),
          },
        ],
      }),
    );
    this.server.tool(
      "create_issue_comment",
      "Create a comment on an issue or pull request.",
      {
        owner: z.string(),
        repo: z.string(),
        issue_number: z.number(),
        body: z.string(),
      } as any,
      async ({ owner, repo, issue_number, body }: { owner: string; repo: string; issue_number: number; body: string }) => ({
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              url: `https://github.com/${owner}/${repo}/issues/${issue_number}#issuecomment-1234567890`,
              body,
            }),
          },
        ],
      }),
    );
    this.server.tool(
      "create_pull_request_review_comment",
      "Create a review comment on a pull request.",
      {
        owner: z.string(),
        repo: z.string(),
        pull_number: z.number(),
        body: z.string(),
        commit_id: z.string(),
        path: z.string(),
        line: z.number(),
      } as any,
      async ({ owner, repo, pull_number, body, path, line }: { owner: string; repo: string; pull_number: number; body: string; path: string; line: number }) => ({
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              url: `https://github.com/${owner}/${repo}/pull/${pull_number}#discussion_r1234567890`,
              body,
              path,
              line,
            }),
          },
        ],
      }),
    );

    this.server.tool(
      "list_best_practices",
      "List all best practices and their criteria and instructions.",
      {} as any,
      async () => {
        const practices = await listBestPractices(this.env);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(practices, null, 2),
            },
          ],
        };
      }
    );

    this.server.tool(
      "list_infrastructures",
      "List all infrastructure categories.",
      {} as any,
      async () => {
        const infras = await listInfrastructures(this.env);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(infras, null, 2),
            },
          ],
        };
      }
    );

    this.server.tool(
      "create_best_practice",
      "Create a new best practice.",
      {
        name: z.string().describe("The descriptive name of the best practice"),
        infraId: z.string().describe("The infrastructure ID (e.g. cloudflare-workers, appsscript, python, other)"),
        infraName: z.string().optional().describe("The name of a new infrastructure if infraId is 'other'"),
        criteria: z.string().describe("Specific code criteria for when to evaluate this best practice"),
        instructions: z.string().describe("PlateJS JSON string representing custom instructions"),
        isActive: z.boolean().default(true).describe("Whether the best practice is active"),
      } as any,
      async (params: any) => {
        const practice = await createBestPractice(this.env, params);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(practice, null, 2),
            },
          ],
        };
      }
    );

    this.server.tool(
      "update_best_practice",
      "Update an existing best practice.",
      {
        id: z.string().describe("The ID of the best practice to update"),
        name: z.string().optional().describe("The updated name"),
        infraId: z.string().optional().describe("The updated infrastructure ID"),
        infraName: z.string().optional().describe("The new infrastructure name if infraId is 'other'"),
        criteria: z.string().optional().describe("The updated evaluation criteria"),
        instructions: z.string().optional().describe("The updated PlateJS JSON string instructions"),
        isActive: z.boolean().optional().describe("The updated active status"),
      } as any,
      async (params: any) => {
        const { id, ...rest } = params;
        const practice = await updateBestPractice(this.env, id, rest);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(practice, null, 2),
            },
          ],
        };
      }
    );

    this.server.tool(
      "delete_best_practice",
      "Delete a best practice.",
      {
        id: z.string().describe("The ID of the best practice to delete"),
      } as any,
      async ({ id }: { id: string }) => {
        await deleteBestPractice(this.env, id);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true }),
            },
          ],
        };
      }
    );
  }
}

// ---------------------------------------------------------------------------
// Chat agent
// ---------------------------------------------------------------------------

export class Chat extends AIChatAgent<any> {
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

  /**
   * Build the codemode runtime for this agent. Connectors are constructed
   * in-process (note: no `ExecutionContext` cast — the connector base accepts
   * `this.ctx`). The runtime is shared between the chat tool and the callable
   * approval/snippet methods below; its identity is its name, so connectors
   * can be added without forking executions or snippets.
   */
  #runtime(): CodemodeRuntimeHandle {
    const server = this.mcp.listServers().find((s) => s.name === "github");
    if (!server) throw new Error("GitHub MCP server is not registered.");
    const conn = this.mcp.mcpConnections[server.id];
    if (!conn) throw new Error("GitHub MCP connection is not available.");

    const github = new GithubConnector(this.ctx, this.env, conn);
    const repoApi = new RepoApiConnector(this.ctx, this.env);

    // Live browser over the Chrome DevTools Protocol. Sessions are one-shot
    // per execution by default; the model can call cdp.startSession() to
    // keep one alive across executions (dynamic mode).
    const browser = new BrowserConnector(this.ctx, {
      browser: this.env.BROWSER,
      store: new DurableBrowserSessionStore(this.ctx.storage),
      session: { mode: "dynamic" },
    });

    return createCodemodeRuntime({
      ctx: this.ctx,
      executor: new DynamicWorkerExecutor({ loader: this.env.LOADER as any }),
      connectors: [github, repoApi, browser],
    });
  }

  async onChatMessage() {
    const workersai = createWorkersAI({ binding: this.env.AI });

    const result = streamText({
      model: workersai("@cf/moonshotai/kimi-k2.7-code", {
        sessionAffinity: this.sessionAffinity,
      }),
      system: `
        You are a helpful assistant with a \`codemode\` tool that runs TypeScript.
        Inside the sandbox:
          - await codemode.search("query") to discover connector methods and saved snippets
          - await codemode.describe("connector.method") for TypeScript docs
          - await <connector>.<method>(args) to call a method directly
          - await codemode.run("name", input) to run a saved snippet
        Connectors: \`github\` (pull requests, issues), \`repoApi\` (repo metadata, releases), and \`cdp\` (a live browser over the Chrome DevTools Protocol — cdp.send, cdp.attachToTarget, cdp.spec).
        Some actions (like github.create_issue) require approval — the run pauses and resumes after the user approves. Write code as if the call returns normally.

        You also have direct access to the following tools:
        1. \`cloudflare-docs\`: Search and consult Cloudflare developer documentation.
        2. \`cloudflare-api\`: Access the entire Cloudflare API to view, verify, create, and manage Cloudflare resources (KV, D1, R2, etc.).

        The current date and time is ${new Date().toISOString()}.
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

  // ---- Callable methods for the approval / snippet UI -----------------------

  /** Actions awaiting approval across paused executions. */
  @callable()
  async pendingApprovals(): Promise<PendingAction[]> {
    return this.#runtime().pending();
  }

  /** Approve a paused execution and resume it; returns the resumed outcome. */
  @callable()
  async approveExecution(executionId: string) {
    return this.#runtime().approve({ executionId });
  }

  /** Reject a pending action, ending the execution. */
  @callable()
  async rejectExecution(executionId: string, seq: number): Promise<void> {
    await this.#runtime().reject({ seq, executionId });
  }

  /** Roll back an execution's applied, reversible actions. */
  @callable()
  async rollbackExecution(executionId: string): Promise<void> {
    await this.#runtime().rollback({ executionId });
  }

  /** The audit trail, newest first. */
  @callable()
  async executions(): Promise<ExecutionState[]> {
    return this.#runtime().executions(20);
  }

  /** Promote a completed execution's script into a reusable snippet. */
  @callable()
  async saveSnippet(
    name: string,
    description: string,
    executionId: string,
  ): Promise<Snippet> {
    return this.#runtime().saveSnippet(name, { description, executionId });
  }

  /** Saved snippets, surfaced to the model in search/describe. */
  @callable()
  async snippets(): Promise<Snippet[]> {
    return this.#runtime().snippets();
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/mcp")) {
      return GitHubLikeMCP.serve("/mcp", { binding: "GitHubLikeMCP" }).fetch(
        request,
        env,
        ctx,
      );
    }

    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  },
};
