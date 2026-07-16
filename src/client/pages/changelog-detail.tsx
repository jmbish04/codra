import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, ExternalLink } from 'lucide-react';
import { api } from '@client/lib/api';
import { Skeleton } from '@client/components/shared/skeleton';
import { Alert } from '@client/components/ui/alert';
import { MermaidDiagram } from '@client/components/features/changelog/mermaid-diagram';
import type { ChangelogEntry } from '@shared/schema';

const KIND_CLASS: Record<string, string> = {
  added: 'bg-success/10 text-success',
  changed: 'bg-info/10 text-info',
  removed: 'bg-danger/10 text-danger',
  migration: 'bg-primary/10 text-primary',
  fixed: 'bg-warning/10 text-warning',
};

const LANG_LABEL: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TSX',
  sql: 'SQL',
  json: 'JSON',
  bash: 'Shell',
};

function CodeFigure({ title, label, code }: { title: string; label: string; code: string }) {
  return (
    <figure className="overflow-hidden rounded-xl bg-secondary/30 ring-1 ring-border/40">
      <figcaption className="flex items-center justify-between bg-secondary/60 px-3 py-1.5">
        <span className="text-xs font-medium text-foreground/80">{title}</span>
        <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">{label}</span>
      </figcaption>
      <pre className="overflow-x-auto px-3 py-3 text-[12px] leading-relaxed">
        <code className="font-mono text-foreground/85">{code}</code>
      </pre>
    </figure>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{children}</h2>
  );
}

export function ChangelogDetailPage() {
  const { slug = '' } = useParams();
  const [entry, setEntry] = useState<ChangelogEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getChangelogEntry(slug)
      .then((data) => {
        if (!cancelled) setEntry(data.entry);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load changelog entry.');
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (error) return <Alert variant="destructive">{error}</Alert>;

  if (!entry) {
    return (
      <div className="space-y-4">
        <Skeleton width="30%" height={12} />
        <Skeleton width="70%" height={28} />
        <Skeleton width="100%" height={120} />
      </div>
    );
  }

  const detail = entry.detail;

  return (
    <section className="flex flex-col gap-8">
      <header>
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          <Link to="/jobs" className="transition-colors hover:text-foreground">
            Jobs
          </Link>
          <ChevronRight size={12} className="opacity-40" />
          <span className="text-foreground/60">
            {entry.owner}/{entry.repo}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {entry.area}
          </span>
          {entry.headRef && (
            <span className="rounded bg-secondary/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground/70">
              {entry.headRef}
            </span>
          )}
          <span className="text-[11px] text-muted-foreground/70">{entry.date}</span>
        </div>

        <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground">{entry.title}</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{entry.summary}</p>

        {entry.prUrl && (
          <a
            href={entry.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            PR #{entry.prNumber}
            <ExternalLink size={13} className="opacity-60" />
          </a>
        )}
      </header>

      {detail && (
        <section className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl bg-card p-4 ring-1 ring-danger/20">
            <SectionHeading>The problem</SectionHeading>
            <p className="mt-1.5 text-sm leading-relaxed text-foreground/90">{detail.problem}</p>
          </div>
          <div className="rounded-xl bg-card p-4 ring-1 ring-success/20">
            <SectionHeading>The approach</SectionHeading>
            <p className="mt-1.5 text-sm leading-relaxed text-foreground/90">{detail.approach}</p>
          </div>
        </section>
      )}

      {entry.changes.length > 0 && (
        <section>
          <ul className="space-y-1.5">
            {entry.changes.map((change, index) => (
              <li key={index} className="flex items-start gap-2.5 text-sm">
                <span
                  className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                    KIND_CLASS[change.kind] ?? KIND_CLASS.changed
                  }`}
                >
                  {change.kind}
                </span>
                <span className="text-foreground/90">{change.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {detail && detail.apiChanges.length > 0 && (
        <section className="rounded-xl bg-card p-4 ring-1 ring-border/40">
          <SectionHeading>API &amp; MCP surface</SectionHeading>
          <ul className="mt-2 space-y-1.5">
            {detail.apiChanges.map((change, index) => (
              <li key={index} className="flex gap-2">
                <span className="text-info/60">▹</span>
                <code className="font-mono text-xs leading-relaxed text-foreground/85">{change}</code>
              </li>
            ))}
          </ul>
        </section>
      )}

      {detail && detail.diagrams.length > 0 && (
        <section>
          <SectionHeading>Diagrams</SectionHeading>
          <div className="mt-3 space-y-5">
            {detail.diagrams.map((diagram, index) => (
              <MermaidDiagram key={index} code={diagram.code} caption={diagram.caption} />
            ))}
          </div>
        </section>
      )}

      {detail && detail.migrations.length > 0 && (
        <section>
          <SectionHeading>Migrations</SectionHeading>
          <div className="mt-3 space-y-3">
            {detail.migrations.map((migration, index) => (
              <CodeFigure key={index} title={migration.tag} label="SQL" code={migration.sql} />
            ))}
          </div>
        </section>
      )}

      {detail && detail.code.length > 0 && (
        <section>
          <SectionHeading>Code</SectionHeading>
          <div className="mt-3 space-y-3">
            {detail.code.map((card, index) => (
              <CodeFigure key={index} title={card.title} label={LANG_LABEL[card.lang] ?? card.lang} code={card.code} />
            ))}
          </div>
        </section>
      )}

      {detail && detail.filesTouched.length > 0 && (
        <section>
          <SectionHeading>Files touched</SectionHeading>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {detail.filesTouched.map((file) => (
              <li key={file}>
                <code className="rounded bg-secondary/50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {file}
                </code>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
