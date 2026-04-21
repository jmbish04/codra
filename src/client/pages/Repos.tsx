import { useEffect, useState } from 'react';
import { api } from '@client/lib/api';
import { Skeleton } from '@client/components/skeleton';
import { EmptyState } from '@client/components/empty-state';
import { Button } from '@client/components/ui/button';
import { Alert } from '@client/components/ui/alert';
import { PageHeader } from '@client/components/page-header';
import { Switch } from '@client/components/ui/switch';
import {
  GitBranch, RefreshCw, Layers, Save, ListPlus, Trash2,
  ChevronDown, ArrowUpRight, RotateCcw, ExternalLink,
} from 'lucide-react';
import { cn } from '@client/lib/utils';
import { defaultRepoConfig, type RepoConfigRecord } from '@shared/schema';
import { ModelChain, MODELS } from '@client/components/model-chain';

const SYSTEM_DEFAULTS = defaultRepoConfig.model;

// ─── RepoItem ─────────────────────────────────────────────────────────────
interface RepoItemProps {
  repo: RepoConfigRecord;
  isExpanded: boolean;
  onToggle: () => void;
  onRefresh: () => void;
}

function RepoItem({ repo, isExpanded, onToggle, onRefresh }: RepoItemProps) {
  const [enabled, setEnabled] = useState(repo.enabled);
  const [mainModel, setMainModel] = useState(repo.mainModel ?? SYSTEM_DEFAULTS.main);
  const [fallbacks, setFallbacks] = useState<string[]>(
    repo.fallbackModels?.length ? repo.fallbackModels : SYSTEM_DEFAULTS.fallbacks,
  );
  const [sizeOverrides, setSizeOverrides] = useState<any[]>(
    repo.sizeOverrides ?? SYSTEM_DEFAULTS.size_overrides,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSaving(true);
    setError(null);
    try {
      await api.updateRepoConfig(repo.owner, repo.repo, {
        enabled,
        model: {
          main: mainModel,
          fallbacks: fallbacks.length > 0 ? fallbacks : [],
          size_overrides: sizeOverrides.length > 0 ? sizeOverrides : undefined,
        },
      });
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setMainModel(SYSTEM_DEFAULTS.main);
    setFallbacks(SYSTEM_DEFAULTS.fallbacks);
    setSizeOverrides(SYSTEM_DEFAULTS.size_overrides ?? []);
    setSaving(true);
    try {
      await api.updateRepoConfig(repo.owner, repo.repo, {
        enabled,
        model: SYSTEM_DEFAULTS,
      });
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setSaving(false);
    }
  };

  const addOverride = () =>
    setSizeOverrides([
      ...sizeOverrides,
      { max_lines: 300, model: MODELS[0].value, fallbacks: [...SYSTEM_DEFAULTS.fallbacks] },
    ]);

  const updateOverride = (index: number, primary: string, fbs: string[]) => {
    const next = [...sizeOverrides];
    next[index] = { ...next[index], model: primary, fallbacks: fbs };
    setSizeOverrides(next);
  };

  const updateOverrideThreshold = (index: number, threshold: number) => {
    const next = [...sizeOverrides];
    next[index] = { ...next[index], max_lines: threshold };
    setSizeOverrides(next);
  };

  const removeOverride = (index: number) =>
    setSizeOverrides(sizeOverrides.filter((_, i) => i !== index));

  return (
    <div
      className={cn(
        'surface overflow-hidden transition-all duration-200',
        isExpanded && 'border-primary/30 shadow-md shadow-primary/5',
      )}
    >
      {/* ── Row header ───────────────────────────────── */}
      <div
        className={cn(
          'flex items-center gap-4 px-5 py-4 cursor-pointer select-none transition-colors',
          isExpanded ? 'bg-primary/[0.02]' : 'hover:bg-muted/30',
        )}
        onClick={onToggle}
      >
        {/* Status dot */}
        <div
          className={cn(
            'shrink-0 w-2 h-2 rounded-full',
            enabled ? 'bg-success' : 'bg-muted-foreground/30',
          )}
        />

        {/* Repo name + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 mb-0.5">
            <span className="text-sm font-semibold text-foreground tracking-tight">
              {repo.owner}/{repo.repo}
            </span>
            {repo.configMissing ? (
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-muted text-muted-foreground border border-border">
                Defaults
              </span>
            ) : (
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-primary/10 text-primary border border-primary/20">
                Overrides
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground/60 font-mono">
            Last activity:{' '}
            {repo.lastJobCreatedAt
              ? new Date(repo.lastJobCreatedAt).toLocaleDateString()
              : 'Never'}
          </p>
        </div>

        {/* Toggle */}
        <div className="flex items-center gap-2.5 pr-5 border-r border-border/40" onClick={e => e.stopPropagation()}>
          <span className={cn(
            'text-[10px] font-bold uppercase tracking-widest transition-colors',
            enabled ? 'text-success' : 'text-muted-foreground/40',
          )}>
            {enabled ? 'On' : 'Off'}
          </span>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <ChevronDown
          size={15}
          className={cn(
            'shrink-0 text-muted-foreground/40 transition-transform duration-300',
            isExpanded && 'rotate-180',
          )}
        />
      </div>

      {/* ── Expanded config panel ─────────────────────── */}
      {isExpanded && (
        <div className="border-t border-border/50 animate-in fade-in slide-in-from-top-2 duration-200">
          {error && (
            <div className="px-5 pt-4">
              <Alert variant="destructive">{error}</Alert>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_200px] divide-y lg:divide-y-0 lg:divide-x divide-border/50">
            {/* ── Left: Model chains ── */}
            <div className="px-5 py-5 space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers size={13} strokeWidth={1.75} className="text-primary" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Intelligence Scaling
                  </span>
                  <a
                    href="/settings"
                    className="text-[10px] font-semibold text-primary/60 hover:text-primary flex items-center gap-0.5 transition-colors"
                    onClick={e => e.stopPropagation()}
                  >
                    Global defaults <ArrowUpRight size={9} />
                  </a>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addOverride}
                  className="h-7 text-[10px] font-semibold gap-1.5"
                >
                  <ListPlus size={12} />
                  Add Tier
                </Button>
              </div>

              {/* Baseline */}
              <div className="relative border border-primary/20 rounded-md px-4 py-4 bg-primary/[0.01]">
                <span className="absolute -top-2.5 left-3 bg-card px-2 text-[9px] font-bold uppercase tracking-widest text-primary border border-primary/20 rounded">
                  Baseline{sizeOverrides.length > 0 && ` · >${Math.max(...sizeOverrides.map(o => o.max_lines))} lines`}
                </span>
                <ModelChain
                  primary={mainModel}
                  fallbacks={fallbacks}
                  onChange={(p, fbs) => { setMainModel(p); setFallbacks(fbs); }}
                />
              </div>

              {/* Per-size overrides */}
              {sizeOverrides.map((ov, i) => (
                <div key={i} className="relative border border-border rounded-md px-4 py-4 bg-muted/5">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeOverride(i)}
                    className="absolute top-2 right-2 h-7 w-7 text-muted-foreground/30 hover:text-danger hover:bg-danger/5"
                  >
                    <Trash2 size={13} />
                  </Button>

                  <div className="grid grid-cols-1 md:grid-cols-[160px_1fr] gap-6">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Max Lines
                      </label>
                      <div className="flex items-center gap-2 h-9 px-3 bg-background border border-border rounded-md focus-within:ring-1 focus-within:ring-ring">
                        <input
                          type="number"
                          value={ov.max_lines}
                          onChange={e => updateOverrideThreshold(i, parseInt(e.target.value))}
                          className="flex-1 bg-transparent text-sm font-semibold outline-none"
                        />
                        <span className="text-[10px] text-muted-foreground/50 font-mono shrink-0">loc</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground/50 leading-relaxed">
                        Files up to {ov.max_lines} lines.
                      </p>
                    </div>
                    <ModelChain
                      primary={ov.model}
                      fallbacks={ov.fallbacks || []}
                      onChange={(p, fbs) => updateOverride(i, p, fbs)}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* ── Right: Actions ── */}
            <div className="px-5 py-5 flex flex-col gap-3">
              <Button
                onClick={() => handleSave()}
                disabled={saving}
                className="w-full gap-2"
              >
                {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                Apply Changes
              </Button>

              <Button
                variant="ghost"
                onClick={handleReset}
                disabled={saving}
                className="w-full gap-2 text-muted-foreground hover:text-foreground"
              >
                <RotateCcw size={13} />
                Reset to Defaults
              </Button>

              <div className="mt-auto pt-4 border-t border-border/40">
                <a
                  href={`https://github.com/${repo.owner}/${repo.repo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors group"
                >
                  <span className="font-medium">View on GitHub</span>
                  <ExternalLink size={12} className="text-muted-foreground/40 group-hover:text-primary transition-colors" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ReposPage ────────────────────────────────────────────────────────────
export function ReposPage() {
  const [repos, setRepos] = useState<RepoConfigRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadRepos = (expandedRepoId?: string) => {
    setLoading(true);
    api
      .getRepos()
      .then(res => {
        setRepos(res.repos);
        if (expandedRepoId) {
          setExpandedId(expandedRepoId);
        } else if (res.repos.length > 0 && !expandedId) {
          setExpandedId(`${res.repos[0].owner}/${res.repos[0].repo}`);
        }
        setLoading(false);
      })
      .catch(e => {
        setError(e instanceof Error ? e.message : 'Failed to load repositories.');
        setLoading(false);
      });
  };

  useEffect(() => { loadRepos(); }, []);

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setError(null);
    try {
      await api.syncRepos();
      loadRepos();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  if (loading && repos.length === 0) {
    return (
      <section className="page-enter flex flex-col gap-6">
        <PageHeader category="Configuration" title="Repositories" />
        <div className="surface overflow-hidden">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="px-5 py-4 border-b border-border/50 last:border-0">
              <Skeleton height={20} />
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="page-enter flex flex-col gap-6">
      <PageHeader
        category="Configuration"
        title="Repositories"
        description={!loading && `${repos.length} ${repos.length === 1 ? 'repository' : 'repositories'} connected`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSync}
              disabled={syncing}
              className="gap-2"
            >
              <RefreshCw size={13} className={cn(syncing && 'animate-spin')} />
              Sync
            </Button>
            <Button asChild size="sm" className="gap-2">
              <a
                href="https://github.com/apps/codra-app/installations/new"
                target="_blank"
                rel="noopener noreferrer"
              >
                <ArrowUpRight size={13} />
                Manage Access
              </a>
            </Button>
          </div>
        }
      />

      {error && <Alert variant="destructive">{error}</Alert>}

      {repos.length === 0 ? (
        <EmptyState
          icon={<GitBranch />}
          title="No repositories connected"
          description="Sync your GitHub App installation to import repositories."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {repos.map(repo => {
            const id = `${repo.owner}/${repo.repo}`;
            return (
              <RepoItem
                key={id}
                repo={repo}
                isExpanded={expandedId === id}
                onToggle={() => setExpandedId(expandedId === id ? null : id)}
                onRefresh={() => loadRepos(id)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
