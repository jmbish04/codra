import {
  McpConnector,
  type ConnectorTool,
  type McpConnectionLike,
} from "@cloudflare/codemode";

/**
 * GitHub connector — backed by an MCP server.
 *
 * Exposes GitHub-like tools (list_pull_requests, search_issues, create_issue)
 * in the codemode sandbox as `github.<method>(args)`. MCP tools are reads by
 * default; the `tool()` hook marks the write (`create_issue`) as requiring
 * approval, so the run pauses for the user before it executes.
 */
export class GithubConnector extends McpConnector<Env> {
  // Inside a Durable Object `this.ctx` is a `DurableObjectState`. The connector
  // base accepts either it or an `ExecutionContext` — no cast needed.
  constructor(
    ctx: DurableObjectState | ExecutionContext,
    env: Env,
    private conn: McpConnectionLike,
  ) {
    super(ctx, env);
  }

  override name() {
    return "github";
  }

  protected override instructions() {
    return "Use for GitHub-style repository, issue, and pull request questions.";
  }

  protected override createConnection() {
    return this.conn;
  }

  // Mark writes as approval-gated. The runtime pauses the run when the model
  // calls one of these, and resumes once the user approves.
  protected override tool(name: string, t: ConnectorTool): ConnectorTool {
    const writes = new Set([
      "create_issue",
      "create_planning_package",
      "submit_planning_revision",
      "update_plan_task",
      "request_fleet_run",
    ]);
    if (writes.has(name)) {
      return { ...t, requiresApproval: true };
    }
    return t;
  }
}
