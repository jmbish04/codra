import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type PlanningPackage, type PlanningStatus } from '@client/lib/api';
import { PageHeader } from '@client/components/layout/page-header';
import { Badge, type BadgeProps } from '@client/components/ui/badge';
import { Button } from '@client/components/ui/button';
import { Alert } from '@client/components/ui/alert';
import { EmptyState } from '@client/components/shared/empty-state';
import { formatDateTime } from '@client/lib/format';
import { Plus, FileText } from 'lucide-react';

const FILTERS: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Drafts' },
  { key: 'planning', label: 'Planning' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'pr_submitted', label: 'PR submitted' },
  { key: 'merged', label: 'Merged' },
];

/**
 * statusTone
 */
function statusTone(s: PlanningStatus): NonNullable<BadgeProps['variant']> {
  switch (s) {
    case 'merged': case 'in_progress': return 'success';
    case 'pr_submitted': return 'info';
    case 'rejected': return 'danger';
    case 'draft': return 'neutral';
    default: return 'info';
  }
}

/**
 * PlanningListPage
 */
export function PlanningListPage() {
  const [packages, setPackages] = useState<PlanningPackage[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    api.listPlanningPackages(filter === 'all' ? {} : { status: filter as PlanningStatus })
      .then((r) => { if (live) { setPackages(r.packages); setError(null); } })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : 'Failed to load plans.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [filter]);

  // Group by repo, each group newest-first (list already comes created_at DESC).
  const groups = useMemo(() => {
    const map = new Map<string, PlanningPackage[]>();
    for (const p of packages) {
      const key = p.repository ?? `repo ${p.repository_id}`;
      (map.get(key) ?? map.set(key, []).get(key)!).push(p);
    }
    return [...map.entries()];
  }, [packages]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        category="Planning"
        title="Planning packages"
        description="Feature plans by repo, newest first. Each package holds immutable revisions and a live task board."
        actions={<Button asChild className="gap-1.5"><Link to="/planning/new"><Plus className="h-4 w-4" />New</Link></Button>}
      />

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${filter === f.key ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <Alert variant="destructive">{error}</Alert>}

      {!loading && packages.length === 0 && (
        <EmptyState icon={<FileText className="h-6 w-6" />} title="No planning packages" description="Start a feature request and Jules will draft an informed plan." />
      )}

      {groups.map(([repo, pkgs]) => (
        <section key={repo} className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{repo}</h3>
          <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {pkgs.map((p) => (
              <Link key={p.id} to={`/planning/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{p.title}</div>
                  <div className="text-xs text-muted-foreground">{formatDateTime(p.created_at)}{p.created_by ? ` · ${p.created_by}` : ''}</div>
                </div>
                <Badge variant={statusTone(p.status)}>{p.status.replace(/_/g, ' ')}</Badge>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
