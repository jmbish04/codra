import { useState } from 'react';
import { PageHeader } from '@client/components/layout/page-header';
import { Button } from '@client/components/ui/button';
import {
  GitPullRequest,
  Cloud,
  Key,
  Database,
  Terminal,
  Copy,
  Check,
  Info,
  AlertTriangle,
  Server,
  Settings,
} from 'lucide-react';

interface CodeBlockProps {
  code: string;
}

function CodeBlock({ code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group rounded-lg border border-border/60 bg-muted/30 dark:bg-black/40 font-mono text-[13px] leading-relaxed text-foreground">
      <pre className="p-4 overflow-x-auto whitespace-pre">{code}</pre>
      <button
        onClick={handleCopy}
        className="absolute top-3 right-3 p-1.5 rounded bg-background/80 hover:bg-background border border-border/50 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-200"
        title="Copy code"
      >
        {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
      </button>
    </div>
  );
}

function InfoCallout({ children, variant = 'info' }: { children: React.ReactNode; variant?: 'info' | 'warning' | 'success' }) {
  const styles = {
    info: 'bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400',
    warning: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-600 dark:text-yellow-400',
    success: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400',
  };
  const Icon = variant === 'warning' ? AlertTriangle : Info;

  return (
    <div className={`${styles[variant]} border p-4 rounded-xl flex gap-3 text-sm leading-relaxed`}>
      <Icon className="shrink-0 mt-0.5" size={18} />
      <div>{children}</div>
    </div>
  );
}

function SecretGroup({ title, items }: { title: string; items: { binding: string; secretName: string; note?: string }[] }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">{title}</h4>
      <div className="border border-border/40 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/30">
              <th className="text-left p-2 font-semibold text-muted-foreground">Binding</th>
              <th className="text-left p-2 font-semibold text-muted-foreground">Secret Name</th>
              <th className="text-left p-2 font-semibold text-muted-foreground">Notes</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.binding} className="border-t border-border/20">
                <td className="p-2 font-mono text-foreground">{item.binding}</td>
                <td className="p-2 font-mono text-muted-foreground">{item.secretName}</td>
                <td className="p-2 text-muted-foreground">{item.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SetupGuidePage() {
  const [activeTab, setActiveTab] = useState<'github' | 'cloudflare' | 'secrets' | 'maintenance'>('github');
  const origin = typeof window !== 'undefined' && window.location.origin.includes('workers.dev')
    ? window.location.origin
    : 'https://codra.hacolby.workers.dev';

  const tabs = [
    { id: 'github' as const, label: 'GitHub App', icon: GitPullRequest },
    { id: 'cloudflare' as const, label: 'Cloudflare Infra', icon: Cloud },
    { id: 'secrets' as const, label: 'Secrets & Vars', icon: Key },
    { id: 'maintenance' as const, label: 'CLI & Maintenance', icon: Terminal },
  ];

  return (
    <section className="page-enter flex flex-col gap-6 max-w-4xl">
      <PageHeader
        category="Documentation"
        title="Setup & Maintenance Guide"
        description="Follow this step-by-step guide to provision and maintain your Codra deployment on Cloudflare."
      />

      {/* Tabs */}
      <div className="flex border-b border-border/40 pb-px">
        <div className="flex gap-2 flex-wrap">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <Button
                key={tab.id}
                variant={isActive ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab(tab.id)}
                className="gap-2 font-semibold text-xs transition-all"
              >
                <Icon size={14} />
                {tab.label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Tab Contents */}
      <div className="flex flex-col gap-8 mt-2">
        {activeTab === 'github' && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <GitPullRequest size={18} /> 1. Create a GitHub App
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Codra integrates with your GitHub repositories using a custom GitHub App. This app listens to PR webhooks, handles &quot;@mention&quot; commands via issue comments, authorizes OAuth user login, and posts automated AI review comments.
              </p>
            </div>

            <div className="border border-border/50 rounded-xl p-5 bg-card flex flex-col gap-4">
              <h3 className="text-sm font-semibold text-foreground">GitHub App Settings</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="space-y-1">
                  <p className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">Homepage URL</p>
                  <p className="font-mono text-xs text-foreground bg-muted/40 p-2 rounded border border-border/40">{origin}</p>
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">User Authorization Callback URL</p>
                  <p className="font-mono text-xs text-foreground bg-muted/40 p-2 rounded border border-border/40">{origin}/auth/github/callback</p>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <p className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">Webhook URL</p>
                  <p className="font-mono text-xs text-foreground bg-muted/40 p-2 rounded border border-border/40">{origin}/webhook</p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <h3 className="text-sm font-semibold text-foreground">Repository Permissions</h3>
              <p className="text-sm text-muted-foreground">
                Ensure the GitHub App is configured with the following repository permissions:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div className="border border-border/40 rounded-lg p-3 bg-muted/10 space-y-1">
                  <p className="font-semibold text-foreground">Pull Requests</p>
                  <p className="text-xs text-muted-foreground">Access: <strong className="text-foreground">Read & Write</strong></p>
                  <p className="text-[11px] text-muted-foreground/80">Create review comments, post PR reviews, and manage review status.</p>
                </div>
                <div className="border border-border/40 rounded-lg p-3 bg-muted/10 space-y-1">
                  <p className="font-semibold text-foreground">Checks</p>
                  <p className="text-xs text-muted-foreground">Access: <strong className="text-foreground">Read & Write</strong></p>
                  <p className="text-[11px] text-muted-foreground/80">Create and update check runs with review progress (queued → in_progress → completed).</p>
                </div>
                <div className="border border-border/40 rounded-lg p-3 bg-muted/10 space-y-1">
                  <p className="font-semibold text-foreground">Contents</p>
                  <p className="text-xs text-muted-foreground">Access: <strong className="text-foreground">Read Only</strong></p>
                  <p className="text-[11px] text-muted-foreground/80">Fetch file diffs and surrounding code context for AI analysis.</p>
                </div>
                <div className="border border-border/40 rounded-lg p-3 bg-muted/10 space-y-1">
                  <p className="font-semibold text-foreground">Issues</p>
                  <p className="text-xs text-muted-foreground">Access: <strong className="text-foreground">Read & Write</strong></p>
                  <p className="text-[11px] text-muted-foreground/80">Read issue comments for @mention commands and manage PR labels.</p>
                </div>
                <div className="border border-border/40 rounded-lg p-3 bg-muted/10 space-y-1">
                  <p className="font-semibold text-foreground">Metadata</p>
                  <p className="text-xs text-muted-foreground">Access: <strong className="text-foreground">Read Only</strong></p>
                  <p className="text-[11px] text-muted-foreground/80">Automatically required by GitHub for basic repository information.</p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <h3 className="text-sm font-semibold text-foreground">Subscribe to Events</h3>
              <p className="text-sm text-muted-foreground">
                In the <strong>Subscribe to events</strong> section, check the following webhooks:
              </p>
              <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 ml-2">
                <li><strong className="text-foreground">Pull request</strong> — triggers on opened, synchronize, ready_for_review, reopened, and closed</li>
                <li><strong className="text-foreground">Issue comment</strong> — triggers on created (handles @mention commands on PRs)</li>
              </ul>
            </div>

            <InfoCallout variant="success">
              <strong className="font-bold">Next Step:</strong> Generate a Private Key on the GitHub App settings page, save the downloaded <code className="font-mono text-xs bg-muted/40 p-0.5 px-1 rounded">.pem</code> file, and note your <strong>Client ID</strong>, <strong>Client Secret</strong>, <strong>App ID</strong>, and <strong>Webhook Secret</strong>. You&apos;ll enter these in the Secrets tab.
            </InfoCallout>
          </div>
        )}

        {activeTab === 'cloudflare' && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Cloud size={18} /> 2. Provision Cloudflare Infrastructure
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Run the following commands locally using <code className="font-mono text-xs bg-muted p-0.5 px-1 rounded text-foreground">wrangler</code> to provision D1, KV, and Queue infrastructure on your Cloudflare account.
              </p>
            </div>

            <div className="space-y-5">
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Database size={15} /> D1 Database
                </h3>
                <p className="text-xs text-muted-foreground">Create the D1 SQLite database used for jobs, webhook deliveries, repos, and review data:</p>
                <CodeBlock code="npx wrangler d1 create codra" />
                <p className="text-[11px] text-muted-foreground">Copy the output <code className="font-mono text-xs bg-muted/40 p-0.5 px-1 rounded">database_id</code> into your <code className="font-mono text-xs bg-muted/40 p-0.5 px-1 rounded">wrangler.jsonc</code> under <code className="font-mono text-xs bg-muted/40 p-0.5 px-1 rounded">d1_databases[0].database_id</code>.</p>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Cloud size={15} /> KV Namespaces
                </h3>
                <p className="text-xs text-muted-foreground">Create the KV namespaces for session/OAuth state storage and AI prompt management:</p>
                <CodeBlock code={`npx wrangler kv namespace create APP_KV\nnpx wrangler kv namespace create PROMPTS_KV`} />
                <p className="text-[11px] text-muted-foreground">Copy each namespace <code className="font-mono text-xs bg-muted/40 p-0.5 px-1 rounded">id</code> into the corresponding <code className="font-mono text-xs bg-muted/40 p-0.5 px-1 rounded">kv_namespaces</code> entry in <code className="font-mono text-xs bg-muted/40 p-0.5 px-1 rounded">wrangler.jsonc</code>.</p>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Terminal size={15} /> Cloudflare Queues
                </h3>
                <p className="text-xs text-muted-foreground">Create the main job queue and the dead-letter queue (DLQ) for asynchronous PR reviews:</p>
                <CodeBlock code={`npx wrangler queues create codra-review-jobs\nnpx wrangler queues create codra-review-dlq`} />
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Server size={15} /> Durable Objects
                </h3>
                <p className="text-xs text-muted-foreground">
                  Codra uses four Durable Object classes: <strong>RepoAgent</strong> (orchestrates per-repo reviews), <strong>Chat</strong> (assistant-ui frontend sessions), <strong>ReviewAgent</strong> (per-review AI agent), and <strong>GitHubLikeMCP</strong> (MCP server for GitHub-like tools). These are declared in <code className="font-mono text-xs bg-muted/40 p-0.5 px-1 rounded">wrangler.jsonc</code> under <code className="font-mono text-xs bg-muted/40 p-0.5 px-1 rounded">durable_objects.bindings</code> — no manual provisioning is needed; Wrangler creates them on deploy.
                </p>
                <InfoCallout variant="warning">
                  DO migrations are defined in <code className="font-mono text-xs bg-muted/40 p-0.5 px-1 rounded">wrangler.jsonc</code> under <code className="font-mono text-xs bg-muted/40 p-0.5 px-1 rounded">migrations</code>. When adding a new Durable Object class, add it to <code className="font-mono text-xs bg-muted/40 p-0.5 px-1 rounded">new_sqlite_classes</code> in a new migration tag. Existing classes: RepoAgent, Chat, ReviewAgent, GitHubLikeMCP (all tagged <code className="font-mono text-xs bg-muted/40 p-0.5 px-1 rounded">v1</code>).
                </InfoCallout>
              </div>
            </div>

            <InfoCallout variant="warning">
              <strong className="font-bold">Wrangler Sync:</strong> After creation, update the D1 <code className="font-mono text-xs bg-muted/40 p-0.5 px-1 rounded">database_id</code> and KV namespace <code className="font-mono text-xs bg-muted/40 p-0.5 px-1 rounded">id</code> values in your <code className="font-mono text-xs bg-muted/40 p-0.5 px-1 rounded border border-border/40">wrangler.jsonc</code> with the newly generated IDs. Queue names are referenced by name and do not require ID updates.
            </InfoCallout>
          </div>
        )}

        {activeTab === 'secrets' && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Key size={18} /> 3. Secrets, Variables & Secrets Store
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Codra uses three layers: <strong>Worker Secrets</strong> (encrypted, set via <code className="font-mono text-xs bg-muted p-0.5 px-1 rounded text-foreground">wrangler secret put</code>), <strong>Cloudflare Secrets Store</strong> (shared across workers, accessed via <code className="font-mono text-xs bg-muted p-0.5 px-1 rounded text-foreground">binding.get()</code>), and <strong>Plain-text Variables</strong> (set in <code className="font-mono text-xs bg-muted p-0.5 px-1 rounded text-foreground">wrangler.jsonc</code> under <code className="font-mono text-xs bg-muted p-0.5 px-1 rounded text-foreground">vars</code>).
              </p>
            </div>

            <div className="space-y-6">
              {/* Worker Secrets */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">1. Worker Secrets (Encrypted)</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  These are encrypted secrets stored directly on the Worker. Set each one interactively:
                </p>
                <div className="flex flex-col gap-4">
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-foreground">APP_PRIVATE_KEY</p>
                    <p className="text-[11px] text-muted-foreground">GitHub App private key in PEM format. Paste the full contents of the <code className="font-mono bg-muted/40 p-0.5 px-1 rounded">.pem</code> file when prompted.</p>
                    <CodeBlock code="npx wrangler secret put APP_PRIVATE_KEY" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-foreground">LLM_CONFIG_ENCRYPTION_KEY</p>
                    <p className="text-[11px] text-muted-foreground">A 32-character hex key used to encrypt external LLM provider API keys stored in D1.</p>
                    <CodeBlock code="npx wrangler secret put LLM_CONFIG_ENCRYPTION_KEY" />
                  </div>
                </div>
              </div>

              {/* Secrets Store */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">2. Cloudflare Secrets Store</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  All Secrets Store bindings share a single <code className="font-mono bg-muted/40 p-0.5 px-1 rounded text-foreground">store_id</code>. Populate each key in the Cloudflare dashboard under <strong>Workers & Pages → Secrets Store</strong>. These are <em>accessed asynchronously</em> in code via <code className="font-mono bg-muted/40 p-0.5 px-1 rounded text-foreground">await env.BINDING.get()</code>.
                </p>

                <SecretGroup
                  title="GitHub API"
                  items={[
                    { binding: 'GITHUB_CLIENT_ID', secretName: 'CORE_GITHUB_API_GITHUB_CLIENT_ID', note: 'OAuth Client ID' },
                    { binding: 'GITHUB_CLIENT_SECRET', secretName: 'CORE_GITHUB_API_GITHUB_SECRET', note: 'OAuth Client Secret' },
                    { binding: 'GITHUB_APP_ID', secretName: 'CORE_GITHUB_API_GITHUB_APP_ID', note: 'App ID from GitHub' },
                    { binding: 'GITHUB_TOKEN', secretName: 'GH_TOKEN', note: 'Personal access token' },
                  ]}
                />

                <SecretGroup
                  title="GitHub App Private Key (Split)"
                  items={[
                    { binding: 'CORE_GITHUB_API_GITHUB_APP_PRIVATE_KEY_PT1', secretName: 'CORE_GITHUB_API_GITHUB_APP_PRIVATE_KEY_PT1', note: 'PEM part 1' },
                    { binding: 'CORE_GITHUB_API_GITHUB_APP_PRIVATE_KEY_PT2', secretName: 'CORE_GITHUB_API_GITHUB_APP_PRIVATE_KEY_PT2', note: 'PEM part 2' },
                    { binding: 'CORE_GITHUB_API_GITHUB_APP_PRIVATE_KEY_PT3', secretName: 'CORE_GITHUB_API_GITHUB_APP_PRIVATE_KEY_PT3', note: 'PEM part 3' },
                  ]}
                />

                <SecretGroup
                  title="Cloudflare Services"
                  items={[
                    { binding: 'CF_ACCOUNT_ID', secretName: 'CLOUDFLARE_ACCOUNT_ID', note: 'Account ID' },
                    { binding: 'CF_API_TOKEN', secretName: 'CLOUDFLARE_WRANGLER_API_TOKEN', note: 'API token for DLQ requeue' },
                    { binding: 'CLOUDFLARE_IMAGES_STREAM_TOKEN', secretName: 'CLOUDFLARE_IMAGES_STREAM_TOKEN', note: 'Images/Stream token' },
                    { binding: 'CF_BROWSER_RENDER_TOKEN', secretName: 'CLOUDFLARE_BROWSER_RENDER_TOKEN', note: 'Browser Rendering token' },
                    { binding: 'AI_GATEWAY_TOKEN', secretName: 'CLOUDFLARE_AI_GATEWAY_TOKEN', note: 'AI Gateway auth' },
                    { binding: 'WORKER_API_KEY', secretName: 'WORKER_API_KEY', note: 'Internal Worker auth key' },
                  ]}
                />

                <SecretGroup
                  title="AI & Integrations"
                  items={[
                    { binding: 'GEMINI_API_KEY', secretName: 'GOOGLE_API_KEY', note: 'Google Gemini API' },
                    { binding: 'JULES_API_KEY', secretName: 'JULES_API_KEY', note: 'Jules agent key' },
                    { binding: 'CLICKUP_TOKEN', secretName: 'CLICKUP_TOKEN', note: 'ClickUp API' },
                    { binding: 'CLICKUP_TEAM_ID', secretName: 'CLICKUP_TEAM_ID', note: 'ClickUp workspace' },
                  ]}
                />

                <SecretGroup
                  title="Google Service Account (Gmail)"
                  items={[
                    { binding: 'GOOGLE_CREDS_SA_PRIVATE_KEY_PT_1', secretName: 'GOOGLE_CREDS_SA_PRIVATE_KEY_PT_1', note: 'SA key part 1' },
                    { binding: 'GOOGLE_CREDS_SA_PRIVATE_KEY_PT_2', secretName: 'GOOGLE_CREDS_SA_PRIVATE_KEY_PT_2', note: 'SA key part 2' },
                    { binding: 'GOOGLE_CREDS_SA_CLIENT_EMAIL', secretName: 'GOOGLE_CREDS_SA_CLIENT_EMAIL', note: 'Service account email' },
                  ]}
                />
              </div>

              {/* Vars */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Settings size={14} /> 3. Plain-text Variables
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  These are non-sensitive configuration values defined in <code className="font-mono bg-muted/40 p-0.5 px-1 rounded text-foreground">wrangler.jsonc</code> under the <code className="font-mono bg-muted/40 p-0.5 px-1 rounded text-foreground">vars</code> key. Edit them directly in the file:
                </p>
                <div className="border border-border/40 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/30">
                        <th className="text-left p-2 font-semibold text-muted-foreground">Variable</th>
                        <th className="text-left p-2 font-semibold text-muted-foreground">Description</th>
                        <th className="text-left p-2 font-semibold text-muted-foreground">Example</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-border/20">
                        <td className="p-2 font-mono text-foreground">APP_URL</td>
                        <td className="p-2 text-muted-foreground">Public URL of the deployed Worker</td>
                        <td className="p-2 font-mono text-muted-foreground">https://codra.your-domain.workers.dev</td>
                      </tr>
                      <tr className="border-t border-border/20">
                        <td className="p-2 font-mono text-foreground">AUTH_CALLBACK_URL</td>
                        <td className="p-2 text-muted-foreground">OAuth redirect URL — must match GitHub App</td>
                        <td className="p-2 font-mono text-muted-foreground">https://codra.your-domain.workers.dev/auth/github/callback</td>
                      </tr>
                      <tr className="border-t border-border/20">
                        <td className="p-2 font-mono text-foreground">BOT_USERNAME</td>
                        <td className="p-2 text-muted-foreground">GitHub App&apos;s username for @mention filtering</td>
                        <td className="p-2 font-mono text-muted-foreground">codra-app</td>
                      </tr>
                      <tr className="border-t border-border/20">
                        <td className="p-2 font-mono text-foreground">GITHUB_APP_SLUG</td>
                        <td className="p-2 text-muted-foreground">GitHub App slug for installation links</td>
                        <td className="p-2 font-mono text-muted-foreground">codra-app-personal</td>
                      </tr>
                      <tr className="border-t border-border/20">
                        <td className="p-2 font-mono text-foreground">DASHBOARD_ALLOWED_USERS</td>
                        <td className="p-2 text-muted-foreground">Comma-separated GitHub usernames allowed to log in</td>
                        <td className="p-2 font-mono text-muted-foreground">your-github-login</td>
                      </tr>
                      <tr className="border-t border-border/20">
                        <td className="p-2 font-mono text-foreground">ENVIRONMENT</td>
                        <td className="p-2 text-muted-foreground">Runtime environment tag</td>
                        <td className="p-2 font-mono text-muted-foreground">production</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'maintenance' && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Terminal size={18} /> 4. CLI & Maintenance Recipes
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Common terminal commands for local development, database migrations, type generation, and deployment. All scripts use <code className="font-mono text-xs bg-muted p-0.5 px-1 rounded text-foreground">pnpm</code> (preferred) or <code className="font-mono text-xs bg-muted p-0.5 px-1 rounded text-foreground">npm</code>.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 text-sm">
              {/* Local Development */}
              <div className="border border-border/40 rounded-xl p-4 bg-muted/10 space-y-2">
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                  <Terminal size={15} /> Local Development
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Starts a concurrent dev server: Vite watches & builds client assets, Wrangler runs the Worker locally with D1/KV/Queues bindings.
                </p>
                <CodeBlock code="pnpm run dev" />
                <p className="text-[11px] text-muted-foreground">
                  This runs <code className="font-mono bg-muted/40 p-0.5 px-1 rounded">vite build --watch</code> + <code className="font-mono bg-muted/40 p-0.5 px-1 rounded">wrangler dev --local</code> simultaneously via <code className="font-mono bg-muted/40 p-0.5 px-1 rounded">concurrently</code>.
                </p>
              </div>

              {/* DB Migrations */}
              <div className="border border-border/40 rounded-xl p-4 bg-muted/10 space-y-2">
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                  <Database size={15} /> Database Migrations (Drizzle ORM)
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Codra uses Drizzle ORM with D1. Schemas are defined in TypeScript under <code className="font-mono bg-muted/40 p-0.5 px-1 rounded">src/server/db/schemas/</code>. Run <code className="font-mono bg-muted/40 p-0.5 px-1 rounded">drizzle-kit</code> to generate migration SQL from schema changes.
                </p>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <p className="text-[11px] text-muted-foreground font-semibold">Generate migration files after updating schemas:</p>
                    <CodeBlock code="pnpm run db:generate" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] text-muted-foreground font-semibold">Generate + apply migrations to local D1 (development):</p>
                    <CodeBlock code="pnpm run migrate:local" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] text-muted-foreground font-semibold">Generate + apply migrations to remote D1 (production):</p>
                    <CodeBlock code="pnpm run migrate:remote" />
                  </div>
                </div>
                <InfoCallout variant="info">
                  Both <code className="font-mono text-xs bg-muted/40 p-0.5 px-1 rounded">migrate:local</code> and <code className="font-mono text-xs bg-muted/40 p-0.5 px-1 rounded">migrate:remote</code> run <code className="font-mono text-xs bg-muted/40 p-0.5 px-1 rounded">drizzle-kit generate</code> first, then apply via wrangler. <code className="font-mono text-xs bg-muted/40 p-0.5 px-1 rounded">pnpm run migrate</code> is an alias for <code className="font-mono text-xs bg-muted/40 p-0.5 px-1 rounded">migrate:remote</code>.
                </InfoCallout>
              </div>

              {/* Type Generation */}
              <div className="border border-border/40 rounded-xl p-4 bg-muted/10 space-y-2">
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                  <Settings size={15} /> Type Generation
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Generate the <code className="font-mono bg-muted/40 p-0.5 px-1 rounded">Env</code> interface from your <code className="font-mono bg-muted/40 p-0.5 px-1 rounded">wrangler.jsonc</code> bindings. This writes to <code className="font-mono bg-muted/40 p-0.5 px-1 rounded">src/server/worker-env.d.ts</code>.
                </p>
                <CodeBlock code="pnpm run types" />
                <p className="text-[11px] text-muted-foreground">
                  Run this after adding/changing bindings in <code className="font-mono bg-muted/40 p-0.5 px-1 rounded">wrangler.jsonc</code>. The generated <code className="font-mono bg-muted/40 p-0.5 px-1 rounded">Env</code> interface is the single source of truth for all binding types. <code className="font-mono bg-muted/40 p-0.5 px-1 rounded">cf-typegen</code> is kept as a backwards-compatible alias.
                </p>
              </div>

              {/* Build & Deploy */}
              <div className="border border-border/40 rounded-xl p-4 bg-muted/10 space-y-2">
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                  <Cloud size={15} /> Build & Deploy
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Full production deploy: builds client assets, generates types, runs migrations, and deploys the Worker.
                </p>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <p className="text-[11px] text-muted-foreground font-semibold">Build only (client + typegen):</p>
                    <CodeBlock code="pnpm run build" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] text-muted-foreground font-semibold">Full deploy (build → migrate → deploy):</p>
                    <CodeBlock code="pnpm run deploy" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] text-muted-foreground font-semibold">Type-check without emitting (CI validation):</p>
                    <CodeBlock code="pnpm run typecheck" />
                  </div>
                </div>
              </div>

              {/* Model Context Protocol (MCP) */}
              <div className="border border-border/40 rounded-xl p-4 bg-muted/10 space-y-2">
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                  <Server size={15} /> Model Context Protocol (MCP) Server
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Codra exposes a standardized Model Context Protocol (MCP) server endpoint hosting GitHub management tools and repository governance rules. You can add it directly to compatible MCP clients (like Claude Desktop, Cursor, or Gemini) to let external AI agents interact with your Codra instance.
                </p>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <p className="text-[11px] text-muted-foreground font-semibold">1. Your live MCP Server URL (SSE Transport):</p>
                    <CodeBlock code={`${origin}/mcp`} />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] text-muted-foreground font-semibold">2. Example Claude Desktop Configuration:</p>
                    <CodeBlock code={`{
  "mcpServers": {
    "codra": {
      "type": "sse",
      "url": "${origin}/mcp"
    }
  }
}`} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
