import { DurableObject } from 'cloudflare:workers';

/**
 * A single global broadcast channel for the jobs dashboard. Clients connect via
 * WebSocket (`/ws`); the worker POSTs `/broadcast` whenever a job is created or
 * changes status, and every connected client is notified to refresh in
 * real time. Broadcast-only — no durable storage.
 *
 * Uses the Durable Object WebSocket Hibernation API (`ctx.acceptWebSocket` /
 * `ctx.getWebSockets`) so connections are owned by the runtime and survive the
 * DO evicting between broadcasts instead of living in an in-memory Set.
 */
export class JobsFeed extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep idle clients alive across hibernation without waking the DO.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request) {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected Upgrade: websocket', { status: 400 });
      }
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      try { server.send(JSON.stringify({ type: 'connected' })); } catch { /* ignore */ }
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/broadcast' && request.method === 'POST') {
      const payload = await request.text();
      for (const socket of this.ctx.getWebSockets()) {
        try { socket.send(payload); } catch { try { socket.close(); } catch { /* gone */ } }
      }
      return new Response('OK');
    }

    return new Response('Not found', { status: 404 });
  }

  // Broadcast-only: clients aren't expected to send, but the hibernation API
  // needs a message handler for the socket to receive at all.
  async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer) {
    // no-op
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try { ws.close(code); } catch { /* already closing */ }
  }

  async webSocketError(ws: WebSocket) {
    try { ws.close(); } catch { /* already gone */ }
  }
}
