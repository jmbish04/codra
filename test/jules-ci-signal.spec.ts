import { describe, expect, it } from 'vitest';
import { isSupportedGitHubWebhookEvent } from '@shared/github';

describe('jules CI signal webhook events', () => {
  it('supports check_run', () => {
    expect(isSupportedGitHubWebhookEvent('check_run')).toBe(true);
  });

  it('supports workflow_run', () => {
    expect(isSupportedGitHubWebhookEvent('workflow_run')).toBe(true);
  });
});
