import { useEffect, useState } from 'react';
import { api } from '@client/lib/api';
import { Skeleton } from '@client/components/skeleton';
import { EmptyState } from '@client/components/empty-state';
import { Button } from '@client/components/ui/button';
import { Alert } from '@client/components/ui/alert';
import { PageHeader } from '@client/components/page-header';
import { Switch } from '@client/components/ui/switch';
import { GitBranch, RefreshCw, Layers, Save, ListPlus, Trash2, ChevronDown, ArrowUpRight, RotateCcw } from 'lucide-react';
import { cn } from '@client/lib/utils';
import { defaultRepoConfig, type RepoConfigRecord } from '@shared/schema';
import { ModelChain, MODELS } from '@client/components/model-chain';

const SYSTEM_DEFAULTS = defaultRepoConfig.model;

// --- Main Components ---

interface RepoItemProps {
  repo: RepoConfigRecord;
  isExpanded: boolean;
  onToggle: () => void;
  onRefresh: () => void;
}

function RepoItem({ repo, isExpanded, onToggle, onRefresh }: RepoItemProps) {
  const [enabled, setEnabled] = useState(repo.enabled);
  const [mainModel, setMainModel] = useState(repo.mainModel ?? SYSTEM_DEFAULTS.main);
  const [fallbacks, setFallbacks] = useState<string[]>(repo.fallbackModels?.length ? repo.fallbackModels : SYSTEM_DEFAULTS.fallbacks);
  const [sizeOverrides, setSizeOverrides] = useState<any[]>(repo.sizeOverrides ?? SYSTEM_DEFAULTS.size_overrides);
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
          size_overrides: sizeOverrides.length > 0 ? sizeOverrides : undefined
        }
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
    
    // Immediate save to DB on reset ensures reliability
    setSaving(true);
    try {
      await api.updateRepoConfig(repo.owner, repo.repo, {
        enabled,
        model: SYSTEM_DEFAULTS
      });
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setSaving(false);
    }
  };

  const addOverride = () => {
    setSizeOverrides([...sizeOverrides, { 
      max_lines: 300, 
      model: MODELS[0].value, 
      fallbacks: [...SYSTEM_DEFAULTS.fallbacks] 
    }]);
  };

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

  const removeOverride = (index: number) => {
    setSizeOverrides(sizeOverrides.filter((_, i) => i !== index));
  };

  return (
    <div className={cn(
      "group/item relative bg-card border transition-all duration-300 rounded-2xl mb-4 overflow-hidden shadow-sm",
      isExpanded 
        ? "border-primary/30 ring-4 ring-primary/[0.03] shadow-lg" 
        : "border-border/50 hover:border-border hover:shadow-md"
    )}>
      {/* List Item Header */}
      <div 
        className={cn(
          "px-6 py-5 flex items-center justify-between cursor-pointer select-none",
          isExpanded ? "bg-primary/[0.01]" : "bg-transparent"
        )}
        onClick={onToggle}
      >
        <div className="flex items-center gap-5">
          <div className={cn(
            "w-10 h-10 flex items-center justify-center rounded-xl transition-all shadow-inner border",
            enabled ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600" : "bg-muted border-border/50 text-muted-foreground"
          )}>
            <GitBranch size={20} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold text-base text-foreground tracking-tight">{repo.owner} / {repo.repo}</h3>
              {repo.configMissing ? (
                 <span className="px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-600 text-[10px] font-bold uppercase tracking-wide border border-orange-500/20">Standard Defaults</span>
              ) : (
                 <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 text-[10px] font-bold uppercase tracking-wide border border-blue-500/20">Active Overrides</span>
              )}
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70 font-medium">
               <span>Last Activity: {repo.lastJobCreatedAt ? new Date(repo.lastJobCreatedAt).toLocaleDateString() : 'Never'}</span>
               <span className="w-1 h-1 rounded-full bg-muted-foreground/30"></span>
               <a>v1.2.0 Stable</a>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-8">
          <div className="flex items-center gap-3 pr-6 border-r border-border/20" onClick={e => e.stopPropagation()}>
             <span className={cn(
               "text-[10px] font-black uppercase tracking-wider transition-colors",
               enabled ? "text-primary/70" : "text-muted-foreground/30"
             )}>
               Review Engine
             </span>
             <Switch 
               checked={enabled} 
               onCheckedChange={setEnabled}
             />
          </div>
          
          <ChevronDown 
            size={20} 
            className={cn("text-muted-foreground/60 transition-transform duration-500", isExpanded && "rotate-180")} 
          />
        </div>
      </div>

      {/* Configuration Panel */}
      {isExpanded && (
        <div className="px-10 py-10 bg-background border-t border-border/50 animate-in fade-in slide-in-from-top-4 duration-500">
           {error && <Alert variant="destructive" className="mb-8">{error}</Alert>}
           
           <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-12">
              <div className="space-y-16">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold tracking-tight text-foreground flex items-center gap-2">
                      <Layers size={14} className="text-primary" /> Logic & Scaling Rules
                    </h4>
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
                      <span>Baseline tiers can be customized globally in</span>
                      <a href="/settings" className="text-primary font-bold hover:underline flex items-center gap-0.5">
                        Settings <ArrowUpRight size={10} />
                      </a>
                    </div>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={addOverride}
                    className="h-8 text-[10px] font-black uppercase tracking-widest gap-2 bg-background shadow-sm rounded-xl"
                  >
                    <ListPlus size={14} /> Add Scaling Rule
                  </Button>
                </div>

                <div className="space-y-8">
                  {/* Baseline Tier Wrapper */}
                  <div className="relative p-8 rounded-2xl border border-primary/20 bg-primary/[0.01] transition-shadow hover:shadow-md">
                    {/* Dynamic Baseline Label */}
                    <div className="absolute -top-3 left-6 px-3 py-0.5 bg-background border border-primary/20 rounded-full shadow-sm flex items-center gap-1.5">
                      <span className="text-[9px] font-black uppercase tracking-widest text-primary">
                        Baseline Tier
                      </span>
                      {sizeOverrides.length > 0 && (
                        <span className="text-[9px] font-bold text-muted-foreground/40 border-l border-border/20 pl-1.5 ml-0.5">
                          &gt; {Math.max(...sizeOverrides.map(o => o.max_lines))} Lines
                        </span>
                      )}
                    </div>
                    <ModelChain 
                      primary={mainModel} 
                      fallbacks={fallbacks} 
                      onChange={(p, fbs) => { setMainModel(p); setFallbacks(fbs); }} 
                    />
                  </div>

                  {/* Specific Overrides (Thresholds) */}
                  {sizeOverrides.map((ov, i) => (
                    <div key={i} className="relative p-8 rounded-2xl border border-border bg-muted/5 transition-all hover:bg-muted/[0.08]">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => removeOverride(i)}
                        className="absolute top-4 right-4 h-8 w-8 text-muted-foreground/30 hover:text-red-500"
                      >
                        <Trash2 size={16} />
                      </Button>

                      <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-10">
                         <div className="space-y-3">
                            <label className="text-[10px] font-black uppercase text-muted-foreground/70 tracking-wider">Complexity Threshold</label>
                            <div className="flex items-center gap-3 p-1 pl-3 bg-background border border-border rounded-lg focus-within:ring-2 focus-within:ring-primary/10 transition-shadow">
                               <input 
                                type="number" 
                                value={ov.max_lines} 
                                onChange={(e) => updateOverrideThreshold(i, parseInt(e.target.value))}
                                className="w-full bg-transparent border-0 py-1.5 text-sm font-bold focus:ring-0 outline-none"
                              />
                              <span className="text-[10px] font-bold text-muted-foreground/60 pr-3 uppercase">Lines</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground/60 italic leading-relaxed">
                              Applies to files with up to {ov.max_lines} lines of code.
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
              </div>

              {/* Action Sidebar */}
              <div className="space-y-10">
                 <div className="space-y-6 pt-2">
                    <Button 
                      onClick={() => handleSave()} 
                      disabled={saving} 
                      className="w-full h-12 gap-3 rounded-2xl shadow-xl shadow-primary/10"
                    >
                      {saving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />}
                      <span className="font-bold">Apply Changes</span>
                    </Button>

                    <Button 
                      variant="ghost"
                      onClick={handleReset}
                      className="w-full h-11 gap-3 rounded-2xl text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 border border-transparent hover:border-border/50 transition-all font-bold text-sm"
                    >
                      <RotateCcw size={16} />
                      Reset to Default
                    </Button>
                 </div>

                 <div className="space-y-2 pt-6 border-t border-border/10">
                    <a 
                      href={`https://github.com/${repo.owner}/${repo.repo}`} 
                      target="_blank" 
                      className="flex items-center justify-between p-4 rounded-2xl bg-muted/30 hover:bg-muted/60 text-[13px] font-bold text-foreground/80 transition-all group"
                    >
                      GitHub Project 
                      <ArrowUpRight size={16} className="text-muted-foreground/40 group-hover:text-primary transition-colors" />
                    </a>
                 </div>
              </div>
           </div>
        </div>
      )}
    </div>
  );
}

export function ReposPage() {
  const [repos, setRepos] = useState<RepoConfigRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadRepos = (expandedRepoId?: string) => {
    setLoading(true);
    api.getRepos()
      .then((res) => {
        setRepos(res.repos);
        if (expandedRepoId) {
          setExpandedId(expandedRepoId);
        } else if (res.repos.length > 0 && !expandedId) {
          setExpandedId(`${res.repos[0].owner}/${res.repos[0].repo}`);
        }
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

  if (loading && repos.length === 0) {
    return (
      <div className="flex flex-col gap-6 p-10 animate-pulse">
        <Skeleton width="480px" height="56px" className="mb-12 rounded-2xl" />
        <div className="space-y-6">
          <Skeleton height="96px" className="rounded-2xl" />
          <Skeleton height="96px" className="rounded-2xl" />
          <Skeleton height="96px" className="rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="page-enter flex flex-col gap-12 pb-32 max-w-6xl mx-auto w-full">
      <PageHeader
        category="Operations"
        title="Project Fleet"
        description="Configure automated intelligence scaling across your repository ecosystem"
        actions={
          <div className="flex items-center gap-4">
             <Button onClick={handleSync} disabled={syncing} variant="outline" className="h-11 gap-2 px-6 rounded-2xl border-border/80 shadow-sm bg-background font-bold text-sm">
              <RefreshCw size={18} className={cn(syncing && 'animate-spin')} />
              Refresh Projects
            </Button>
            <Button asChild className="h-11 gap-2 px-6 rounded-2xl bg-primary text-primary-foreground hover:bg-primary/90 shadow-xl shadow-primary/20 font-bold text-sm">
              <a href="https://github.com/apps/codra-app/installations/new" target="_blank" rel="noopener noreferrer">
                Manage Access
              </a>
            </Button>
          </div>
        }
      />

      {error && <Alert variant="destructive" className="rounded-3xl border-red-500/20 bg-red-500/[0.01] text-red-600 mb-6">{error}</Alert>}

      <div className="flex flex-col">
        {repos.length === 0 ? (
          <div className="surface border border-dashed border-border/50 bg-background/50 flex flex-col items-center justify-center py-48 rounded-[4rem]">
            <EmptyState
              icon={<GitBranch size={80} className="text-muted-foreground/10 mb-8" />}
              title="Empty Fleet"
              description="No repositories are currently connected to Codra. Sync your GitHub projects to begin."
              className="border-0 bg-transparent max-w-lg text-center"
            />
          </div>
        ) : (
          repos.map((repo) => {
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
          })
        )}
      </div>
    </div>
  );
}

