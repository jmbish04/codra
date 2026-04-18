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
});
