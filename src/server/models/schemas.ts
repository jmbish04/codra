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

/**
 * Structured output for a changelog entry. Mirrors the Zod schema in
 * @shared/schema.ts (changelogDetailSchema) — keep the two in sync.
 *
 * Mermaid sources are model-authored from PR content, so the renderer must
 * treat them as untrusted (securityLevel: 'strict').
 */
export const CHANGELOG_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'area', 'problem', 'approach', 'changes', 'api_changes', 'diagrams', 'code'],
  properties: {
    title: { type: 'string', description: 'Short headline for this change, imperative mood.' },
    summary: { type: 'string', description: 'One or two sentences describing what shipped and why.' },
    area: { type: 'string', description: 'Subsystem touched, e.g. "API", "Database", "Frontend", "MCP".' },
    problem: { type: 'string', description: 'What was broken or missing before this PR.' },
    approach: { type: 'string', description: 'How the PR solves it.' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'text'],
        properties: {
          kind: { type: 'string', enum: ['added', 'changed', 'removed', 'migration', 'fixed'] },
          text: { type: 'string' },
        },
      },
    },
    api_changes: {
      type: 'array',
      description: 'Each changed HTTP route or MCP tool, one line each, e.g. "POST /api/x — does y".',
      items: { type: 'string' },
    },
    migrations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tag', 'sql'],
        properties: {
          tag: { type: 'string' },
          sql: { type: 'string' },
        },
      },
    },
    diagrams: {
      type: 'array',
      description:
        'Mermaid diagrams. Use erDiagram for D1 schema/relation changes, classDiagram for API or MCP tool surfaces, flowchart for control flow.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['caption', 'code'],
        properties: {
          caption: { type: 'string' },
          code: { type: 'string', description: 'Mermaid source only. No markdown fences.' },
        },
      },
    },
    code: {
      type: 'array',
      description: 'Representative snippets of changed or significantly rewritten code.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'lang', 'code'],
        properties: {
          title: { type: 'string' },
          lang: { type: 'string', enum: ['ts', 'tsx', 'sql', 'json', 'bash'] },
          code: { type: 'string' },
        },
      },
    },
  },
} as const;

/** Default structured-output contract used by the file review path. */
export const REVIEW_SCHEMA = {
  name: 'codra_file_review',
  description:
    'Submit the structured code review result with findings, overall explanation, correctness, and confidence score.',
  schema: REVIEW_RESPONSE_SCHEMA,
};

/** Structured-output contract for changelog generation. */
export const CHANGELOG_SCHEMA = {
  name: 'codra_changelog_entry',
  description: 'Submit the structured changelog entry for this pull request.',
  schema: CHANGELOG_RESPONSE_SCHEMA,
};
