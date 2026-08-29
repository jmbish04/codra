import { Agent } from "agents";
import { ReviewAgent } from "./review";
import { logger } from "../core/logger";
import { runGuardianAgent } from "@server/services/guardian-agent";

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

      // Aggregate via the OpenAI Agents SDK routed through core-guardian (no
      // Cloudflare Agents SDK / Durable Object LLM loop). TODO(guardian-agents):
      // add a `post_pr_comment` guardian-agent tool so the model posts the summary
      // itself; for now we generate the text and log it (guardian's OpenAI-compat
      // endpoint is not live yet — this path 404s until the tracked issue ships).
      const summary = await runGuardianAgent(this.env, {
        task: "SUMMARY",
        name: "codra-review-aggregator",
        instructions:
          "You are the orchestrator of the Codra code review engine. Summarize the per-file reviews into a concise, professional root-level PR comment, then give a short fix plan for a coding agent or human.",
        input: `Code reviews for PR #${prNumber} in ${owner}/${repo}:\n\n${results.map((r) => `File: ${r.file}\nSummary: ${r.reviewOutput}`).join("\n\n")}`,
      });
      logger.info(`RepoAgent aggregation summary for ${owner}/${repo}#${prNumber}`, { summary });
    } catch (e) {
      logger.error(`Error processing PR: ${e}`);
    }
  }
}
