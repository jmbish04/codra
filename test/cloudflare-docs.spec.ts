import { extractToolText } from '@server/services/cloudflare-docs';

describe('extractToolText — Cloudflare docs MCP response parsing', () => {
  it('parses an SSE (text/event-stream) tool result', () => {
    const sse =
      'event: message\n' +
      'data: {"result":{"content":[{"type":"text","text":"Durable Objects docs"}]},"jsonrpc":"2.0","id":1}\n\n';
    expect(extractToolText(sse)).toBe('Durable Objects docs');
  });

  it('parses a plain JSON tool result and joins multiple text blocks', () => {
    const json = JSON.stringify({
      result: { content: [{ type: 'text', text: 'A' }, { type: 'image' }, { type: 'text', text: 'B' }] },
    });
    expect(extractToolText(json)).toBe('A\n\nB');
  });

  it('returns empty string on malformed or contentless payloads', () => {
    expect(extractToolText('data: not-json\n\n')).toBe('');
    expect(extractToolText('{"result":{}}')).toBe('');
    expect(extractToolText('')).toBe('');
  });
});
