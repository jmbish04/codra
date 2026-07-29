import { parseFileReviewResponse } from '@server/core/model-output';
import type { FileDiff } from '@server/core/diff';

describe('Model Output Parsing Deep Dive', () => {
  const mockFile: FileDiff = {
    path: 'test.ts',
    previousPath: null,
    isNew: false,
    isDeleted: false,
    isBinary: false,
    lineCount: 10,
    hunks: [
      {
        header: '@@ -1,5 +1,5 @@',
        lines: [
          { kind: 'context', content: 'older', newLineNumber: 1, position: 1 },
          { kind: 'add', content: 'new line', newLineNumber: 2, position: 2 },
          { kind: 'context', content: 'older', newLineNumber: 3, position: 3 },
        ],
      },
    ],
  };

  it('extracts JSON from markdown code blocks with surrounding text', () => {
    const rawOutput = `
Here is my review:
\`\`\`json
{
  "findings": [{
    "title": "Good code",
    "body": "This looks fine.",
    "priority": 2,
    "code_location": { "absolute_file_path": "test.ts", "line": 2 }
  }],
  "overall_correctness": "patch is correct",
  "overall_explanation": "All good"
}
\`\`\`
Hope this helps!`;

    const result = parseFileReviewResponse(rawOutput, mockFile);
    expect(result.comments).toHaveLength(1);
    expect(result.verdict).toBe('comment'); // Since it has comments, verdict becomes 'comment'
  });

  it('salvages malformed JSON with unescaped newlines using jsonrepair', () => {
    const rawOutput = `
{
  "findings": [{
    "title": "Multiline
Issue",
    "body": "This has
unescaped newlines",
    "priority": 1,
    "code_location": { "absolute_file_path": "test.ts", "line": 2 }
  }],
  "overall_correctness": "issues found",
  "overall_explanation": "explanation"
}`;

    const result = parseFileReviewResponse(rawOutput, mockFile);
    // our cleanText flattens newlines in titles to spaces
    expect(result.comments[0].title).toBe('Multiline Issue');
  });

  it('handles truncated JSON gracefully (salvage success)', () => {
    const rawOutput = `
{
  "findings": [{
    "title": "Truncated",
    "body": "This cuts off",
    "priority": 1,
    "code_location": { "absolute_file_path": "test.ts", "line": 2 }
`; 
    const result = parseFileReviewResponse(rawOutput, mockFile);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].title).toBe('Truncated');
  });

  it('removes conversational tags and emojis from titles and bodies', () => {
    const rawOutput = `
{
  "findings": [{
    "title": "🚀 [PERFORMANCE] Optimization needed",
    "body": "⚠️ HIGH: You should optimize this.",
    "priority": 0,
    "code_location": { "absolute_file_path": "test.ts", "line": 2 }
  }],
  "overall_correctness": "issues found",
  "overall_explanation": "explanation"
}`;

    const result = parseFileReviewResponse(rawOutput, mockFile);
    expect(result.comments[0].title).toBe('Optimization needed');
  });

  it('maps priorities correctly to P-levels', () => {
    const rawOutput = `
{
  "findings": [
    {
      "title": "P0 Issue",
      "body": "Critical",
      "priority": 0,
      "code_location": { "absolute_file_path": "test.ts", "line": 2 }
    },
    {
      "title": "P3 Issue",
      "body": "Minor",
      "priority": 3,
      "code_location": { "absolute_file_path": "test.ts", "line": 2 }
    }
  ],
  "overall_correctness": "issues found",
  "overall_explanation": "explanation"
}`;

    const result = parseFileReviewResponse(rawOutput, mockFile);
    expect(result.comments[0].severity).toBe('P0');
    expect(result.comments[1].severity).toBe('P3');
  });

  it('handles findings targeting lines outside the diff by finding the closest line', () => {
    const rawOutput = `
{
  "findings": [{
    "title": "Off-target",
    "body": "Targeting line 10",
    "priority": 2,
    "code_location": { "absolute_file_path": "test.ts", "line": 8 }
  }],
  "overall_correctness": "issues found",
  "overall_explanation": "explanation"
}`;

    const result = parseFileReviewResponse(rawOutput, mockFile);
    // Closest valid line to 8 in our mockFile (available are 1, 2, 3) is 3
    expect(result.comments[0].line).toBe(3);
  });

  it('anchors findings whose code_location is a string ("52, 77") instead of dropping them', () => {
    const rawOutput = `
{
  "findings": [
    { "title": "String single line", "body": "Single line reference should anchor.", "priority": 2, "code_location": "2" },
    { "title": "String multi line", "body": "Multiple line reference should anchor to the first.", "priority": 2, "code_location": "2, 3" },
    { "title": "String range", "body": "Range reference should anchor to the start.", "priority": 2, "code_location": "2-3" },
    { "title": "Bare number", "body": "Bare numeric location should anchor.", "priority": 2, "code_location": 2 }
  ],
  "overall_correctness": "issues found",
  "overall_explanation": "explanation"
}`;

    const result = parseFileReviewResponse(rawOutput, mockFile);
    // All four resolve to the valid diff line 2 and post as inline comments,
    // rather than being orphaned off-diff.
    expect(result.comments).toHaveLength(4);
    for (const comment of result.comments) {
      expect(comment.line).toBe(2);
      expect(comment.position).toBeDefined();
    }
  });

  it('keeps off-diff findings (no locatable line) as COMMENT instead of hiding them', () => {
    const rawOutput = `
{
  "findings": [{
    "title": "Off-diff concern",
    "body": "This applies to code not in the diff.",
    "priority": 2
  }],
  "overall_correctness": "patch is correct",
  "overall_explanation": "explanation"
}`;

    const result = parseFileReviewResponse(rawOutput, mockFile);
    // Kept as a structured comment (frontend + JSON), with no line so it never
    // posts as a GitHub inline comment.
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].line ?? null).toBeNull();
    expect(result.comments[0].position ?? null).toBeNull();
    expect(result.comments[0].body).toContain('Off-diff finding');
    // A file with findings is a COMMENT even when it claims "patch is correct".
    expect(result.verdict).toBe('comment');
  });

  it('does not treat reviewed source snippets as review JSON', () => {
    const rawOutput = `
\`\`\`ts
export function nextOwner(owner: string) {
  return owner.toUpperCase();
}
\`\`\``;

    expect(() => parseFileReviewResponse(rawOutput, mockFile)).toThrow('Could not find JSON root');
  });

  it('drops placeholder schema findings instead of failing validation', () => {
    const rawOutput = `
{
  "findings": [{
    "title": "<Plain title>",
    "body": "<Technical explanation>",
    "priority": "<0|1|2|3>",
    "code_location": {
      "absolute_file_path": "test.ts",
      "line": "<int>",
      "line_range": { "start": "<int>", "end": "<int>" }
    }
  }],
  "overall_correctness": "patch is correct",
  "overall_explanation": "No concrete findings",
  "overall_confidence_score": 0.5
}`;

    const result = parseFileReviewResponse(rawOutput, mockFile);
    expect(result.comments).toHaveLength(0);
    expect(result.verdict).toBe('approve');
  });
});
