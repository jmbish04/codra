type State = { failures: number; openedAt: number | null };

const THRESHOLD = 5;
const COOLDOWN_MS = 60_000;

/** Per-engine/provider breaker in KV. Trips only on retryable failures the
 *  caller decides to record (connectivity/429/503/timeout) — never on auth.
 *  Keyed globally per engine name (`breaker:<name>`), not per repo — for a
 *  single shared OpenCode/Computer backend, one repo's connectivity failures
 *  demote ALL repos to native for the 60s cooldown. Intended for a shared
 *  backend; noted here in case that assumption ever changes. */
export class CircuitBreaker {
  constructor(private kv: KVNamespace, private name: string) {}
  private key() { return `breaker:${this.name}`; }

  private async read(): Promise<State> {
    const raw = await this.kv.get(this.key());
    return raw ? (JSON.parse(raw) as State) : { failures: 0, openedAt: null };
  }
  private async write(s: State) { await this.kv.put(this.key(), JSON.stringify(s)); }

  /** Open = tripped AND still within cooldown. After cooldown it reports
   *  closed (half-open): the caller may try once; success/failure then updates. */
  async isOpen(now: number): Promise<boolean> {
    const s = await this.read();
    if (s.openedAt === null) return false;
    return now - s.openedAt < COOLDOWN_MS;
  }
  async recordSuccess(): Promise<void> { await this.write({ failures: 0, openedAt: null }); }
  async recordFailure(now: number): Promise<void> {
    const s = await this.read();
    const failures = s.failures + 1;
    await this.write({ failures, openedAt: failures >= THRESHOLD ? now : s.openedAt });
  }
}
