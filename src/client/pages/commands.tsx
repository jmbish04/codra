import { useState } from 'react';
import { PageHeader } from '@client/components/layout/page-header';
import { Button } from '@client/components/ui/button';
import {
  GitPullRequest,
  Terminal,
  MessageSquare,
  Sparkles,
  Settings,
  HelpCircle,
  Copy,
  Check,
} from 'lucide-react';

interface CodeSnippetProps {
  code: string;
}

function CodeSnippet({ code }: CodeSnippetProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group rounded-lg border border-border/60 bg-muted/30 dark:bg-black/40 font-mono text-[13px] leading-relaxed text-foreground">
      <pre className="p-3 overflow-x-auto whitespace-pre">{code}</pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded bg-background/80 hover:bg-background border border-border/50 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-200"
        title="Copy comment"
      >
        {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
      </button>
    </div>
  );
}

export function CommandsPage() {
  return (
    <section className="page-enter flex flex-col gap-6 max-w-4xl">
      <PageHeader
        category="Documentation"
        title="Commands & Triggers"
        description="Learn how to interact with Codra and trigger AI code reviews on your GitHub Pull Requests."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* On-Demand Mentions Card */}
        <div className="border border-border/50 rounded-xl p-5 bg-card flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <MessageSquare size={18} />
            </div>
            <h3 className="text-sm font-semibold text-foreground">On-Demand Mention Reviews</h3>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Trigger a fresh review on your pull request at any time by leaving a comment. This is perfect for requesting a re-review after addressing comments or manually starting a run.
          </p>

          <div className="space-y-3 mt-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Default Command</p>
            <CodeSnippet code="@codra-app" />
            <p className="text-[11px] text-muted-foreground leading-normal">
              Any PR comment containing <code className="font-mono text-xs bg-muted/60 px-1 py-0.5 rounded text-foreground">@codra-app</code> will extract the pull request context and queue a new review job for the latest commit.
            </p>
          </div>

          <div className="border-t border-border/30 pt-4 flex gap-3 text-xs leading-relaxed text-muted-foreground">
            <Settings size={16} className="shrink-0 mt-0.5 text-primary" />
            <div>
              <strong className="text-foreground">Customizable Prefix:</strong> You can configure the trigger word (e.g. <code className="font-mono bg-muted/40 p-0.5 rounded">@my-bot</code>) per repository under the <strong>Settings</strong> tab.
            </div>
          </div>
        </div>

        {/* Automatic Triggers Card */}
        <div className="border border-border/50 rounded-xl p-5 bg-card flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Sparkles size={18} />
            </div>
            <h3 className="text-sm font-semibold text-foreground">Automatic Webhook Triggers</h3>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Codra can automatically review pull requests when certain events happen on GitHub. These triggers are customizable in your repository config.
          </p>

          <div className="space-y-2 mt-1">
            <div className="flex items-start justify-between border-b border-border/20 pb-2 text-xs">
              <span className="font-semibold text-foreground">PR Opened</span>
              <span className="text-muted-foreground font-mono text-[11px]">pull_request.opened</span>
            </div>
            <div className="flex items-start justify-between border-b border-border/20 pb-2 text-xs">
              <span className="font-semibold text-foreground">PR Synchronized (New Commits)</span>
              <span className="text-muted-foreground font-mono text-[11px]">pull_request.synchronize</span>
            </div>
            <div className="flex items-start justify-between border-b border-border/20 pb-2 text-xs">
              <span className="font-semibold text-foreground">PR Reopened</span>
              <span className="text-muted-foreground font-mono text-[11px]">pull_request.reopened</span>
            </div>
            <div className="flex items-start justify-between pb-1 text-xs">
              <span className="font-semibold text-foreground">PR Ready for Review</span>
              <span className="text-muted-foreground font-mono text-[11px]">pull_request.ready_for_review</span>
            </div>
          </div>

          <div className="border-t border-border/30 pt-4 flex gap-3 text-xs leading-relaxed text-muted-foreground">
            <HelpCircle size={16} className="shrink-0 mt-0.5 text-primary" />
            <div>
              <strong className="text-foreground">Draft PRs:</strong> By default, Codra skips reviews for draft PRs to save budget, then reviews them automatically once they are marked as ready.
            </div>
          </div>
        </div>
      </div>

      {/* Skipping / Advanced instructions */}
      <div className="border border-border/50 rounded-xl p-5 bg-card flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-primary/10 text-primary">
            <Terminal size={18} />
          </div>
          <h3 className="text-sm font-semibold text-foreground">Skipping Reviews</h3>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          You can temporarily skip automated reviews for specific commits or pull requests using standard conventions:
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs mt-1">
          <div className="border border-border/30 rounded-lg p-3 bg-muted/10 space-y-1">
            <p className="font-semibold text-foreground">Commit Message Flags</p>
            <p className="text-muted-foreground leading-normal">
              Include <code className="font-mono bg-muted/50 p-0.5 rounded text-foreground">[skip codra]</code> or <code className="font-mono bg-muted/50 p-0.5 rounded text-foreground">[codra skip]</code> anywhere in your commit message to prevent the webhook from queueing a review.
            </p>
          </div>
          <div className="border border-border/30 rounded-lg p-3 bg-muted/10 space-y-1">
            <p className="font-semibold text-foreground">PR Title/Body Flags</p>
            <p className="text-muted-foreground leading-normal">
              Add <code className="font-mono bg-muted/50 p-0.5 rounded text-foreground">[skip codra]</code> to the Pull Request title or body. Useful if you want to push multiple WIP updates without triggering LLM reviews.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
