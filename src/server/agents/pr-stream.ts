import { DurableObject } from "cloudflare:workers";

/**
 * Real-time channel for a single PR's review comments. Clients connect via
 * WebSocket (`/ws`); the worker POSTs `/comment` and `/feedback` and every
 * connected client is notified.
 *
 * Uses the Durable Object WebSocket Hibernation API (`ctx.acceptWebSocket` /
 * `ctx.getWebSockets`) rather than an in-memory Set: connections are owned by
 * the runtime, so they survive the DO being evicted between broadcasts and the
 * DO doesn't stay pinned in memory just to hold idle sockets.
 */
export class PrReviewStream extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep idle clients alive across hibernation without waking the DO.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private broadcast(payload: string) {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(payload);
      } catch {
        try { socket.close(); } catch { /* already gone */ }
      }
    }
  }

  async fetch(request: Request) {
    const url = new URL(request.url);

    // Handle WebSocket upgrade
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected Upgrade: websocket", { status: 400 });
      }

      const [client, server] = Object.values(new WebSocketPair());
      // Hibernatable accept — the runtime tracks this socket and delivers
      // messages/closes to webSocketMessage/webSocketClose below.
      this.ctx.acceptWebSocket(server);

      return new Response(null, { status: 101, webSocket: client });
    }

    // Handle HTTP POST to add new comment(s) to be broadcasted. Accepts either
    // a single comment object (legacy) or an array of comments — the caller
    // batches a whole file's aggregated comments into one array so streaming
    // N comments costs 1 subrequest instead of N (Cloudflare's 50-subrequest
    // per-invocation cap otherwise gets blown by a multi-reviewer fan-out).
    if (url.pathname === "/comment" && request.method === "POST") {
      const body = await request.json<any>();
      const comments = Array.isArray(body) ? body : [body];
      for (const comment of comments) {
        this.broadcast(JSON.stringify({ type: "comment", data: comment }));
      }
      return new Response("OK");
    }

    // Handle feedback from coding agents
    if (url.pathname === "/feedback" && request.method === "POST") {
      const body = await request.json<any>();

      // Log lesson learned to EDGRAPH service binding
      await this.logLessonLearned(body);

      // Broadcast feedback to other sessions
      this.broadcast(JSON.stringify({ type: "feedback", data: body }));
      return new Response(JSON.stringify({ success: true }));
    }

    return new Response("Not found", { status: 404 });
  }

  // Broadcast-only channel: clients aren't expected to send anything, but the
  // hibernation API requires a handler for the socket to receive at all.
  async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer) {
    // no-op
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try { ws.close(code); } catch { /* already closing */ }
  }

  async webSocketError(ws: WebSocket) {
    try { ws.close(); } catch { /* already gone */ }
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
