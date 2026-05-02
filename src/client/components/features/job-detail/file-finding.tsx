import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { ChevronRight } from 'lucide-react';
import { StatusBadge } from '@client/components/shared/status-badge';
import type { FileReviewRecord, ParsedReviewComment } from '@shared/schema';
import { CommentCard } from './comment-card';

interface FileFindingProps {
  file: FileReviewRecord;
}

export function FileFinding({ file }: FileFindingProps) {
  return (
    <details key={file.id} className="group rounded-md border border-border/60 bg-card/80 transition-all surface-hover backdrop-blur-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-2 min-w-0">
          <ChevronRight size={15} className="shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
          <span className="font-mono text-sm font-medium text-foreground truncate">{file.filePath}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
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

        {/* File summary (when review succeeded) */}
        {file.fileStatus === 'done' && file.fileSummary && (
          <div className="mb-4 rounded-md border border-border/50 bg-muted/30 px-4 py-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Model summary</p>
            <div className="prose prose-sm max-w-none text-foreground/90 leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{file.fileSummary}</ReactMarkdown>
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
