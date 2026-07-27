import { useState, useEffect } from 'react';
import { api } from '@client/lib/api';
import { Button } from '@client/components/ui/button';
import { Alert } from '@client/components/ui/alert';
import { PageHeader } from '@client/components/layout/page-header';
import { Select } from '@client/components/ui/select';
import { Bug, RefreshCw, AlertTriangle, CheckCircle, Clock } from 'lucide-react';

export function BugsPage() {
  const [bugs, setBugs] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const res = await api.getBugs();
      setBugs(res.bugs);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load bugs.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const updateStatus = async (id: number, status: 'open' | 'in_progress' | 'resolved') => {
    try {
      await api.updateBugStatus(id, status);
      setBugs(bugs.map((b) => (b.id === id ? { ...b, status } : b)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update status.');
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'open':
        return <AlertTriangle className="h-4 w-4 text-warning" />;
      case 'in_progress':
        return <Clock className="h-4 w-4 text-info" />;
      case 'resolved':
        return <CheckCircle className="h-4 w-4 text-success" />;
      default:
        return null;
    }
  };

  return (
    <section className="page-enter flex flex-col gap-6">
      <PageHeader
        category="Feedback"
        title="Bugs"
        description={!loading && `${bugs.length} reported bugs`}
        actions={
          <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        }
      />

      {error && (
        <Alert variant="destructive" title="Error">
          {error}
        </Alert>
      )}

      {loading ? (
        <div className="flex justify-center p-8 text-muted-foreground">
          <RefreshCw className="h-6 w-6 animate-spin" />
        </div>
      ) : bugs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
          <Bug className="mb-4 h-12 w-12 text-muted-foreground/50" />
          <h3 className="text-lg font-medium text-foreground">No bugs reported</h3>
          <p className="mt-1">Everything seems to be running smoothly.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {bugs.map((bug) => (
            <div key={bug.id} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {getStatusIcon(bug.status)}
                  <h3 className="text-lg font-semibold">{bug.title}</h3>
                </div>
                <Select
                  value={bug.status}
                  onValueChange={(val: any) => updateStatus(bug.id, val)}
                  options={[
                    { label: 'Open', value: 'open' },
                    { label: 'In Progress', value: 'in_progress' },
                    { label: 'Resolved', value: 'resolved' },
                  ]}
                  className="w-[140px]"
                />
              </div>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{bug.description}</p>
              <div className="flex items-center gap-4 text-xs text-muted-foreground/70 mt-2">
                <span>Reporter: {bug.reporter || 'Anonymous'}</span>
                <span>Created: {new Date(bug.created_at).toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
