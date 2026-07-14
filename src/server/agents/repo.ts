import { Agent } from "agents";
import { ReviewAgent } from "./review";
import { logger } from "../core/logger";
import { generateText } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { GithubConnector } from "./codemode";
import { createCodemodeRuntime, DynamicWorkerExecutor } from "@cloudflare/codemode";

export class RepoAgent extends Agent<any> {
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname === "/webhook" && request.method === "POST") {
      const payload = await request.json<any>();
      if (payload.action === "opened" || payload.action === "synchronize") {
        const prNumber = payload.pull_request.number;
        const owner = payload.repository.owner.login;
        const repo = payload.repository.name;
        
        logger.info(`Starting review for ${owner}/${repo}#${prNumber}`);
        this.ctx.waitUntil(this.processPR(owner, repo, prNumber));
      }
      return new Response("OK");
    }
    return super.fetch(request);
  }

  async processPR(owner: string, repo: string, prNumber: number) {
    try {
      // Fetch the list of files changed from GitHub
      const filesResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files`, {
        headers: {
          "Authorization": `Bearer ${await this.env.GITHUB_TOKEN.get()}`,
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "Codra-App",
        }
      });
      
      if (!filesResponse.ok) {
        throw new Error(`Failed to fetch PR files: ${filesResponse.statusText}`);
      }
      
      const filesData = await filesResponse.json<any[]>();
      const files = filesData.map(f => f.filename);
      logger.info(`Fetched ${files.length} files for PR #${prNumber}`);

      const reviewPromises = files.map(async (file) => {
        const reviewAgent = await this.subAgent(ReviewAgent, `${owner}-${repo}-${prNumber}-${file}`);
        let reviewOutput = "";
        await (reviewAgent as any).chat(
          `Review file: ${file}\nOwner: ${owner}\nRepo: ${repo}\nPR: ${prNumber}`,
          { onFinish: (result: any) => { reviewOutput = result.text; } }
        );
        return { file, reviewOutput };
      });

      const results = await Promise.all(reviewPromises);

      // Aggregate the results and drop a root-level comment.
      const workersai = createWorkersAI({ binding: this.env.AI });
      
      const github = new GithubConnector(this.ctx, this.env, null as any);
      const runtime = createCodemodeRuntime({
        ctx: this.ctx,
        executor: new DynamicWorkerExecutor({ loader: this.env.LOADER as any }),
        connectors: [github],
      });

      const summaryPrompt = `
        Code reviews for PR #${prNumber} in ${owner}/${repo} have completed.
        Here are the summaries from the subagents:
        ${results.map(r => `File: ${r.file}\nSummary: ${r.reviewOutput}`).join("\n\n")}
        
        Write a concise, professional root-level PR comment summarizing the overall findings.
        Provide a prompt and instructions to a code agent or human to implement the recommended fixes.
        Use the codemode tool 'github.create_issue_comment' to drop this comment on the PR.
        Assume you have access to the tool via codemode.
      `;

      await generateText({
        model: workersai("@cf/moonshotai/kimi-k2.7-code"),
        system: "You are the orchestrator of the Codra code review engine. You have a `codemode` tool. Use `github.create_issue_comment(owner, repo, issue_number, body)` to post your summary.",
        prompt: summaryPrompt,
        tools: {
          codemode: runtime.tool(),
        },
      });

      logger.info(`Completed review aggregation for ${owner}/${repo}#${prNumber}`);
    } catch (e) {
      logger.error(`Error processing PR: ${e}`);
    }
  }
}
