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
    summary: { type: 'string', description: 'A readable GitHub-markdown summary. Open with ONE short sentence of what shipped, then a blank line, then a bulleted list (2-5 items, one per line starting with "- ") of the concrete changes — name the actual routes, tables, columns, or functions. Use real newlines and blank lines; never write one long run-on sentence.' },
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

/** Structured-output contract for detecting read-only endpoints/pages to test. */
export const TEST_TARGETS_SCHEMA = {
  name: 'codra_test_targets',
  description: 'List the read-only API endpoints, MCP tools, and frontend pages that this PR changed and that are safe to test.',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      targets: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', enum: ['api', 'mcp', 'frontend'] },
            method: { type: 'string', description: 'HTTP method for api targets (GET/HEAD), else empty string.' },
            target: { type: 'string', description: 'API path (e.g. /api/jobs/:id), MCP tool name, or frontend page path.' },
            reason: { type: 'string', description: 'One line: what changed and why it is worth testing.' },
            readOnly: { type: 'boolean', description: 'True only if this is a read/list/get — never create/update/delete.' },
            params: { type: 'string', description: 'JSON string of example params/args to send, inferred from the code. Empty string if none.' },
          },
          required: ['kind', 'method', 'target', 'reason', 'readOnly', 'params'],
        },
      },
    },
    required: ['targets'],
  },
};

/** Structured-output contract for a Cloudflare-docs review — gotchas to propose as best practices. */
export const DOCS_REVIEW_SCHEMA = {
  name: 'codra_docs_review',
  description: 'Report gotchas where the PR code diverges from the official Cloudflare docs/best-practices for the given criteria.',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      gotchas: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string', description: 'Short name for the best practice (e.g. "Export Durable Objects from the Worker entrypoint").' },
            criteria: { type: 'string', description: 'When this applies — the code pattern/files it governs.' },
            instruction: { type: 'string', description: 'The correct approach per the Cloudflare docs, and why the code is wrong. Concrete and actionable.' },
          },
          required: ['title', 'criteria', 'instruction'],
        },
      },
    },
    required: ['gotchas'],
  },
};

/** Structured-output contract for changelog generation. */
export const CHANGELOG_SCHEMA = {
  name: 'codra_changelog_entry',
  description: 'Submit the structured changelog entry for this pull request.',
  schema: CHANGELOG_RESPONSE_SCHEMA,
};
