import { describe, expect, it } from 'vitest';
import { FormatterService } from '@server/services/formatter';
import { createTestEnv } from './helpers';

const APP_URL = createTestEnv().APP_URL;

describe('FormatterService footer + monitor link', () => {
  const formatter = new FormatterService(APP_URL);

  it('builds a job url from APP_URL', () => {
    expect(formatter.jobUrl('abc-123')).toBe(`${APP_URL}/jobs/abc-123`);
  });

  it('normalizes a trailing slash so paths never double up', () => {
    expect(new FormatterService(`${APP_URL}/`).jobUrl('x')).toBe(`${APP_URL}/jobs/x`);
  });

  it('renders a collapsed command footer with the bot mention and config links', () => {
    const footer = formatter.commandFooter('codra');
    expect(footer).toContain('<summary><b>Using Codra</b></summary>');
    expect(footer).toContain('`@codra review`');
    expect(footer).toContain(`${APP_URL}/repos`);
    expect(footer).toContain(`${APP_URL}/commands`);
  });

  it('appends the footer to the main-PR review overview', () => {
    expect(formatter.formatReviewOverview('deadbeefcafe', 'codra')).toContain('<summary><b>Using Codra</b></summary>');
  });

  it('never adds the footer to inline code comments', () => {
    const inline = formatter.formatInlineComment({
      title: 'Off-by-one',
      body: 'Loop bound should be <=.',
      severity: 'P1',
      path: 'src/x.ts',
      position: 3,
    } as any);
    expect(inline).not.toContain('Using Codra');
  });
});
