import { describe, expect, it } from 'vitest';
import { FormatterService } from '@server/services/formatter';

describe('FormatterService footer + monitor link', () => {
  const formatter = new FormatterService('https://codra.example.com/');

  it('builds a job url without a double slash', () => {
    expect(formatter.jobUrl('abc-123')).toBe('https://codra.example.com/jobs/abc-123');
  });

  it('renders a collapsed command footer with the bot mention and config links', () => {
    const footer = formatter.commandFooter('codra');
    expect(footer).toContain('<summary><b>Using Codra</b></summary>');
    expect(footer).toContain('`@codra review`');
    expect(footer).toContain('https://codra.example.com/repos');
    expect(footer).toContain('https://codra.example.com/commands');
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
