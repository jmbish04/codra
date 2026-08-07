import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '@server/core/circuit-breaker';

function fakeKv() {
  const m = new Map<string, string>();
  return {
    async get(k: string) { return m.get(k) ?? null; },
    async put(k: string, v: string) { m.set(k, v); },
    async delete(k: string) { m.delete(k); },
  } as any;
}

describe('CircuitBreaker', () => {
  it('opens after 5 consecutive failures and half-opens after cooldown', async () => {
    const kv = fakeKv();
    const cb = new CircuitBreaker(kv, 'opencode');
    let now = 1_000;
    expect(await cb.isOpen(now)).toBe(false);
    for (let i = 0; i < 5; i++) await cb.recordFailure(now);
    expect(await cb.isOpen(now)).toBe(true);          // open
    now += 61_000;
    expect(await cb.isOpen(now)).toBe(false);          // half-open after 60s cooldown
    await cb.recordSuccess();                          // closes
    expect(await cb.isOpen(now)).toBe(false);
  });

  it('a success resets the failure count', async () => {
    const kv = fakeKv();
    const cb = new CircuitBreaker(kv, 'e');
    const now = 5;
    await cb.recordFailure(now); await cb.recordFailure(now);
    await cb.recordSuccess();
    for (let i = 0; i < 4; i++) await cb.recordFailure(now);
    expect(await cb.isOpen(now)).toBe(false); // only 4 since reset
  });
});
