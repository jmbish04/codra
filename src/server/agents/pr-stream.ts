import { DurableObject } from "cloudflare:workers";

export class PrReviewStream extends DurableObject {
  private sessions = new Set<WebSocket>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request) {
    const url = new URL(request.url);

    // Handle WebSocket upgrade
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected Upgrade: websocket", { status: 400 });
      }

      const [client, server] = Object.values(new WebSocketPair());
      server.accept();
      this.sessions.add(server);

      server.addEventListener("close", () => {
        this.sessions.delete(server);
      });
      server.addEventListener("error", () => {
        this.sessions.delete(server);
      });

      return new Response(null, { status: 101, webSocket: client });
    }

    // Handle HTTP POST to add a new comment to be broadcasted
    if (url.pathname === "/comment" && request.method === "POST") {
      const body = await request.json<any>();
      // Broadcast to all active sessions
      const payload = JSON.stringify({ type: "comment", data: body });
      for (const session of this.sessions) {
        try {
          session.send(payload);
        } catch {
          this.sessions.delete(session);
        }
      }
      return new Response("OK");
    }

    // Handle feedback from coding agents
    if (url.pathname === "/feedback" && request.method === "POST") {
      const body = await request.json<any>();
      
      // Log lesson learned to EDGRAPH service binding
      await this.logLessonLearned(body);
      
      // Broadcast feedback to other sessions
      const payload = JSON.stringify({ type: "feedback", data: body });
      for (const session of this.sessions) {
        try {
          session.send(payload);
        } catch {
          this.sessions.delete(session);
        }
      }
      return new Response(JSON.stringify({ success: true }));
    }

    return new Response("Not found", { status: 404 });
  }

  async logLessonLearned(feedback: any) {
    // Log correction to EDGRAPH property graph service binding (https://github.com/jmbish04/core-github-api-edgraph)
    if ((this.env as any).EDGRAPH) {
      try {
        await (this.env as any).EDGRAPH.fetch("https://github.com/jmbish04/core-github-api-edgraph/api/lessons", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ruleId: feedback.ruleId || feedback.commentId,
            file: feedback.file,
            commentText: feedback.commentText,
            feedbackText: feedback.feedback,
            timestamp: new Date().toISOString()
          })
        });
      } catch (err) {
        console.error("Failed to log lesson to EDGRAPH service binding", err);
      }
    }
  }
}
