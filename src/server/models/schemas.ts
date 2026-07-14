/**
 * Shared JSON Schema for the file review response format.
 * Used by all model providers that support structured output (response_format / responseSchema).
 * This is the canonical schema — keep it in sync with the Zod schema in @shared/schema.ts.
 */
export const REVIEW_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'overall_explanation', 'overall_correctness', 'overall_confidence_score'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'body', 'priority', 'code_location'],
        properties: {
          title: { type: 'string', maxLength: 100 },
          body: { type: 'string' },
          confidence_score: { type: 'number', minimum: 0, maximum: 1 },
          priority: { type: 'integer', minimum: 0, maximum: 3 },
          code_location: {
            type: 'object',
            additionalProperties: false,
            properties: {
              absolute_file_path: { type: 'string' },
              line: { type: 'integer', minimum: 1 },
              line_range: {
                type: 'object',
                additionalProperties: false,
                required: ['start', 'end'],
                properties: {
                  start: { type: 'integer', minimum: 1 },
                  end: { type: 'integer', minimum: 1 },
                },
              },
            },
            anyOf: [
              { required: ['line'] },
              { required: ['line_range'] },
            ],
          },
          code_suggestion: { type: 'string' },
        },
      },
    },
    overall_explanation: { type: 'string' },
    overall_correctness: { type: 'string', enum: ['patch is correct', 'patch is incorrect'] },
    overall_confidence_score: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const;
