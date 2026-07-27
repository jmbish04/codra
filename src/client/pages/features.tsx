import { useState, useEffect } from 'react';
import { api } from '@client/lib/api';
import { Button } from '@client/components/ui/button';
import { Alert } from '@client/components/ui/alert';
import { PageHeader } from '@client/components/layout/page-header';
import { Select } from '@client/components/ui/select';
import { Lightbulb, RefreshCw, Clock, CheckCircle, ArrowUp } from 'lucide-react';

export function FeaturesPage() {
  const [features, setFeatures] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const res = await api.getFeatures();
      setFeatures(res.features);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load features.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const updateStatus = async (id: number, status: 'open' | 'in_progress' | 'shipped') => {
    try {
      await api.updateFeatureStatus(id, { status });
      setFeatures(features.map((f) => (f.id === id ? { ...f, status } : f)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update status.');
    }
  };

  const upvote = async (id: number, currentVotes: number) => {
    try {
      const newVotes = currentVotes + 1;
      await api.updateFeatureStatus(id, { votes: newVotes });
      setFeatures(features.map((f) => (f.id === id ? { ...f, votes: newVotes } : f)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to upvote.');
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'open':
        return <Lightbulb className="h-4 w-4 text-warning" />;
      case 'in_progress':
        return <Clock className="h-4 w-4 text-info" />;
      case 'shipped':
        return <CheckCircle className="h-4 w-4 text-success" />;
      default:
        return null;
    }
  };

  return (
    <section className="page-enter flex flex-col gap-6">
      <PageHeader
        category="Feedback"
        title="Feature Requests"
        description={!loading && `${features.length} requested features`}
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
      ) : features.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
          <Lightbulb className="mb-4 h-12 w-12 text-muted-foreground/50" />
          <h3 className="text-lg font-medium text-foreground">No feature requests</h3>
          <p className="mt-1">Looks like we have everything we need for now.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {features.map((feature) => (
            <div key={feature.id} className="flex gap-4 rounded-lg border border-border bg-card p-4">
              <div className="flex flex-col items-center gap-1">
                <Button 
                  variant="outline" 
                  size="icon" 
                  className="h-10 w-10 flex-col gap-0 rounded-md"
                  onClick={() => upvote(feature.id, feature.votes)}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <span className="text-sm font-semibold text-muted-foreground">{feature.votes}</span>
              </div>
              <div className="flex flex-1 flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(feature.status)}
                    <h3 className="text-lg font-semibold">{feature.title}</h3>
                  </div>
                  <Select
                    value={feature.status}
                    onValueChange={(val: any) => updateStatus(feature.id, val)}
                    options={[
                      { label: 'Open', value: 'open' },
                      { label: 'In Progress', value: 'in_progress' },
                      { label: 'Shipped', value: 'shipped' },
                    ]}
                    className="w-[140px]"
                  />
                </div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{feature.description}</p>
                <div className="flex items-center gap-4 text-xs text-muted-foreground/70 mt-2">
                  <span>Reporter: {feature.reporter || 'Anonymous'}</span>
                  <span>Created: {new Date(feature.created_at).toLocaleString()}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
