import { useEffect, useState } from 'react';
import { api } from '@client/lib/api';
import { Skeleton } from '@client/components/Skeleton';
import { EmptyState } from '@client/components/EmptyState';
import { Button } from '@client/components/ui/button';
import { REPO_CONFIG_FILENAME } from '@shared/config';
import { GitBranch, Settings, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@client/lib/utils';
import type { RepoConfigRecord } from '@shared/schema';

export function ReposPage() {
  const [repos, setRepos]       = useState<RepoConfigRecord[]>([]);
  const [selected, setSelected] = useState<RepoConfigRecord | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [syncing, setSyncing]   = useState(false);
  const [loading, setLoading]   = useState(true);

  const loadRepos = () => {
    api.getRepos()
      .then((res) => {
        setRepos(res.repos);
        if (!selected && res.repos.length > 0) setSelected(res.repos[0]);
        setLoading(false);
      })
      .catch((e) => {
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

  return (
    <section className="page-enter flex flex-col gap-6">

      {/* Header */}
      <header className="flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary/70 mb-1">
            Configuration
          </p>
          <h1
            className="text-2xl font-bold text-foreground"
            style={{ letterSpacing: '-0.025em' }}
          >
            Repositories
          </h1>
          {!loading && (
            <p className="mt-1 text-sm text-muted-foreground">
              {repos.length} {repos.length === 1 ? 'repository' : 'repositories'} linked
            </p>
          )}
        </div>
        <Button
          id="sync-repos-btn"
          onClick={handleSync}
          disabled={syncing}
          variant="outline"
          size="sm"
          className="gap-2"
        >
          <RefreshCw size={13} className={cn(syncing && 'animate-spin')} />
          {syncing ? 'Syncing…' : 'Sync'}
        </Button>
      </header>

      {error && (
        <div
          className="rounded-md border px-4 py-3 text-sm"
          style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-border)', color: 'var(--danger)' }}
        >
          {error}
        </div>
      )}

      <div className="grid grid-cols-[210px_1fr] gap-5 items-start">

        {/* ── Repo list ── */}
        <div className="surface overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <GitBranch size={13} className="text-muted-foreground" strokeWidth={1.75} />
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Installed
            </span>
          </div>
          <div className="flex flex-col p-2">
            {loading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="px-3 py-2.5 space-y-1.5">
                    <Skeleton width="65%" height="0.875rem" />
                    <Skeleton width="40%" height="0.7rem" />
                  </div>
                ))
              : repos.length === 0
              ? (
                <div className="flex flex-col items-center gap-3 py-10 text-center px-4">
                  <GitBranch size={28} className="text-muted-foreground opacity-25" />
                  <p className="text-xs text-muted-foreground">No repositories found</p>
                </div>
              )
              : repos.map((repo) => {
                  const isActive =
                    selected?.owner === repo.owner && selected?.repo === repo.repo;
                  return (
                    <button
                      key={`${repo.owner}/${repo.repo}`}
                      id={`repo-${repo.owner}-${repo.repo}`}
                      type="button"
                      onClick={() => setSelected(repo)}
                      className={cn(
                        'group w-full rounded-md px-3 py-2 text-left transition-all duration-150',
                        isActive
                          ? 'bg-primary/10 text-primary'
                          : 'hover:bg-secondary text-foreground',
                      )}
                    >
                      <div className="font-semibold text-sm leading-snug truncate">
                        {repo.owner}/{repo.repo}
                      </div>
                      <div className={cn(
                        'mt-0.5 text-[10px] flex items-center gap-1',
                        isActive ? 'text-primary/60' : 'text-muted-foreground',
                      )}>
                        {repo.configMissing
                          ? <><AlertCircle size={9} className="shrink-0" /> Defaults only</>
                          : <><CheckCircle2 size={9} className="shrink-0" /> Custom config</>
                        }
                      </div>
                    </button>
                  );
                })}
          </div>
        </div>

        {/* ── Config detail ── */}
        <div className="surface overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-4">
              <Skeleton width="45%" height="1.25rem" />
              <Skeleton height="140px" />
              <Skeleton width="30%" height="0.875rem" />
              <Skeleton height="120px" />
            </div>
          ) : selected ? (
            <>
              {/* Header bar */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h2 className="font-semibold text-foreground text-sm">
                  {selected.owner}/{selected.repo}
                </h2>
                <span
                  className="flex items-center gap-1.5 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide border"
                  style={selected.configMissing
                    ? { background: 'var(--warning-bg)', color: 'var(--warning)', borderColor: 'var(--warning-border)' }
                    : { background: 'var(--success-bg)', color: 'var(--success)', borderColor: 'var(--success-border)' }
                  }
                >
                  {selected.configMissing
                    ? <><AlertCircle size={10} /> Defaults</>
                    : <><CheckCircle2 size={10} /> Custom</>
                  }
                </span>
              </div>

              <div className="flex flex-col gap-5 p-5">
                <div>
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {REPO_CONFIG_FILENAME}
                  </p>
                  <pre className="code-block text-xs max-h-60 overflow-auto">
                    {selected.rawYaml
                      ?? `# ${REPO_CONFIG_FILENAME} not found\n${JSON.stringify(selected.parsedJson, null, 2)}`}
                  </pre>
                </div>

                <div>
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Resolved config
                  </p>
                  <pre className="code-block text-xs max-h-60 overflow-auto">
                    {JSON.stringify(selected.parsedJson, null, 2)}
                  </pre>
                </div>
              </div>
            </>
          ) : (
            <EmptyState
              icon={<Settings />}
              title="Select a repository"
              description="Choose a repository from the list to inspect its configuration."
              className="border-0"
            />
          )}
        </div>
      </div>
    </section>
  );
}
