import { logger } from './logger';
import type { GitHubService } from '../services/github';
import type { RepoConfig } from '@shared/schema';
import { setRepoActionsSecrets } from '@server/core/github-secrets';
import { getSecretStoreBinding } from '@server/utils/secrets';
import { getDismissedStandards } from '@server/db/dismissed-standards';
import { recordAgentAction } from '@server/db/agent-actions';

const DEPLOY_WORKFLOW_PATH = '.github/workflows/deploy.yml';
const WRANGLER_CONFIG_PATHS = ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'];

type MinimalGitHub = Pick<GitHubService, 'getRepoFileWithRefOrNull' | 'getRepoTree'>;

/** Pure builder for the manual deploy/migrate/logs GitHub Actions workflow. */
export function buildDeployWorkflowYaml(opts: { dbName: string | null; packageManager: 'pnpm' | 'npm' }): string {
  const dbName = opts.dbName ?? '<YOUR_D1_DB_NAME>';
  const dbNote = opts.dbName ? '' : '# NOTE: could not determine the D1 database name from wrangler config — replace <YOUR_D1_DB_NAME> below.\n';
  return `name: Deploy (Cloudflare)

${dbNote}# Manual, on-demand operations via workflow_dispatch (below). Auto-deploy on
# push to main is provided as a commented-out alternative — uncomment this
# block (and merge it into the \`on:\` key below) to enable continuous deploys.
#
# on:
#   push:
#     branches: [main]
on:
  workflow_dispatch:
    inputs:
      action:
        description: "What to run"
        required: true
        default: deploy
        type: choice
        options:
          - deploy
          - migrate-db
          - check-logs

jobs:
  run:
    runs-on: ubuntu-latest
    name: Wrangler
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Deploy Worker
        if: \${{ github.event_name == 'push' || github.event.inputs.action == 'deploy' }}
        uses: cloudflare/wrangler-action@v4
        with:
          apiToken: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy

      - name: Apply remote D1 migrations
        if: \${{ github.event.inputs.action == 'migrate-db' }}
        uses: cloudflare/wrangler-action@v4
        with:
          apiToken: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: d1 migrations apply ${dbName} --remote

      - name: Check recent deployments / build status
        if: \${{ github.event.inputs.action == 'check-logs' }}
        uses: cloudflare/wrangler-action@v4
        with:
          apiToken: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deployments list
`;
}

/** True when this is a worker repo (has a wrangler config) with no existing deploy workflow. */
export async function deployWorkflowNeeded(
  github: MinimalGitHub, owner: string, repo: string, defaultBranch: string, headSha: string,
): Promise<boolean> {
  let hasWranglerConfig = false;
  for (const p of WRANGLER_CONFIG_PATHS) {
    if (await github.getRepoFileWithRefOrNull(owner, repo, p, defaultBranch)) {
      hasWranglerConfig = true;
      break;
    }
  }
  if (!hasWranglerConfig) return false;

  // ponytail: filename-only check for v1 — a repo could have a same-named workflow
  // that isn't ours; content-sniffing for `wrangler-action` can be added if that bites.
  const tree = await github.getRepoTree(owner, repo, headSha);
  const hasDeployWorkflow = tree.tree.some(
    (node) => node.type === 'blob' && (node.path === `${DEPLOY_WORKFLOW_PATH}` || node.path === '.github/workflows/deploy.yaml'),
  );
  return !hasDeployWorkflow;
}

function parseDbName(content: string): string | null {
  try {
    // Strip JSONC comments minimally (line comments) before parsing; wrangler.toml isn't JSON at all.
    const stripped = content.replace(/\/\/.*$/gm, '');
    const parsed = JSON.parse(stripped);
    const name = parsed?.d1_databases?.[0]?.database_name;
    return typeof name === 'string' && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

type EnsureDeployWorkflowJob = {
  id: string;
  owner: string;
  repo: string;
  prNumber: number;
};

/** Best-effort: gate → open a separate deploy-workflow PR → set Cloudflare Actions secrets → record the action. Never throws. */
export async function ensureDeployWorkflow(
  env: Pick<Env, 'DB' | 'CF_ACCOUNT_ID' | 'CF_API_TOKEN'>,
  job: EnsureDeployWorkflowJob,
  github: GitHubService,
  config: RepoConfig,
): Promise<void> {
  try {
    if (config.review?.deployWorkflow?.enabled === false) return;

    const { owner, repo } = job;
    const defaultBranch = (await github.getRepo(owner, repo)).default_branch;
    const pr = await github.getPullRequest(owner, repo, job.prNumber);

    if (!(await deployWorkflowNeeded(github, owner, repo, defaultBranch, pr.head.sha))) return;

    const dismissed = await getDismissedStandards(env, owner, repo).catch(() => new Set<string>());
    if (dismissed.has(DEPLOY_WORKFLOW_PATH)) return;

    const existingPRs = await github.listPullRequests(owner, repo, { state: 'open', per_page: 30 });
    if (existingPRs.find((p) => p.head.ref.startsWith('codra/deploy-workflow'))) return;

    const wranglerFile =
      (await github.getRepoFileWithRefOrNull(owner, repo, 'wrangler.jsonc', defaultBranch)) ||
      (await github.getRepoFileWithRefOrNull(owner, repo, 'wrangler.json', defaultBranch)) ||
      (await github.getRepoFileWithRefOrNull(owner, repo, 'wrangler.toml', defaultBranch));
    const dbName = wranglerFile?.content ? parseDbName(wranglerFile.content) : null;

    const defaultRef = await github.getRef(owner, repo, `heads/${defaultBranch}`);
    const branchName = `codra/deploy-workflow-${Date.now()}`;
    await github.createBranch(owner, repo, branchName, defaultRef.object.sha);

    const yaml = buildDeployWorkflowYaml({ dbName, packageManager: 'pnpm' });
    await github.createOrUpdateFileContents(owner, repo, DEPLOY_WORKFLOW_PATH, {
      message: 'ci: add manual Cloudflare deploy workflow',
      content: yaml,
      branch: branchName,
    });

    const accountId = await getSecretStoreBinding(env, 'CF_ACCOUNT_ID').catch(() => '');
    const apiToken = await getSecretStoreBinding(env, 'CF_API_TOKEN').catch(() => '');

    let secretResult: { ok: boolean; set: string[]; reason?: string } = { ok: false, set: [], reason: 'CF_ACCOUNT_ID or CF_API_TOKEN secret store binding is empty' };
    if (accountId && apiToken) {
      secretResult = await setRepoActionsSecrets(github, owner, repo, [
        { name: 'CLOUDFLARE_ACCOUNT_ID', value: accountId },
        { name: 'CLOUDFLARE_API_TOKEN', value: apiToken },
      ]);
    }

    const dbNote = dbName ? '' : '\n> Note: could not detect your D1 database name from the wrangler config — replace `<YOUR_D1_DB_NAME>` in the workflow before running `migrate-db`.';
    let body = `### Codra: Cloudflare Deploy Workflow\n\nThis PR adds a manual (\`workflow_dispatch\`) GitHub Actions workflow for deploying this Worker, applying remote D1 migrations, and checking recent deployments. The push-to-main auto-deploy trigger is included but **commented out** — uncomment it if you want continuous deploys.${dbNote}\n`;

    if (secretResult.ok) {
      body += '\nCodra set the `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` Actions secrets automatically.\n';
    } else {
      const shortReason = String(secretResult.reason ?? 'secret not set').slice(0, 200);
      body += `\n**Manual step required:** add these repository Actions secrets before running the workflow:\n- \`CLOUDFLARE_ACCOUNT_ID\` — Cloudflare dashboard → Workers & Pages → Overview (right sidebar)\n- \`CLOUDFLARE_API_TOKEN\` — Cloudflare dashboard → My Profile → API Tokens → create a scoped Workers/D1 deploy token\n\n(${shortReason})\n`;
    }

    const openedPr = await github.createPullRequest(owner, repo, {
      title: 'ci: add manual Cloudflare deploy workflow',
      body,
      head: branchName,
      base: defaultBranch,
    });

    await recordAgentAction(env, {
      owner, repo,
      actionType: 'deploy-workflow',
      summary: `Opened a deploy-workflow PR while reviewing PR #${job.prNumber}.${secretResult.ok ? ' Cloudflare Actions secrets were set automatically.' : ' Cloudflare Actions secrets need to be set manually.'}`,
      files: [DEPLOY_WORKFLOW_PATH],
      prNumber: openedPr.number,
      prUrl: openedPr.html_url,
      triggeringPrNumber: job.prNumber,
      triggeringJobId: job.id,
    });
  } catch (err) {
    logger.error('ensureDeployWorkflow failed', err instanceof Error ? err : new Error(String(err)));
  }
}
