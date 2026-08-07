/**
 * Connectivity to the local OpenCode server: Workers VPC binding first, then
 * a cloudflared Tunnel (Cloudflare Access service token) on connectivity
 * failure. Bindings aren't in the generated `Env` type yet (Task 6 adds them
 * to wrangler.jsonc), so they're read defensively via a local typed view.
 */

const VPC_ORIGIN = 'https://opencode.internal';
const HEALTH_TIMEOUT_MS = 2000;

type OpenCodeBindings = {
  OPENCODE_VPC?: { fetch: (req: Request) => Promise<Response> };
  OPENCODE_TUNNEL_URL?: string;
  OPENCODE_ACCESS_CLIENT_ID?: { get(): Promise<string> };
  OPENCODE_ACCESS_CLIENT_SECRET?: { get(): Promise<string> };
};

/** Mirrors ProviderRequestError's retryable flag (src/server/models/types.ts):
 *  connectivity/5xx/timeout is retryable (caller's breaker trips); 4xx auth
 *  errors are not. */
export class OpenCodeError extends Error {
  constructor(message: string, public readonly retryable: boolean, public readonly status?: number) {
    super(message);
    this.name = 'OpenCodeError';
  }
}

export function isRetryableOpenCodeError(err: unknown): boolean {
  return err instanceof OpenCodeError && err.retryable;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class OpenCodeClient {
  private readonly bindings: OpenCodeBindings;

  constructor(env: Env) {
    this.bindings = env as unknown as OpenCodeBindings;
  }

  /** GET /health, 2s timeout. false if no transport is configured or both fail. */
  async health(signal?: AbortSignal): Promise<boolean> {
    try {
      const res = await this.send('/health', { method: 'GET' }, signal, HEALTH_TIMEOUT_MS);
      return res.ok;
    } catch {
      return false;
    }
  }

  /** POST /review; yields each JSONL line of the response body. */
  async *review(payload: unknown, signal?: AbortSignal): AsyncIterable<string> {
    const res = await this.send('/review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }, signal);
    const body = await res.text();
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) yield trimmed;
    }
  }

  /** VPC first; on a connectivity failure (network throw / 5xx / timeout),
   *  falls back to Tunnel. A 4xx from either transport is surfaced
   *  immediately (non-retryable, no fallback). If both transports fail
   *  connectivity, or neither is configured, throws retryable. */
  private async send(path: string, init: RequestInit, signal?: AbortSignal, timeoutMs?: number): Promise<Response> {
    let connectivityErr: unknown;

    if (this.bindings.OPENCODE_VPC) {
      try {
        return await this.viaVpc(path, init, signal, timeoutMs);
      } catch (err) {
        if (err instanceof OpenCodeError && !err.retryable) throw err;
        connectivityErr = err;
      }
    }

    if (this.bindings.OPENCODE_TUNNEL_URL) {
      try {
        return await this.viaTunnel(path, init, signal, timeoutMs);
      } catch (err) {
        if (err instanceof OpenCodeError && !err.retryable) throw err;
        connectivityErr = err;
      }
    }

    throw new OpenCodeError(
      connectivityErr !== undefined
        ? `OpenCode unreachable via VPC/Tunnel: ${describeError(connectivityErr)}`
        : 'No OpenCode transport configured (OPENCODE_VPC/OPENCODE_TUNNEL_URL unset)',
      true,
    );
  }

  private async viaVpc(path: string, init: RequestInit, signal?: AbortSignal, timeoutMs?: number): Promise<Response> {
    const vpc = this.bindings.OPENCODE_VPC!;
    let res: Response;
    try {
      res = await vpc.fetch(new Request(`${VPC_ORIGIN}${path}`, { ...init, signal: this.combineSignal(signal, timeoutMs) }));
    } catch (err) {
      throw new OpenCodeError(`VPC fetch failed: ${describeError(err)}`, true);
    }
    return this.classify(res, 'VPC');
  }

  private async viaTunnel(path: string, init: RequestInit, signal?: AbortSignal, timeoutMs?: number): Promise<Response> {
    const base = this.bindings.OPENCODE_TUNNEL_URL!;
    const [clientId, clientSecret] = await Promise.all([
      this.bindings.OPENCODE_ACCESS_CLIENT_ID?.get(),
      this.bindings.OPENCODE_ACCESS_CLIENT_SECRET?.get(),
    ]);
    const headers = new Headers(init.headers);
    if (clientId) headers.set('CF-Access-Client-Id', clientId);
    if (clientSecret) headers.set('CF-Access-Client-Secret', clientSecret);

    let res: Response;
    try {
      res = await fetch(`${base}${path}`, { ...init, headers, signal: this.combineSignal(signal, timeoutMs) });
    } catch (err) {
      throw new OpenCodeError(`Tunnel fetch failed: ${describeError(err)}`, true);
    }
    return this.classify(res, 'Tunnel');
  }

  private async classify(res: Response, transport: string): Promise<Response> {
    if (res.ok) return res;
    const retryable = res.status >= 500;
    const detail = await res.text().catch(() => '');
    throw new OpenCodeError(`${transport} request failed with ${res.status}${detail ? `: ${detail}` : ''}`, retryable, res.status);
  }

  private combineSignal(signal: AbortSignal | undefined, timeoutMs: number | undefined): AbortSignal | undefined {
    const signals = [signal, timeoutMs !== undefined ? AbortSignal.timeout(timeoutMs) : undefined].filter(
      (s): s is AbortSignal => s !== undefined,
    );
    if (signals.length === 0) return undefined;
    if (signals.length === 1) return signals[0];
    return AbortSignal.any(signals);
  }
}
