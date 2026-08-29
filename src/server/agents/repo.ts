import { Agent } from "agents";
import { ReviewAgent } from "./review";
import { logger } from "../core/logger";

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

      // TODO(guardian-agents): the codemode tool-calling aggregation (post a
      // root-level summary comment) is deferred. All AI now routes through
      // core-guardian, which does not yet expose a tool-calling/streaming surface
      // the Vercel AI SDK can drive. This agentic path is not in the live review
      // flow (model.ts owns automated reviews); re-enable once guardian supports it.
      logger.warn(
        `RepoAgent AI aggregation for ${owner}/${repo}#${prNumber} is deferred pending core-guardian tool-calling support; ${results.length} file reviews collected but no summary posted`,
      );
    } catch (e) {
      logger.error(`Error processing PR: ${e}`);
    }
  }
}
