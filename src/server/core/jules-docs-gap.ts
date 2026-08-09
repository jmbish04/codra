import { analyzeChangedFiles } from '@server/core/docstrings';
import { parseUnifiedDiff } from '@server/core/diff';
import { DOCS_GAP_SCHEMA } from '@server/models/schemas';
import { ModelService } from '@server/services/model';
import { logger } from '@server/core/logger';

/** A file is considered stale if its last commit is older than this many days. */
export const STALE_DAYS = 180;

export type DocsGapKind = 'agents' | 'readme' | 'frontend-docs' | 'docstrings';

export type DocsGapItem = {
  kind: DocsGapKind;
  reason: string;
  docstrings?: { path: string; functions: string[] }[];
};

export type DocsGapReport = { items: DocsGapItem[]; summary: string };

/** Flat list of source paths a docs-gap report targets (docstring gaps only). */
export function collectTargetFiles(report: DocsGapReport): string[] {
  return report.items.flatMap((i) => i.docstrings?.map((d) => d.path) ?? []);
}

export type DocsGapJob = { id: string; owner: string; repo: string; prNumber: number; headSha: string };

/** Minimal GitHub surface this module needs — GitHubService satisfies it structurally. */
export interface DocsGapGithub {
  getRepoFileWithRefOrNull(owner: string, repo: string, path: string, ref?: string): Promise<{ content: string | null; sha?: string } | null>;
  getRepoTree(owner: string, repo: string, sha: string): Promise<{ tree: Array<{ path: string; type: string }> }>;
  getFileLastCommitDate(owner: string, repo: string, path: string): Promise<string | null>;
  getPullRequestDiff(owner: string, repo: string, prNumber: number): Promise<string>;
}

/** Minimal model surface — ModelService satisfies it structurally. */
export interface DocsGapModel {
  callModel(model: string, input: { systemPrompt: string; userPrompt: string }, schema?: object): Promise<{ rawText: string }>;
}

export type DocsGapConfig = { model?: { main?: string | null } | null };

async function isStale(github: DocsGapGithub, owner: string, repo: string, path: string): Promise<boolean> {
  const dateIso = await github.getFileLastCommitDate(owner, repo, path).catch(() => null);
  if (!dateIso) return false; // best-effort: unknown commit history is never treated as stale
  const ageMs = Date.now() - new Date(dateIso).getTime();
  return Number.isFinite(ageMs) && ageMs > STALE_DAYS * 24 * 60 * 60 * 1000;
}

async function getChangedFileContents(
  github: DocsGapGithub, owner: string, repo: string, prNumber: number, headSha: string,
): Promise<{ path: string; content: string }[]> {
  const diff = await github.getPullRequestDiff(owner, repo, prNumber).catch(() => '');
  if (!diff) return [];

  const files = parseUnifiedDiff(diff).filter((f) => !f.isDeleted && !f.isBinary);
  const contents = await Promise.all(
    files.map(async (f) => {
      const file = await github.getRepoFileWithRefOrNull(owner, repo, f.path, headSha).catch(() => null);
      return file?.content ? { path: f.path, content: file.content } : null;
    }),
  );

  return contents.filter((c): c is { path: string; content: string } => c !== null);
}

function buildDocsJudgePrompt(files: { label: string; content: string }[]): string {
  return [
    'Judge whether each of the following existing docs is reflective and up to date for this repo.',
    'Respond only with the requested JSON — no prose.',
    '',
    ...files.map((f) => `=== ${f.label} ===\n${f.content.slice(0, 4000)}`),
  ].join('\n');
}

/**
 * Best-effort docs-gap detector: never throws. Heuristics (file presence,
 * commit-date staleness, docs/ directory presence, missing docstrings on the
 * PR's changed files) drive the report; an optional model call only refines
 * the verdict for docs that already exist. Any failure anywhere collapses to
 * an empty report rather than propagating.
 */
export async function evaluateDocsGaps(
  env: Env,
  github: DocsGapGithub,
  job: DocsGapJob,
  config: DocsGapConfig,
  model?: DocsGapModel,
): Promise<DocsGapReport> {
  try {
    const { owner, repo, prNumber, headSha } = job;

    const [readmeFile, agentsFile, claudeFile, tree] = await Promise.all([
      github.getRepoFileWithRefOrNull(owner, repo, 'README.md', headSha).catch(() => null),
      github.getRepoFileWithRefOrNull(owner, repo, 'AGENTS.md', headSha).catch(() => null),
      github.getRepoFileWithRefOrNull(owner, repo, 'CLAUDE.md', headSha).catch(() => null),
      github.getRepoTree(owner, repo, headSha).catch(() => ({ tree: [] })),
    ]);

    const items: DocsGapItem[] = [];

    const readmeMissing = !readmeFile?.content;
    const readmeStale = !readmeMissing && (await isStale(github, owner, repo, 'README.md'));
    if (readmeMissing || readmeStale) {
      items.push({ kind: 'readme', reason: readmeMissing ? 'README.md is missing.' : `README.md hasn't been updated in over ${STALE_DAYS} days.` });
    }

    const agentsPath = agentsFile?.content ? 'AGENTS.md' : 'CLAUDE.md';
    const agentsContent = agentsFile?.content ?? claudeFile?.content ?? null;
    const agentsMissing = !agentsContent;
    const agentsStale = !agentsMissing && (await isStale(github, owner, repo, agentsPath));
    if (agentsMissing || agentsStale) {
      items.push({ kind: 'agents', reason: agentsMissing ? 'AGENTS.md/CLAUDE.md is missing.' : `${agentsPath} hasn't been updated in over ${STALE_DAYS} days.` });
    }

    // A repo only needs a frontend docs suite if it has a frontend at all.
    const frontendPrefixes = ['src/client/', 'app/', 'pages/', 'components/', 'src/pages/', 'src/components/'];
    const hasFrontend = (tree?.tree ?? []).some(
      (n) => n.type === 'blob' && (/\.(tsx|jsx)$/.test(n.path) || frontendPrefixes.some((p) => n.path.startsWith(p))),
    );
    const hasDocsDir = (tree?.tree ?? []).some((n) => n.type === 'blob' && n.path.startsWith('docs/'));
    if (hasFrontend && !hasDocsDir) {
      items.push({ kind: 'frontend-docs', reason: 'No docs/ directory found in the repo.' });
    }

    // ponytail: docstring scope is deliberately limited to this PR's changed files,
    // not a full-repo sweep — broaden only if pre-existing gaps become a recurring complaint.
    const changedFiles = await getChangedFileContents(github, owner, repo, prNumber, headSha).catch(() => []);
    const docstringResults = analyzeChangedFiles(changedFiles).filter((r) => r.requiresJulesTask);
    if (docstringResults.length > 0) {
      items.push({
        kind: 'docstrings',
        reason: `${docstringResults.length} changed file(s) are missing docstrings.`,
        docstrings: docstringResults.map((r) => ({ path: r.fileName, functions: r.functionsMissingDocstrings })),
      });
    }

    // Optional model refinement, only for docs that exist and heuristics didn't already flag.
    try {
      const modelService = model ?? new ModelService(env);
      const filesForReview = [
        !readmeMissing && !readmeStale ? { label: 'README.md', content: readmeFile!.content! } : null,
        !agentsMissing && !agentsStale ? { label: agentsPath, content: agentsContent! } : null,
      ].filter((f): f is { label: string; content: string } => f !== null);

      if (filesForReview.length > 0) {
        const modelId = config.model?.main || 'claude-3-5-sonnet-latest';
        const res = await modelService.callModel(
          modelId,
          {
            systemPrompt: 'You judge whether project docs are reflective and up to date given a pull request under review. Respond with strict JSON only, matching the schema.',
            userPrompt: buildDocsJudgePrompt(filesForReview),
          },
          DOCS_GAP_SCHEMA,
        );
        const parsed = JSON.parse(res.rawText) as {
          agents_needs_work?: boolean; readme_needs_work?: boolean; frontend_docs_needs_work?: boolean; reasons?: string[];
        };
        const reason = parsed.reasons?.[0] || 'The docs no longer reflect the current code.';
        if (parsed.readme_needs_work && !readmeMissing && !readmeStale) items.push({ kind: 'readme', reason });
        if (parsed.agents_needs_work && !agentsMissing && !agentsStale) items.push({ kind: 'agents', reason });
        if (parsed.frontend_docs_needs_work && hasFrontend && hasDocsDir) items.push({ kind: 'frontend-docs', reason });
      }
    } catch (error) {
      logger.warn('Docs-gap model refinement failed; falling back to heuristic-only verdicts', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const summary = items.length === 0 ? '' : `Docs gaps found: ${Array.from(new Set(items.map((i) => i.kind))).join(', ')}.`;
    return { items, summary };
  } catch (error) {
    logger.warn('evaluateDocsGaps failed; returning an empty report', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { items: [], summary: '' };
  }
}

/**
 * Pure prompt builder for a Jules session that closes the reported docs gaps.
 * Written for a "newborn" agent: the doc-suite layout and routing setup are
 * spelled out explicitly rather than assumed.
 */
export function buildJulesPrompt(
  report: DocsGapReport,
  repo: { owner: string; repo: string; defaultBranch: string; router?: string },
): string {
  const lines: string[] = [];

  lines.push(`You are Jules, an autonomous coding agent working on ${repo.owner}/${repo.repo} (default branch: ${repo.defaultBranch}).`);
  lines.push('Your job is to close the documentation gaps listed below. Follow every instruction literally — do not assume conventions this repo hasn\'t shown you.');
  lines.push('');
  lines.push(`Gap summary: ${report.summary}`);
  lines.push('');

  for (const item of report.items) {
    if (item.kind === 'readme') {
      lines.push('## README.md');
      lines.push(`Reason: ${item.reason}`);
      lines.push('- Write or update README.md at the repo root.');
      lines.push('- Cover: what the project does, how to install/run/test it, and where the docs/ suite (if any) lives.');
      lines.push('');
    }

    if (item.kind === 'agents') {
      lines.push('## AGENTS.md');
      lines.push(`Reason: ${item.reason}`);
      lines.push('- Write or update AGENTS.md with the build/test/lint commands and any repo-specific conventions an autonomous agent needs to know before making changes.');
      lines.push('');
    }

    if (item.kind === 'frontend-docs') {
      lines.push('## docs/ suite');
      lines.push(`Reason: ${item.reason}`);
      lines.push('Build out the docs/ directory as a proper documentation suite, laid out explicitly like this:');
      lines.push('- docs/README.md is the index/table-of-contents page. It lists every subpage below with a one-line description and a relative link.');
      lines.push('- docs/<topic>.md is one subpage per major area (for example docs/architecture.md, docs/setup.md, docs/deployment.md). Link every subpage from the index.');
      lines.push('- docs/<topic>/<nested>.md nests further detail under a subpage that needs it (for example docs/api/endpoints.md). Link nested pages from their parent subpage.');
      lines.push('Every page must link back to the index and forward to its children — never leave an orphan page with no inbound link.');
      if (repo.router) {
        lines.push('');
        lines.push('### Routing');
        lines.push(`This frontend uses ${repo.router}. Document the route table explicitly: list every route path, the component it renders, and any guards/loaders — spell out the actual route tree, do not just say "standard routing".`);
      }
      lines.push('');
    }

    if (item.kind === 'docstrings' && item.docstrings) {
      lines.push('## Missing docstrings');
      lines.push(`Reason: ${item.reason}`);
      lines.push("Scope: ONLY the files listed below, changed in this pull request. Do not touch docstrings anywhere else in the repo.");
      lines.push('RULE: never overwrite or delete any existing docstring. Only ADD a docstring to the functions listed below that currently have none.');
      for (const d of item.docstrings) {
        lines.push(`- ${d.path}: add docstrings to ${d.functions.join(', ')}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
