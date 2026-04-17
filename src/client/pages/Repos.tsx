import { useEffect, useState } from 'react';
import { api } from '@client/lib/api';
import { Skeleton } from '@client/components/skeleton';
import { EmptyState } from '@client/components/empty-state';
import { Button } from '@client/components/ui/button';
import { Alert } from '@client/components/ui/alert';
import { PageHeader } from '@client/components/page-header';
import { Switch } from '@client/components/ui/switch';
import { REPO_CONFIG_FILENAME } from '@shared/config';
import { GitBranch, Settings, RefreshCw, CheckCircle2, AlertCircle, Cpu, Layers, HardDrive, Save, ChevronRight, ListPlus, Trash2, ShieldCheck, Play, Pause, ChevronDown, ExternalLink } from 'lucide-react';
import { cn } from '@client/lib/utils';
import type { RepoConfigRecord } from '@shared/schema';

const AVAILABLE_MODELS = [
  'gemma-4-31b-it',
  'gemma-3-27b',
  'gemini-2.5-flash',
  'gemini-3-flash',
  '@cf/zai-org/glm-4.7-flash',
  '@cf/moonshotai/kimi-k2.5'
];

interface RepoItemProps {
  repo: RepoConfigRecord;
  isExpanded: boolean;
  onToggle: () => void;
  onRefresh: () => void;
}

function RepoItem({ repo, isExpanded, onToggle, onRefresh }: RepoItemProps) {
  const [enabled, setEnabled] = useState(repo.enabled);
  const [mainModel, setMainModel] = useState(repo.mainModel ?? 'gemma-4-31b-it');
  const [fallbacks, setFallbacks] = useState<string[]>(repo.fallbackModels ?? []);
  const [sizeOverrides, setSizeOverrides] = useState<any[]>(repo.sizeOverrides ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
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

  const addFallback = () => setFallbacks([...fallbacks, AVAILABLE_MODELS[0]]);
  const updateFallback = (idx: number, val: string) => {
    const next = [...fallbacks];
    next[idx] = val;
    setFallbacks(next);
  };
  const removeFallback = (idx: number) => setFallbacks(fallbacks.filter((_, i) => i !== idx));

  const addOverride = () => {
    setSizeOverrides([...sizeOverrides, { max_lines: 500, model: AVAILABLE_MODELS[0], fallbacks: [] }]);
  };

  const updateOverride = (index: number, field: string, value: any) => {
    const next = [...sizeOverrides];
    next[index] = { ...next[index], [field]: value };
    setSizeOverrides(next);
  };

  const removeOverride = (index: number) => {
    setSizeOverrides(sizeOverrides.filter((_, i) => i !== index));
  };

  const addOverrideFallback = (index: number) => {
    const next = [...sizeOverrides];
    next[index].fallbacks = [...(next[index].fallbacks || []), AVAILABLE_MODELS[0]];
    setSizeOverrides(next);
  };

  const updateOverrideFallback = (ovIdx: number, fbIdx: number, val: string) => {
    const next = [...sizeOverrides];
    next[ovIdx].fallbacks[fbIdx] = val;
    setSizeOverrides(next);
  };

  const removeOverrideFallback = (ovIdx: number, fbIdx: number) => {
    const next = [...sizeOverrides];
    next[ovIdx].fallbacks = next[ovIdx].fallbacks.filter((_: any, i: number) => i !== fbIdx);
    setSizeOverrides(next);
  };

  return (
    <div className={cn(
      "surface transition-all duration-300 border mb-4 overflow-hidden",
      isExpanded 
        ? "border-primary/40 shadow-xl shadow-primary/5 ring-1 ring-primary/10" 
        : "border-border/40 hover:border-border/100 hover:shadow-md"
    )}>
      {/* Collapsed Header */}
      <div 
        className={cn(
          "px-6 py-4 flex items-center justify-between cursor-pointer select-none group",
          isExpanded ? "bg-primary/5" : "bg-background"
        )}
        onClick={onToggle}
      >
        <div className="flex items-center gap-4">
          <div className={cn(
            "p-2 rounded-lg transition-colors",
            enabled ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground"
          )}>
            <GitBranch size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm tracking-tight">{repo.owner} / {repo.repo}</h3>
              <div className="flex items-center gap-1.5">
                {repo.configMissing ? (
                   <span className="text-[8px] font-black uppercase tracking-widest bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded border border-amber-500/20 font-bold">Default Config</span>
                ) : (
                   <span className="text-[8px] font-black uppercase tracking-widest bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5 rounded border border-emerald-500/20 font-bold">Custom Config</span>
                )}
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5 font-medium">
              Last review: {repo.lastJobCreatedAt ? new Date(repo.lastJobCreatedAt).toLocaleDateString() : 'Never'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3 px-4 py-1.5 border-x border-border/20" onClick={e => e.stopPropagation()}>
             <span className={cn(
               "text-[9px] font-black uppercase tracking-widest transition-colors",
               enabled ? "text-primary/70" : "text-muted-foreground/40"
             )}>
               Status
             </span>
             <Switch 
               checked={enabled} 
               onCheckedChange={setEnabled}
             />
          </div>
          
          <ChevronDown 
            size={18} 
            className={cn("text-muted-foreground transition-transform duration-300", isExpanded && "rotate-180")} 
          />
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="p-8 bg-background border-t border-border/20 animate-in slide-in-from-top-2 duration-300">
           {error && <Alert variant="destructive" className="mb-6">{error}</Alert>}
           
           <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-10">
              <div className="space-y-8">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h4 className="text-xs font-black uppercase tracking-widest text-foreground flex items-center gap-2">
                      <Layers size={14} className="text-primary" /> Configuration Rules
                    </h4>
                    <p className="text-[11px] text-muted-foreground">Define volume scaling and fallback sequences</p>
                  </div>
                  <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1.5 px-3 border-secondary/30 text-secondary hover:bg-secondary/5" onClick={addOverride}>
                    <ListPlus size={12} /> Add Scale Tier
                  </Button>
                </div>

                <div className="space-y-6">
                  {/* Baseline Configuration */}
                  <div className="surface p-6 border-2 border-primary/20 bg-primary/5 relative">
                    <div className="absolute -top-2.5 left-4 px-2 bg-background border border-primary/20 rounded text-[9px] font-black uppercase tracking-widest text-primary">
                      Baseline Configuration
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-8">
                       <div className="space-y-2">
                          <label className="text-[9px] font-black uppercase text-muted-foreground/70">PR Size</label>
                          <div className="text-xs font-bold text-muted-foreground bg-muted/40 p-2 rounded-lg border border-border/20">
                            Catch-all / Default
                          </div>
                          <p className="text-[9px] text-muted-foreground leading-relaxed italic mt-1">
                            This configuration applies if no other scaling rules match the PR complexity.
                          </p>
                       </div>

                       <div className="space-y-5">
                          <div className="space-y-2">
                            <label className="text-[9px] font-black uppercase text-primary/80">Primary Model</label>
                            <select 
                              value={mainModel} 
                              onChange={(e) => setMainModel(e.target.value)}
                              className="w-full bg-background border border-border/60 rounded-lg px-3 py-2 text-xs font-semibold focus:ring-2 focus:ring-primary/20 outline-none"
                            >
                              {AVAILABLE_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                          </div>

                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <label className="text-[9px] font-black uppercase text-amber-500/80">Fallback Chain</label>
                              <button onClick={addFallback} className="text-[9px] font-bold text-primary hover:underline flex items-center gap-1">
                                <ListPlus size={10} /> Add Fallback
                              </button>
                            </div>
                            <div className="space-y-2">
                              {fallbacks.map((fb, fbIdx) => (
                                <div key={fbIdx} className="flex items-center gap-2">
                                  <div className="w-1 h-1 rounded-full bg-amber-500/40"></div>
                                  <select 
                                    value={fb} 
                                    onChange={(e) => updateFallback(fbIdx, e.target.value)}
                                    className="flex-1 bg-muted/30 border border-border/40 rounded-md px-2 py-1.5 text-[11px] font-medium focus:ring-1 focus:ring-primary/20 outline-none"
                                  >
                                    {AVAILABLE_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                                  </select>
                                  <button onClick={() => removeFallback(fbIdx)} className="p-1 text-muted-foreground/50 hover:text-red-500">
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                       </div>
                    </div>
                  </div>

                  {/* Volume Scaling Rules */}
                  {sizeOverrides.map((ov, i) => (
                    <div key={i} className="surface p-6 border border-border/60 bg-muted/5 relative group hover:border-primary/30 transition-all">
                      <button 
                        onClick={() => removeOverride(i)}
                        className="absolute top-4 right-4 p-1.5 text-muted-foreground/40 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>

                      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-8">
                         <div className="space-y-4">
                            <div className="space-y-2">
                              <label className="text-[9px] font-black uppercase text-muted-foreground/70">PR Size Threshold</label>
                              <div className="flex items-center gap-2">
                                <input 
                                  type="number" 
                                  value={ov.max_lines} 
                                  onChange={(e) => updateOverride(i, 'max_lines', parseInt(e.target.value))}
                                  className="w-full bg-background border border-border/60 rounded-lg px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-primary/20 outline-none"
                                />
                                <span className="text-[10px] font-medium text-muted-foreground">Lines</span>
                              </div>
                            </div>
                         </div>

                         <div className="space-y-5">
                            <div className="space-y-2">
                              <label className="text-[9px] font-black uppercase text-primary/80">Primary Model</label>
                              <select 
                                value={ov.model} 
                                onChange={(e) => updateOverride(i, 'model', e.target.value)}
                                className="w-full bg-background border border-border/60 rounded-lg px-3 py-2 text-xs font-semibold focus:ring-2 focus:ring-primary/20 outline-none"
                              >
                                {AVAILABLE_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                              </select>
                            </div>

                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <label className="text-[9px] font-black uppercase text-amber-500/80">Fallback Models</label>
                                <button onClick={() => addOverrideFallback(i)} className="text-[9px] font-bold text-primary hover:underline flex items-center gap-1">
                                  <ListPlus size={10} /> Add Fallback
                                </button>
                              </div>
                              <div className="space-y-2">
                                {(ov.fallbacks || []).map((fb: string, fbIdx: number) => (
                                  <div key={fbIdx} className="flex items-center gap-2">
                                    <div className="w-1 h-1 rounded-full bg-amber-500/40"></div>
                                    <select 
                                      value={fb} 
                                      onChange={(e) => updateOverrideFallback(i, fbIdx, e.target.value)}
                                      className="flex-1 bg-muted/30 border border-border/40 rounded-md px-2 py-1.5 text-[11px] font-medium focus:ring-1 focus:ring-primary/20 outline-none"
                                    >
                                      {AVAILABLE_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                                    </select>
                                    <button onClick={() => removeOverrideFallback(i, fbIdx)} className="p-1 text-muted-foreground/50 hover:text-red-500">
                                      <Trash2 size={12} />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                         </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-6">
                 <div className="surface p-6 border border-border/60 bg-gradient-to-br from-background to-muted/20">
                    <div className="flex items-center gap-2 mb-4">
                      <ShieldCheck size={18} className="text-primary" />
                      <h4 className="text-[10px] font-black uppercase tracking-wider">Control Panel</h4>
                    </div>
                    
                    <div className="space-y-5">
                       <Button 
                         onClick={handleSave} 
                         disabled={saving} 
                         className="w-full gap-2 shadow-lg shadow-primary/10"
                       >
                         {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                         {saving ? 'Applying...' : 'Save Rule Config'}
                       </Button>

                       <div className="pt-4 border-t border-border/40 space-y-3">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-muted-foreground">Sync Mode</span>
                            <span className="font-bold text-foreground">Real-time Webhook</span>
                          </div>
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-muted-foreground">Provider Access</span>
                            <span className="text-emerald-500 font-bold uppercase tracking-tighter text-[9px] bg-emerald-500/10 px-1.5 py-0.5 rounded">Verified</span>
                          </div>
                       </div>
                       
                       <div className="bg-[#0d1117] rounded-lg p-3 overflow-hidden border border-border/10">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[9px] font-bold text-zinc-500 uppercase">Snapshot</span>
                            <Settings size={10} className="text-zinc-600" />
                          </div>
                          <pre className="text-[9px] font-mono text-indigo-300/70 overflow-hidden text-ellipsis">
                            {JSON.stringify(repo.parsedJson.model, null, 2)}
                          </pre>
                       </div>
                    </div>
                 </div>

                 <div className="p-6 rounded-2xl bg-indigo-500/5 border border-indigo-500/10 space-y-3">
                    <div className="flex items-center gap-2">
                      <AlertCircle size={16} className="text-indigo-400" />
                      <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Repository Links</p>
                    </div>
                    <div className="flex flex-col gap-2">
                       <a 
                         href={`https://github.com/${repo.owner}/${repo.repo}`} 
                         target="_blank" 
                         className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                       >
                         GitHub Repo <ExternalLink size={10} />
                       </a>
                       <a 
                         href={`https://github.com/${repo.owner}/${repo.repo}/settings/installations`} 
                         target="_blank" 
                         className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                       >
                         App Settings <Settings size={10} />
                       </a>
                    </div>
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
      <div className="flex flex-col gap-6 p-8 animate-pulse">
        <Skeleton width="400px" height="48px" className="mb-8" />
        <div className="space-y-4">
          <Skeleton height="80px" className="rounded-xl" />
          <Skeleton height="80px" className="rounded-xl" />
          <Skeleton height="80px" className="rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="page-enter flex flex-col gap-8 pb-20">
      <PageHeader
        category="Configuration"
        title="Managed Repositories"
        description="Toggle status and define volume-based model scaling for your projects"
        actions={
          <div className="flex items-center gap-3">
             <Button onClick={handleSync} disabled={syncing} variant="outline" size="sm" className="gap-2">
              <RefreshCw size={14} className={cn(syncing && 'animate-spin')} />
              Sync Now
            </Button>
            <Button asChild variant="secondary" size="sm" className="gap-2">
              <a href="https://github.com/apps/codra-app/installations/new" target="_blank" rel="noopener noreferrer">
                <Settings size={14} />
                Manage Access
              </a>
            </Button>
          </div>
        }
      />

      {error && <Alert variant="destructive">{error}</Alert>}

      <div className="flex flex-col">
        {repos.length === 0 ? (
          <div className="surface border border-dashed border-border/50 bg-background/50 flex items-center justify-center py-32 rounded-3xl">
            <EmptyState
              icon={<GitBranch size={48} className="text-muted-foreground/20" />}
              title="No repositories found"
              description="Sync your repositories or check your GitHub App installation settings to grant access."
              className="border-0 bg-transparent"
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

      <div className="mt-8 p-10 rounded-[2.5rem] bg-gradient-to-br from-indigo-500/5 to-primary/5 border border-primary/10 relative overflow-hidden">
         <div className="absolute -right-8 -bottom-8 opacity-[0.03]">
           <Settings size={280} />
         </div>
         <div className="max-w-2xl relative z-10">
            <h4 className="text-sm font-bold mb-3 flex items-center gap-2">
              <ShieldCheck size={18} className="text-primary" />
              Pro Design Note
            </h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Codra uses a hierarchical configuration system. If no volume-scaling rules match for a given pull request, the system defaults to the primary model defined in your <code className="text-primary font-mono">{REPO_CONFIG_FILENAME}</code>. Toggle a project to <span className="text-red-500 font-bold">Disabled</span> to stop all webhook processing immediately.
            </p>
         </div>
      </div>
    </div>
  );
}

