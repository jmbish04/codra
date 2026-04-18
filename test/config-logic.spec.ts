import { parseRepoConfig } from '@server/core/config';
import { defaultRepoConfig } from '@shared/schema';

describe('Configuration Logic Deep Dive', () => {
  it('parses empty or null YAML into default configuration', () => {
    const result = parseRepoConfig(null);
    expect(result.configMissing).toBe(true);
    expect(result.parsedJson).toEqual(defaultRepoConfig);
  });

  it('correctly overrides specific fields from YAML', () => {
    const yaml = `
review:
  max_files: 50
  ignore_drafts: false
  skip_files:
    - "bin/**"
`;
    const result = parseRepoConfig(yaml);
    expect(result.configMissing).toBe(false);
    expect(result.parsedJson.review.max_files).toBe(50);
    expect(result.parsedJson.review.ignore_drafts).toBe(false);
    expect(result.parsedJson.review.skip_files).toContain('bin/**');
    // Ensure others remain default
    expect(result.parsedJson.review.large_file_threshold_lines).toBe(defaultRepoConfig.review.large_file_threshold_lines);
  });

  it('handles model scaling and fallback overrides', () => {
    const yaml = `
model:
  main: "gpt-4"
  fallbacks: ["gpt-3.5-turbo"]
  size_overrides:
    - max_lines: 100
      model: "gpt-mini"
`;
    const result = parseRepoConfig(yaml);
    expect(result.parsedJson.model.main).toBe('gpt-4');
    expect(result.parsedJson.model.fallbacks).toContain('gpt-3.5-turbo');
    expect(result.parsedJson.model.size_overrides).toHaveLength(1);
    expect(result.parsedJson.model.size_overrides?.[0].max_lines).toBe(100);
  });

  it('throws Zod error for invalid YAML schema', () => {
    const invalidYaml = `
review:
  max_files: "not-a-number"
`;
    expect(() => parseRepoConfig(invalidYaml)).toThrow();
  });

  it('gracefully handles empty YAML string', () => {
    const result = parseRepoConfig('');
    expect(result.configMissing).toBe(true);
    expect(result.parsedJson).toEqual(defaultRepoConfig);
  });
});
