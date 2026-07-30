import { Link } from 'react-router-dom';
import { PageHeader } from '@client/components/layout/page-header';
import { Alert } from '@client/components/ui/alert';
import { Badge } from '@client/components/ui/badge';
import { CopyButton } from '@client/components/ui/copy-button';
import {
  FileSearch,
  GitMerge,
  ShieldCheck,
  ListChecks,
  Settings,
  KeyRound,
} from 'lucide-react';

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Icon className="h-4 w-4 text-primary" />
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </div>
  );
}

export function JulesIntegrationPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        category="Integrations"
        title="Jules integration"
        description="How codra detects documentation gaps during a review and hands them off to Jules (jules.google) as a follow-up agent task."
      />

      <Section icon={FileSearch} title="What it does">
        <p>
          During a PR review, codra runs a <strong className="text-foreground">Docs Gap</strong> step
          that inspects the PR&apos;s changed files and the repo as a whole for missing or stale documentation:
        </p>
        <ul className="list-disc list-inside space-y-1 ml-1">
          <li>A missing or stale <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">AGENTS.md</code> / <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">CLAUDE.md</code></li>
          <li>A missing or stale <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">README.md</code></li>
          <li>A missing frontend <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">docs/</code> suite — only checked for repos that actually have a frontend</li>
          <li>Under-documented functions in the PR&apos;s changed files — files where missing docstrings outnumber documented ones</li>
        </ul>
        <p>
          If any gaps are found, codra posts a PR comment summarizing them and stages a Jules task with a
          prompt describing exactly what to fill in.
        </p>
      </Section>

      <Section icon={GitMerge} title="Launches only on merge">
        <p>
          The staged Jules task does not start automatically. codra only opens the Jules agent session when
          that PR is <strong className="text-foreground">merged</strong> — never when the PR is closed without merging.
        </p>
      </Section>

      <Section icon={ShieldCheck} title="Prerequisites">
        <ul className="list-disc list-inside space-y-1 ml-1">
          <li>The repository must be connected to the Jules GitHub app (<a href="https://jules.google" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">jules.google</a>).</li>
          <li>
            A <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">JULES_API_KEY</code> must be
            configured (Cloudflare secret-store binding — already wired for this deployment).
          </li>
        </ul>
        <p>
          If either prerequisite is missing, codra marks the staged session as <Badge variant="neutral">skipped</Badge> and
          notes the reason on the PR instead of failing the review.
        </p>
      </Section>

      <Section icon={ListChecks} title="Where to see sessions">
        <p>
          Every Jules session codra has staged or launched — including the full prompt sent, and its state — is
          logged on the{' '}
          <Link to="/jules/operations" className="text-primary hover:underline">
            Jules Operations
          </Link>{' '}
          page.
        </p>
      </Section>

      <Section icon={Settings} title="Config toggle">
        <p>
          Set <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">review.jules.enabled</code> to{' '}
          <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">false</code> in a repo&apos;s config to
          opt out entirely. It defaults to <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">true</code>.
        </p>
      </Section>

      <div className="rounded-lg border border-border p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <KeyRound className="h-4 w-4 text-primary" />
          GitHub Action secrets
        </h2>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            Separately from Jules, codra can open a deploy-workflow PR that adds a manual (
            <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">workflow_dispatch</code>) GitHub
            Actions workflow for deploying the Worker. That workflow needs two repository Actions secrets:
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <CopyButton value="CLOUDFLARE_ACCOUNT_ID" label="Copy CLOUDFLARE_ACCOUNT_ID" copiedLabel="Copied" />
            <CopyButton value="CLOUDFLARE_API_TOKEN" label="Copy CLOUDFLARE_API_TOKEN" copiedLabel="Copied" />
          </div>

          <p>
            codra sets these <strong className="text-foreground">automatically</strong> if the GitHub App has the{' '}
            <strong className="text-foreground">Actions Secrets: write</strong> repository permission. Otherwise it
            degrades gracefully and writes manual setup instructions into the PR body instead.
          </p>

          <Alert variant="default">
            <p className="font-semibold text-foreground">Manual setup (only if the App lacks the permission)</p>
            <ul className="mt-2 list-disc list-inside space-y-1">
              <li>
                <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">CLOUDFLARE_ACCOUNT_ID</code> —
                Cloudflare dashboard → Workers &amp; Pages → Overview (right sidebar)
              </li>
              <li>
                <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">CLOUDFLARE_API_TOKEN</code> — a
                Workers-scoped Cloudflare API token, created under Cloudflare dashboard → My Profile → API Tokens
              </li>
              <li>
                Both go under GitHub repo → <strong className="text-foreground">Settings → Secrets and variables → Actions</strong>
              </li>
            </ul>
          </Alert>

          <p>
            The generated workflow ships with its push-to-<code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">main</code> auto-deploy
            trigger <strong className="text-foreground">commented out</strong> — uncomment it if continuous deploys are wanted. The whole
            deploy-workflow PR can be disabled per repo via{' '}
            <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">review.deployWorkflow.enabled</code>.
          </p>
        </div>
      </div>
    </div>
  );
}

export default JulesIntegrationPage;
