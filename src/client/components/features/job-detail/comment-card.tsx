import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { FileText } from 'lucide-react';
import { cn } from '@client/lib/utils';
import type { ParsedReviewComment } from '@shared/schema';
import { severityConfig } from './constants';

const safeRehypePlugins = [rehypeRaw, rehypeSanitize];

function DiffCodeBlock({ code }: { code: string }) {
  const lines = code.split('\n');

  return (
    <pre className="overflow-x-auto text-[13px] font-mono leading-relaxed bg-transparent border-none py-2">
      <code className="block min-w-full">
        {lines.map((line, idx) => {
          let className = "px-3 py-0.5 block";
          let displayLine = line;

          const isDeletionMarker = line.includes('[!code --]') || line.includes('{/* [!code --] */}');
          const isAdditionMarker = line.includes('[!code ++]') || line.includes('{/* [!code ++] */}');

          if (line.startsWith('-') && !line.startsWith('---')) {
            className = "px-3 py-0.5 block bg-rose-950/30 text-rose-300/90 border-l-2 border-rose-500 line-through opacity-70";
            displayLine = line.slice(1);
          } else if (line.startsWith('+') && !line.startsWith('+++')) {
            className = "px-3 py-0.5 block bg-emerald-950/30 text-emerald-300/90 border-l-2 border-emerald-500 font-semibold";
            displayLine = line.slice(1);
          } else if (isDeletionMarker) {
            className = "px-3 py-0.5 block bg-rose-950/30 text-rose-300/90 border-l-2 border-rose-500 line-through opacity-70";
            displayLine = line
              .replace('// [!code --]', '')
              .replace('/* [!code --] */', '')
              .replace('{/* [!code --] */}', '')
              .replace('//[!code --]', '')
              .replace('/*[!code --]*/', '')
              .replace('{/*[!code --]*/}', '')
              .trimEnd();
          } else if (isAdditionMarker) {
            className = "px-3 py-0.5 block bg-emerald-950/30 text-emerald-300/90 border-l-2 border-emerald-500 font-semibold";
            displayLine = line
              .replace('// [!code ++]', '')
              .replace('/* [!code ++] */', '')
              .replace('{/* [!code ++] */}', '')
              .replace('//[!code ++]', '')
              .replace('/*[!code ++]*/', '')
              .replace('{/*[!code ++]*/}', '')
              .trimEnd();
          }

          return (
            <span key={idx} className={className}>
              {displayLine}
            </span>
          );
        })}
      </code>
    </pre>
  );
}

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
        'mb-4 rounded-md border p-5 shadow-sm',
        sev.bg, sev.border,
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-start gap-2 min-w-0">
          {sev.svg ? (
            <img src={sev.svg} alt={comment.severity} className="w-[18px] h-[18px] shrink-0 mt-px" />
          ) : (
            <SevIcon size={15} className={cn('shrink-0 mt-px', sev.iconColor)} />
          )}
          <span className="font-bold text-sm text-foreground leading-snug">{comment.title}</span>
        </div>
        <span className={`severity-tag ${comment.severity} shrink-0`}>{comment.severity}</span>
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
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={safeRehypePlugins}>
          {comment.body.split('```suggestion')[0].trim()}
        </ReactMarkdown>
      </div>

      {/* Code suggestion (UI view) */}
      {comment.codeSuggestion && (
        <div className="mt-4 pt-4 border-t border-border/40">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/70 mb-2">
            Suggested Fix
          </p>
          <div className="rounded-md overflow-hidden border bg-muted/20 border-border/60">
            <DiffCodeBlock code={comment.codeSuggestion.replace(/```suggestion\n?|```/g, '').trim()} />
          </div>
        </div>
      )}
    </article>
  );
}
