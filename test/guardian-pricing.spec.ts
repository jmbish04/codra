import {
  computeCost,
  buildCostBreakdown,
  sumBreakdown,
  lookupModelRate,
  type PricingSnapshot,
  type UsageAmounts,
} from '@server/core/guardian-pricing';

const snapshot: PricingSnapshot = {
  source: 'core-guardian',
  pricedAt: 1_700_000_000_000,
  models: {
    '@cf/moonshotai/kimi-k2.7-code': {
      input: { unitPrice: 0.6, perUnits: 1_000_000, currency: 'USD' },
      output: { unitPrice: 2.5, perUnits: 1_000_000, currency: 'USD' },
      cachedInput: null,
    },
  },
  infra: {
    do_requests: { unitPrice: 0.15, perUnits: 1_000_000, currency: 'USD' },
    do_duration_gbs: { unitPrice: 12.5, perUnits: 1_000_000, currency: 'USD' },
    d1_rows_read: { unitPrice: 0.001, perUnits: 1_000_000, currency: 'USD' },
    d1_rows_written: { unitPrice: 1.0, perUnits: 1_000_000, currency: 'USD' },
    subrequests: { unitPrice: 0, perUnits: 1, currency: 'USD' },
  },
};

const usage: UsageAmounts = {
  aiInputTokens: 1_000_000, // $0.60
  aiOutputTokens: 200_000, //  $0.50
  doRequests: 4, //           $0.0000006
  doDurationGbs: 0, //        $0
  d1RowsWritten: 5, //        $0.000005
  d1RowsRead: 2, //           $0.000000002
  subrequests: 5, //          $0
};

describe('guardian pricing cost math', () => {
  it('computes amount / perUnits * unitPrice', () => {
    expect(computeCost(1_000_000, snapshot.infra.d1_rows_written)).toBe(1.0);
    expect(computeCost(500_000, { unitPrice: 2, perUnits: 1_000_000, currency: 'USD' })).toBe(1.0);
    expect(computeCost(10, { unitPrice: 5, perUnits: 0, currency: 'USD' })).toBe(0); // guards div-by-zero
  });

  it('prices AI tokens per million and totals the breakdown', () => {
    const rows = buildCostBreakdown(snapshot, '@cf/moonshotai/kimi-k2.7-code', usage);
    const byType = Object.fromEntries(rows.map((r) => [r.usageType, r]));

    expect(byType.ai_input_tokens.totalCost).toBeCloseTo(0.6, 10);
    expect(byType.ai_output_tokens.totalCost).toBeCloseTo(0.5, 10);
    expect(byType.d1_rows_written.totalCost).toBeCloseTo(0.000005, 12);
    expect(byType.subrequests.totalCost).toBe(0);

    // Total is dominated by AI tokens ($1.10); infra is rounding-level.
    expect(sumBreakdown(rows)).toBeCloseTo(1.100005602, 6);
  });

  it('matches models loosely by normalized id', () => {
    expect(lookupModelRate(snapshot, 'moonshotai/kimi-k2.7-code')).not.toBeNull();
    expect(lookupModelRate(snapshot, 'unknown-model')).toBeNull();
  });

  it('falls back to zero AI cost when the model is unpriced', () => {
    const rows = buildCostBreakdown(snapshot, 'unknown-model', usage);
    const byType = Object.fromEntries(rows.map((r) => [r.usageType, r]));
    expect(byType.ai_input_tokens.totalCost).toBe(0);
    expect(byType.ai_output_tokens.totalCost).toBe(0);
    // Infra still priced.
    expect(byType.d1_rows_written.totalCost).toBeCloseTo(0.000005, 12);
  });
});
