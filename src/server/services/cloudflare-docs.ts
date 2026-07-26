import { logger } from '@server/core/logger';

const DOCS_MCP_ENDPOINT = 'https://docs.mcp.cloudflare.com/mcp';

/**
 * Query the official Cloudflare docs MCP server's `search_cloudflare_documentation`
 * tool over its stateless Streamable-HTTP transport. Returns the concatenated
 * doc text, or '' on any failure (best-effort — never throws).
 */
export async function searchCloudflareDocs(query: string, opts?: { maxChars?: number; timeoutMs?: number }): Promise<string> {
  const maxChars = opts?.maxChars ?? 8000;
  const timeoutMs = opts?.timeoutMs ?? 12000;
  try {
    const res = await fetch(DOCS_MCP_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'search_cloudflare_documentation', arguments: { query } },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      logger.warn(`Cloudflare docs MCP returned ${res.status}`);
      return '';
    }

    const raw = await res.text();
    const text = extractToolText(raw);
    return text.slice(0, maxChars);
  } catch (err) {
    logger.warn('searchCloudflareDocs failed', { error: err instanceof Error ? err.message : String(err) });
    return '';
  }
}

/**
 * Parse a JSON-RPC tool result from either a plain JSON body or an SSE
 * (text/event-stream) body, returning the joined text content blocks.
 */
export function extractToolText(body: string): string {
  const payloads: string[] = [];
  if (body.includes('data:')) {
    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:')) payloads.push(trimmed.slice(5).trim());
    }
  } else {
    payloads.push(body);
  }

  for (const p of payloads) {
    try {
      const msg = JSON.parse(p);
      const content = msg?.result?.content;
      if (Array.isArray(content)) {
        return content
          .filter((c: any) => c?.type === 'text' && typeof c.text === 'string')
          .map((c: any) => c.text)
          .join('\n\n')
          .trim();
      }
    } catch {
      // skip non-JSON data lines
    }
  }
  return '';
}
