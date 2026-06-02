import { describe, expect, it } from 'vitest';
import { normalizeGlobalConfig } from '@client/pages/settings';

describe('settings model strategy', () => {
  it('does not invent a global strategy when none has been saved', () => {
    expect(normalizeGlobalConfig(null)).toEqual({
      main: null,
      fallbacks: [],
      size_overrides: [],
    });
  });

  it('preserves an explicit empty global fallback list', () => {
    const config = normalizeGlobalConfig({
      main: 'gemma-4-31b-it',
      fallbacks: [],
      size_overrides: [
        {
          max_lines: 300,
          model: 'gemma-4-31b-it',
          fallbacks: [],
        },
      ],
    });

    expect(config.fallbacks).toEqual([]);
    expect(config.size_overrides[0].fallbacks).toEqual([]);
  });
});
