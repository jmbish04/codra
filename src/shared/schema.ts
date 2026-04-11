import { z } from 'zod';

export const reviewTriggers = ['auto', 'mention', 'retry'] as const;
export const jobStatuses = ['queued', 'running', 'done', 'failed'] as const;
export const fileStatuses = ['pending', 'done', 'skipped', 'failed'] as const;
export const reviewVerdicts = ['approve', 'comment', 'request_changes'] as const;
export const reviewSeverities = ['error', 'warning', 'suggestion', 'nitpick'] as const;
export const reviewCategories = ['security', 'bugs', 'performance', 'correctness', 'quality'] as const;

export const dateStringSchema = z.union([z.string(), z.date()]).transform((d) => (d instanceof Date ? d.toISOString() : d));
export const coerceNumberSchema = z.union([z.number(), z.string()]).transform((v) => Number(v));

export const jobStepSchema = z.object({
  name: z.string(),
  status: z.enum(['pending', 'running', 'done', 'failed']),
  startedAt: dateStringSchema.nullable(),
  finishedAt: dateStringSchema.nullable(),
  error: z.string().nullable().optional(),
});

export const parsedReviewCommentSchema = z.object({
  path: z.string().min(1),
  line: z.number().int().positive().optional(),
  position: z.number().int().positive().optional(),
  severity: z.enum(reviewSeverities),
  category: z.enum(reviewCategories),
  title: z.string().min(1),
  body: z.string().min(1),
  codeSuggestion: z.string().min(1).optional(),
});

export const fileReviewModelOutputSchema = z.object({
  comments: z.array(
    z.object({
      line: z.number().int().positive().optional(),
      position: z.number().int().positive().optional(),
      side: z.literal('RIGHT').default('RIGHT'),
      severity: z.enum(reviewSeverities),
      category: z.enum(reviewCategories),
      title: z.string().min(1),
      body: z.string().min(1),
      code_suggestion: z.string().min(1).optional(),
    }),
  ),
  file_verdict: z.enum(reviewVerdicts).default('approve'),
  file_summary: z.string().default('No summary provided.'),
});

export const labelsSchema = z.union([
  z.literal(false),
  z.object({
    p1: z.string().min(1),
    p2: z.string().min(1),
    p3: z.string().min(1),
  }),
]);

export const reviewConfigSchema = z.object({
  on: z.array(z.enum(['opened', 'synchronize', 'ready_for_review', 'reopened'])).default(['opened', 'synchronize', 'ready_for_review', 'reopened']),
  ignore_drafts: z.boolean().default(true),
  mention_trigger: z.union([z.literal(false), z.string().min(1)]).default('@codra-app'),
  skip_files: z
    .array(z.string().min(1))
    .default(['**/*.lock', 'dist/**', 'build/**', '.next/**', '*.generated.*', 'coverage/**']),
  max_files: z.number().int().min(1).max(100).default(15),
  large_file_threshold_lines: z.number().int().min(1).max(5_000).default(200),
  focus: z.array(z.enum(reviewCategories)).default([...reviewCategories]),
  custom_rules: z.array(z.string().min(1)).default([]),
  labels: labelsSchema.default({
    p1: 'review: changes-requested',
    p2: 'review: needs-attention',
    p3: 'review: approved',
  }),
  exec: z
    .object({
      enabled: z.boolean().default(false),
      on_file_types: z.array(z.string().min(1)).default(['.ts', '.tsx', '.js']),
      command: z.string().min(1).default('npm run lint && npm run typecheck'),
    })
    .default({
      enabled: false,
      on_file_types: ['.ts', '.tsx', '.js'],
      command: 'npm run lint && npm run typecheck',
    }),
});

export const repoConfigSchema = z.object({
  review: reviewConfigSchema.default({
    on: ['opened', 'synchronize', 'ready_for_review', 'reopened'],
    ignore_drafts: true,
    mention_trigger: '@codra-app',
    skip_files: ['**/*.lock', 'dist/**', 'build/**', '.next/**', '*.generated.*', 'coverage/**'],
    max_files: 15,
    large_file_threshold_lines: 200,
    focus: [...reviewCategories],
    custom_rules: [],
    labels: {
      p1: 'review: changes-requested',
      p2: 'review: needs-attention',
      p3: 'review: approved',
    },
    exec: {
      enabled: false,
      on_file_types: ['.ts', '.tsx', '.js'],
      command: 'npm run lint && npm run typecheck',
    },
  }),
});

export const reviewJobMessageSchema = z.object({
  jobId: z.string().uuid(),
  deliveryId: z.string().min(1),
  installationId: z.string().min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
  prNumber: z.number().int().positive(),
  commitSha: z.string().min(1),
  trigger: z.enum(reviewTriggers),
});

export const jobSummarySchema = z.object({
  id: z.string().uuid(),
  owner: z.string(),
  repo: z.string(),
  prNumber: z.number().int(),
  prTitle: z.string().nullable(),
  prAuthor: z.string().nullable(),
  commitSha: z.string(),
  trigger: z.enum(reviewTriggers),
  status: z.enum(jobStatuses),
  verdict: z.enum(reviewVerdicts).nullable(),
  fileCount: z.number().int(),
  commentCount: z.number().int(),
  totalInputTokens: z.number().int(),
  totalOutputTokens: z.number().int(),
  createdAt: dateStringSchema,
  startedAt: dateStringSchema.nullable(),
  finishedAt: dateStringSchema.nullable(),
  errorMessage: z.string().nullable(),
  steps: z.array(jobStepSchema).default([]),
});

export const jobsQuerySchema = z.object({
  owner: z.string().optional(),
  repo: z.string().optional(),
  status: z.enum(jobStatuses).optional(),
  verdict: z.enum(reviewVerdicts).optional(),
  search: z.string().optional(),
  limit: z.preprocess((v) => Number(v), z.number().int().min(1).max(100)).default(20),
  offset: z.preprocess((v) => Number(v), z.number().int().min(0)).default(0),
});

export type JobsQuery = z.infer<typeof jobsQuerySchema>;
export type JobStep = z.infer<typeof jobStepSchema>;

export const fileReviewRecordSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  filePath: z.string(),
  fileStatus: z.enum(fileStatuses),
  modelUsed: z.string(),
  diffLineCount: z.number().int().nullable(),
  diffInput: z.string().nullable(),
  rawAiOutput: z.string().nullable(),
  parsedComments: z.array(parsedReviewCommentSchema),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  verdict: z.enum(reviewVerdicts).nullable(),
  fileSummary: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: dateStringSchema,
});

export const jobDetailSchema = jobSummarySchema.extend({
  baseSha: z.string(),
  headRef: z.string().nullable(),
  baseRef: z.string().nullable(),
  summaryMarkdown: z.string().nullable(),
  configSnapshot: repoConfigSchema.nullable(),
  reviewId: coerceNumberSchema.nullable(),
  retryOfJobId: z.string().uuid().nullable(),
  summaryModel: z.string().nullable(),
  files: z.array(fileReviewRecordSchema),
});

export const repoConfigRecordSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  rawYaml: z.string().nullable(),
  parsedJson: repoConfigSchema,
  configMissing: z.boolean(),
  updatedAt: dateStringSchema,
  lastJobCreatedAt: dateStringSchema.nullable(),
  lastJobVerdict: z.enum(reviewVerdicts).nullable(),
});

export const statsSchema = z.object({
  totals: z.object({
    jobs: z.number().int(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    comments: z.number().int(),
  }),
  last30Days: z.array(
    z.object({
      day: z.string(),
      jobs: z.number().int(),
    }),
  ),
  verdicts: z.array(
    z.object({
      verdict: z.enum(reviewVerdicts).nullable(),
      count: z.number().int(),
    }),
  ),
  models: z.array(
    z.object({
      modelUsed: z.string(),
      calls: z.number().int(),
      inputTokens: z.number().int(),
      outputTokens: z.number().int(),
    }),
  ),
  topRepos: z.array(
    z.object({
      owner: z.string(),
      repo: z.string(),
      jobs: z.number().int(),
    }),
  ),
});

export type ParsedReviewComment = z.infer<typeof parsedReviewCommentSchema>;
export type FileReviewModelOutput = z.infer<typeof fileReviewModelOutputSchema>;
export type RepoConfig = z.infer<typeof repoConfigSchema>;
export type ReviewJobMessage = z.infer<typeof reviewJobMessageSchema>;
export type JobSummary = z.infer<typeof jobSummarySchema>;
export type FileReviewRecord = z.infer<typeof fileReviewRecordSchema>;
export type JobDetail = z.infer<typeof jobDetailSchema>;
export type RepoConfigRecord = z.infer<typeof repoConfigRecordSchema>;
export type StatsPayload = z.infer<typeof statsSchema>;

export const defaultRepoConfig = repoConfigSchema.parse({});
