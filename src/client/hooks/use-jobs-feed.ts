import { useEffect, useRef, useState } from 'react';

/**
 * Subscribe to the realtime jobs feed (WebSocket at /api/jobs/stream). Calls
 * `onChange` (debounced) whenever a job is created or changes status, and
 * auto-reconnects. Returns whether the socket is currently connected.
 */
export function useJobsFeed(onChange: () => void): boolean {
  const cb = useRef(onChange);
  cb.current = onChange;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (closed) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      try {
        ws = new WebSocket(`${proto}://${location.host}/api/jobs/stream`);
      } catch {
        retry = setTimeout(connect, 4000);
        return;
      }
      ws.onopen = () => setConnected(true);
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'jobs-changed') {
            clearTimeout(debounce);
            debounce = setTimeout(() => cb.current(), 400);
          }
        } catch { /* ignore malformed */ }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 3000);
      };
      ws.onerror = () => { try { ws?.close(); } catch { /* ignore */ } };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      clearTimeout(debounce);
      try { ws?.close(); } catch { /* ignore */ }
    };
  }, []);

  return connected;
}
