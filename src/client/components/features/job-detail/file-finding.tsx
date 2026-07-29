import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { ChevronRight } from 'lucide-react';
import { StatusBadge } from '@client/components/ui/badge';
import { fmtUsd } from '@client/lib/utils';
import type { CostBreakdownItem, FileReviewRecord, ParsedReviewComment } from '@shared/schema';
import { CommentCard } from './comment-card';
import { DiffViewer } from '@client/components/diff-viewer';

const safeRehypePlugins = [rehypeRaw, rehypeSanitize];

// Human labels + amount units for each metered usage type.
const USAGE_LABELS: Record<string, { label: string; unit: string }> = {
  ai_input_tokens: { label: 'AI input tokens', unit: 'tokens' },
  ai_output_tokens: { label: 'AI output tokens', unit: 'tokens' },
  do_requests: { label: 'Durable Object requests', unit: 'requests' },
  do_duration_gbs: { label: 'Durable Object duration', unit: 'GB-s' },
  d1_rows_read: { label: 'D1 rows read', unit: 'rows' },
  d1_rows_written: { label: 'D1 rows written', unit: 'rows' },
  subrequests: { label: 'Subrequests', unit: 'requests' },
};

function fmtAmount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/** Per-usage-type cost breakdown: type · amount · unit price · total. */
function CostBreakdownTable({ rows, total }: { rows: CostBreakdownItem[]; total: number | null | undefined }) {
  const priced = rows.filter((r) => r.usageAmount > 0 || r.totalCost > 0);
  const source = rows[0]?.rateSource;
  return (
    <div className="mb-4 rounded-md border border-border/50 bg-muted/20 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cost breakdown</p>
        <span className="font-mono text-sm font-semibold tabular-nums text-foreground">{fmtUsd(total)}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-3 font-medium">Usage type</th>
              <th className="py-1 pr-3 text-right font-medium">Amount</th>
              <th className="py-1 pr-3 text-right font-medium">Unit price</th>
              <th className="py-1 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {priced.map((r) => {
              const meta = USAGE_LABELS[r.usageType] ?? { label: r.usageType, unit: '' };
              return (
                <tr key={r.usageType} className="border-t border-border/30">
                  <td className="py-1 pr-3 text-foreground/90">{meta.label}</td>
                  <td className="py-1 pr-3 text-right font-mono text-muted-foreground">{fmtAmount(r.usageAmount)} <span className="text-muted-foreground/50">{meta.unit}</span></td>
                  <td className="py-1 pr-3 text-right font-mono text-muted-foreground">{fmtUsd(r.unitPrice)}/{r.perUnits >= 1_000_000 ? '1M' : r.perUnits}</td>
                  <td className="py-1 text-right font-mono text-foreground">{fmtUsd(r.totalCost)}</td>
                </tr>
              );
            })}
            {priced.length === 0 && (
              <tr><td colSpan={4} className="py-2 text-muted-foreground/60 italic">No metered usage recorded.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {source === 'fallback' && (
        <p className="mt-2 text-[10px] text-muted-foreground/60">Rates: public fallback (core-guardian pricing unavailable at review time).</p>
      )}
    </div>
  );
}

interface FileFindingProps {
  file: FileReviewRecord;
}

export function FileFinding({ file }: FileFindingProps) {
  return (
    <details key={file.id} className="group rounded-md border border-border/60 bg-card/80 shadow-md backdrop-blur-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-2 min-w-0">
          <ChevronRight size={15} className="shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
          <span className="font-mono text-sm font-medium text-foreground truncate">{file.filePath}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {file.costUsd != null && (
            <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-muted-foreground" title="Cost of reviewing this file">
              {fmtUsd(file.costUsd)}
            </span>
          )}
          <StatusBadge label={file.fileStatus} />
          <StatusBadge label={file.verdict ?? 'comment'} />
          {file.parsedComments.length > 0 && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
              {file.parsedComments.length}
            </span>
          )}
        </div>
      </summary>

      <div className="border-t border-border/40 px-5 pb-5 pt-4">
        {/* Split diff — visible immediately, even while the review is pending */}
        {file.diffInput && (
          <div className="mb-4 overflow-x-auto rounded-md border border-border/50">
            <DiffViewer patch={file.diffInput} layout="split" newTitle={file.filePath} className="text-xs" />
          </div>
        )}

        {file.fileStatus === 'pending' && (
          <p className="mb-4 text-xs text-muted-foreground">⏳ Codra is reviewing this file — findings will appear here when it finishes.</p>
        )}

        {/* File-level error */}
        {file.fileStatus === 'failed' && file.errorMessage && (
          <div
            className="mb-4 rounded-md border p-3"
            style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-border)' }}
          >
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--danger)' }}>Review error</p>
            <p className="font-mono text-xs break-all" style={{ color: 'var(--danger)' }}>{file.errorMessage}</p>
          </div>
        )}

        {/* Per-file cost breakdown by usage type */}
        {file.costBreakdown && file.costBreakdown.length > 0 && (
          <CostBreakdownTable rows={file.costBreakdown} total={file.costUsd} />
        )}

        {/* File summary (when review succeeded) */}
        {file.fileStatus === 'done' && file.fileSummary && (
          <div className="mb-4 rounded-md border border-border/50 bg-muted/30 px-4 py-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Model summary</p>
            <div className="prose prose-sm max-w-none text-foreground/90 leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={safeRehypePlugins}>{file.fileSummary}</ReactMarkdown>
            </div>
          </div>
        )}

        {file.parsedComments.length > 0 && (
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Inline comments ({file.parsedComments.length})
            </p>
            <div className="flex flex-col gap-3">
              {file.parsedComments.map((comment: ParsedReviewComment, index: number) => (
                <CommentCard key={`${file.id}-${index}`} comment={comment} filePath={file.filePath} />
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
