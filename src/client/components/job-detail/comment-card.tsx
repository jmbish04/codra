import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { FileText, Sparkles } from 'lucide-react';
import { cn } from '@client/lib/utils';
import type { ParsedReviewComment } from '@shared/schema';
import { severityConfig } from './constants';

interface CommentCardProps {
  comment: ParsedReviewComment;
  filePath: string;
}

export function CommentCard({ comment, filePath }: CommentCardProps) {
  const sev = severityConfig[comment.severity] ?? severityConfig.nit;
  const SevIcon = sev.icon;

  return (
    <article
      className={cn(
        'surface-hover rounded-2xl border p-5 transition-all mb-4',
        sev.bg, sev.border,
      )}
    >
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {sev.svg ? (
            <img src={sev.svg} alt={comment.severity} className="w-[18px] h-[18px] shrink-0" />
          ) : (
            <SevIcon size={15} className={cn('shrink-0', sev.iconColor)} />
          )}
          <span className="font-bold text-sm text-foreground leading-snug">{comment.title}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`severity-tag ${comment.severity}`}>{comment.severity}</span>
        </div>
      </div>

      {/* Meta: file · line */}
      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1 font-mono bg-card/60 px-1.5 py-0.5 rounded text-foreground/70">
          <FileText size={10} /> {filePath}
        </span>
        {comment.line != null && (
          <span className="text-muted-foreground font-medium">line {comment.line}</span>
        )}
      </div>

      {/* Body - stripped of suggestions to avoid duplication in UI */}
      <div className="prose prose-sm max-w-none text-foreground/90 leading-relaxed mb-4">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
          {comment.body.split('```suggestion')[0].trim()}
        </ReactMarkdown>
      </div>

      {/* Code suggestion (UI view) */}
      {comment.codeSuggestion && (
        <div className="mt-4 pt-4 border-t border-border/40">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={13} className="text-amber-500" />
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/80">
              Suggested Fix
            </p>
          </div>
          <div className="relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-amber-500/10 to-orange-500/10 rounded-xl blur opacity-0 group-hover:opacity-100 transition duration-500" />
            <div className="relative rounded-xl overflow-hidden border border-amber-200/50 bg-amber-50/30 dark:bg-amber-950/20">
              <div className="flex items-center justify-between px-3 py-1.5 bg-amber-100/50 dark:bg-amber-900/40 border-b border-amber-200/50">
                <span className="text-[10px] font-mono font-medium text-amber-700 dark:text-amber-400">javascript</span>
              </div>
              <div className="p-3 overflow-x-auto text-[13px] font-mono leading-relaxed prose-pre:m-0 prose-pre:bg-transparent prose-pre:p-0 prose-code:text-amber-900 dark:prose-code:text-amber-200">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                  {`\`\`\`javascript\n${comment.codeSuggestion.replace(/```suggestion\n?|```/g, '').trim()}\n\`\`\``}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
