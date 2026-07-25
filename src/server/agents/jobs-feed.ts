import { DurableObject } from 'cloudflare:workers';

/**
 * A single global broadcast channel for the jobs dashboard. Clients connect via
 * WebSocket (`/ws`); the worker POSTs `/broadcast` whenever a job is created or
 * changes status, and every connected client is notified to refresh in
 * real time. Broadcast-only — no durable storage.
 */
export class JobsFeed extends DurableObject {
  private sessions = new Set<WebSocket>();

  async fetch(request: Request) {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected Upgrade: websocket', { status: 400 });
      }
      const [client, server] = Object.values(new WebSocketPair());
      server.accept();
      this.sessions.add(server);
      server.addEventListener('close', () => this.sessions.delete(server));
      server.addEventListener('error', () => this.sessions.delete(server));
      try { server.send(JSON.stringify({ type: 'connected' })); } catch { /* ignore */ }
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/broadcast' && request.method === 'POST') {
      const payload = await request.text();
      for (const session of this.sessions) {
        try { session.send(payload); } catch { this.sessions.delete(session); }
      }
      return new Response('OK');
    }

    return new Response('Not found', { status: 404 });
  }
}
