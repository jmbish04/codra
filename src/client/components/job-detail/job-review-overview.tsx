import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Sparkles } from 'lucide-react';
import { cn } from '@client/lib/utils';
import type { JobDetail } from '@shared/schema';
import { reviewSeverities } from '@shared/schema';
import { severityConfig } from './constants';

interface JobReviewOverviewProps {
  job: JobDetail;
}

export function JobReviewOverview({ job }: JobReviewOverviewProps) {
  const hasOverview = !!(job.summaryMarkdown || job.overallCorrectness || (job.overallConfidenceScore !== undefined && job.overallConfidenceScore !== null));
  if (!hasOverview) return null;

  const allComments = job.files.flatMap((f) => f.parsedComments);
  const sevCounts = Object.fromEntries(
    reviewSeverities.map((s) => [s, allComments.filter((c) => c.severity === s).length]),
  );

  const renderSummary = () => {
    if (!job.summaryMarkdown) return '';
    let content = job.summaryMarkdown.replace(/^(✅ \*\*Approved\*\*|💬 \*\*Comments posted\*\*)\n\n/, '').trim();
    if (content.startsWith('### 💡 Codra Review')) return content;
    
    const shortSha = job.commitSha.slice(0, 10);
    return `### 💡 Codra Review\n\nHere are some automated review suggestions for this pull request.\n\n**Reviewed commit:** \`${shortSha}\`\n\n<details>\n<summary>ℹ️ About Codra</summary>\n\n<br/>\n\n[Your team has set up Codra to review pull requests in this repo](https://codra.devarshi.dev/repos). Reviews are triggered when you:\n\n- **Open** a pull request for review\n- **Mark** a draft as ready\n- **Comment** "@codra-app review"\n\nIf Codra has suggestions, it will comment; otherwise it will react with 👍.\n\nCodra can also answer questions or update the PR. Try commenting "@codra-app address that feedback".\n\n</details>\n\n---\n\n${content}`;
  };

  return (
    <div className="surface overflow-hidden mb-6 relative">
      <div className="absolute top-0 right-0 p-4 opacity-[0.06] pointer-events-none">
        <Sparkles size={60} />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          <Sparkles size={14} strokeWidth={1.75} className="text-primary" />
          <span className="text-sm font-semibold text-foreground">Review Overview</span>
        </div>
        <div className="flex items-center gap-3">
          {job.overallCorrectness && (
            <span
              className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider border"
              style={
                job.overallCorrectness.toLowerCase().includes('incorrect')
                  ? { background: 'var(--danger-bg)', color: 'var(--danger)', borderColor: 'var(--danger-border)' }
                  : { background: 'var(--success-bg)', color: 'var(--success)', borderColor: 'var(--success-border)' }
              }
            >
              {job.overallCorrectness}
            </span>
          )}
          {(job.overallConfidenceScore !== undefined && job.overallConfidenceScore !== null) && (
            <div className="flex flex-col items-end">
              <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground/60 leading-none mb-0.5">Confidence</span>
              <span className="text-sm font-bold text-foreground leading-none">{(Number(job.overallConfidenceScore) * 100).toFixed(0)}%</span>
            </div>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="px-5 py-5">
        <div className="prose max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
            {renderSummary()}
          </ReactMarkdown>
        </div>

        {/* Severity Triage */}
        <div className="mt-6 pt-5 border-t border-border/40">
          <div className="flex items-center gap-2 mb-3.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Priority Triage</p>
            <div className="h-px flex-1 bg-border/30" />
          </div>
          <div className="flex flex-wrap gap-2.5">
            {reviewSeverities.map((sev) => {
              const count = sevCounts[sev] || 0;
              const cfg = severityConfig[sev];
              if (count === 0 && sev !== 'nit') return null;

              return (
                <div
                  key={sev}
                  className={cn(
                    'group flex items-center gap-3 rounded-xl border px-3.5 py-2 transition-all duration-200',
                    count > 0
                      ? `${cfg?.bg} ${cfg?.border} hover:-translate-y-[1px] hover:shadow-md`
                      : 'bg-muted/30 border-border/30 opacity-50',
                  )}
                >
                  {cfg?.svg ? (
                    <img src={cfg.svg} alt={sev} className="w-[17px] h-[17px] transition-transform group-hover:scale-110" />
                  ) : (
                    <cfg.icon
                      size={14}
                      className={cn('transition-transform group-hover:scale-110', count > 0 ? cfg?.iconColor : 'text-muted-foreground')}
                    />
                  )}
                  <div className="flex flex-col leading-none">
                    <span className={cn('text-[9px] font-bold uppercase tracking-wider mb-0.5', count > 0 ? cfg?.text : 'text-muted-foreground')}>
                      {sev}
                    </span>
                    <span className={cn('text-lg font-bold font-mono', count > 0 ? 'text-foreground' : 'text-muted-foreground/40')}>
                      {count}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
