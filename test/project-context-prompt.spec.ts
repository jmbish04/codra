import { buildFileReviewPrompts } from '@server/prompts/file-review';
import { defaultRepoConfig } from '@shared/schema';
import type { FileDiff } from '@server/core/diff';

const file: FileDiff = {
  path: 'src/index.ts',
  previousPath: null,
  isNew: false,
  isDeleted: false,
  isBinary: false,
  lineCount: 3,
  hunks: [
    {
      header: '@@ -1,2 +1,3 @@',
      lines: [
        { kind: 'context', content: 'a', newLineNumber: 1, position: 1 },
        { kind: 'add', content: 'const db = env.DB;', newLineNumber: 2, position: 2 },
      ],
    },
  ],
};

describe('file review prompt project context', () => {
  it('embeds project context + stack-respect directive when provided', () => {
    const { userPrompt } = buildFileReviewPrompts({
      file,
      prTitle: 'PR',
      prDescription: null,
      config: defaultRepoConfig.review,
      projectContext: '### wrangler.jsonc\n{ "d1_databases": [{ "binding": "DB" }] }',
    });

    expect(userPrompt).toContain('PROJECT CONTEXT (authoritative)');
    expect(userPrompt).toContain('do not propose swapping a configured Cloudflare D1 binding');
    expect(userPrompt).toContain('d1_databases');
  });

  it('omits the context block entirely when there is no project context', () => {
    const { userPrompt } = buildFileReviewPrompts({
      file,
      prTitle: 'PR',
      prDescription: null,
      config: defaultRepoConfig.review,
    });

    expect(userPrompt).not.toContain('PROJECT CONTEXT');
  });
});
