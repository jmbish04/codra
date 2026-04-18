import { useEffect, useState } from 'react';
import { api } from '@client/lib/api';
import { PageHeader } from '@client/components/page-header';
import { Card } from '@client/components/ui/card';
import { Button } from '@client/components/ui/button';
import { Alert } from '@client/components/ui/alert';
import { Skeleton } from '@client/components/skeleton';
import { Cpu, Save, ShieldAlert, Zap, Clock, Hash, Layers, ListPlus, ArrowUpRight, Trash2, RefreshCw } from 'lucide-react';
import type { ModelConfig } from '@shared/schema';
import { ModelChain, MODELS } from '@client/components/model-chain';
import { cn } from '@client/lib/utils';

export function SettingsPage() {
  const [configs, setConfigs] = useState<ModelConfig[]>([]);
  const [globalConfig, setGlobalConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);

  const loadConfigs = async () => {
    try {
      const [modelsRes, globalRes] = await Promise.all([
        api.getModelConfigs(),
        api.getGlobalConfig()
      ]);
      setConfigs(modelsRes.configs);
      setGlobalConfig(globalRes.config);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadConfigs(); }, []);

  const handleGlobalUpdate = async () => {
    setSaving('global');
    setError(null);
    try {
      await api.updateGlobalConfig(globalConfig);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setSaving(null);
    }
  };

  const handleUpdate = async (id: string, updates: Partial<ModelConfig>) => {
    setSaving(id);
    setError(null);
    try {
      const current = configs.find(c => c.modelId === id);
      if (!current) return;
      
      const next = { ...current, ...updates };
      await api.updateModelConfig(id, next);
      
      setConfigs(configs.map(c => c.modelId === id ? { ...c, ...updates, updatedAt: new Date().toISOString() } : c));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setSaving(null);
    }
  };

  const updateGlobalBaseline = (p: string, fbs: string[]) => {
    setGlobalConfig({ ...globalConfig, main: p, fallbacks: fbs });
  };

  const addGlobalOverride = () => {
    const nextOverrides = [
      ...(globalConfig.size_overrides || []),
      { max_lines: 300, model: MODELS[0].value, fallbacks: [] }
    ];
    setGlobalConfig({ ...globalConfig, size_overrides: nextOverrides });
  };

  const updateGlobalOverride = (idx: number, updates: any) => {
    const next = [...(globalConfig.size_overrides || [])];
    next[idx] = { ...next[idx], ...updates };
    setGlobalConfig({ ...globalConfig, size_overrides: next });
  };

  const removeGlobalOverride = (idx: number) => {
    const next = (globalConfig.size_overrides || []).filter((_: any, i: number) => i !== idx);
    setGlobalConfig({ ...globalConfig, size_overrides: next });
  };

  return (
    <div className="flex flex-col gap-16 page-enter max-w-6xl mx-auto pb-20">
      <div className="space-y-2">
        <PageHeader 
          category="System Configuration"
          title="Account Settings"
          description="Centralized control for intelligence scaling and model performance quotas"
        />
        <div className="h-px w-full bg-gradient-to-r from-primary/20 via-border to-transparent" />
      </div>

      {error && (
        <Alert variant="destructive" className="rounded-2xl border-red-500/20 bg-red-500/5 py-4">
          <ShieldAlert className="h-4 w-4" />
          <span className="font-bold text-sm ml-2 tracking-tight">{error}</span>
        </Alert>
      )}

      {/* 1. Global Intelligence Scaling Section */}
      <section className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex items-center justify-between px-2">
          <div className="space-y-1.5">
            <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-primary/60 flex items-center gap-2">
              <Layers size={14} /> Global Intelligence Strategy
            </h3>
            <p className="text-sm text-muted-foreground font-medium">Account-wide model chains and complexity thresholds</p>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={addGlobalOverride}
            className="h-10 rounded-2xl border-primary/20 bg-primary/[0.02] hover:bg-primary/5 text-[10px] font-black uppercase tracking-widest gap-2 shadow-sm transition-all active:scale-95"
          >
            <ListPlus size={16} /> New Tier
          </Button>
        </div>

        {!loading && globalConfig && (
          <div className="relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.03] to-transparent rounded-[3rem] -z-10" />
            <div className="surface p-12 border border-border/60 rounded-[3rem] shadow-2xl shadow-primary/5 space-y-12">
               <div className="space-y-10">
                  {/* Baseline Tier */}
                  <div className="relative p-10 rounded-[2rem] border border-primary/20 bg-background/50 backdrop-blur-sm transition-all hover:shadow-lg hover:shadow-primary/5">
                    <div className="absolute -top-3.5 left-8 px-4 py-1 bg-background border border-primary/20 rounded-full shadow-sm flex items-center gap-2">
                      <span className="text-[10px] font-black uppercase tracking-[0.15em] text-primary">
                        Baseline Fleet
                      </span>
                      {globalConfig.size_overrides?.length > 0 && (
                        <span className="text-[10px] font-bold text-muted-foreground/40 border-l border-border/20 pl-2 ml-1">
                          &gt; {Math.max(...globalConfig.size_overrides.map((o: any) => o.max_lines))} Lines
                        </span>
                      )}
                    </div>
                    <ModelChain 
                      primary={globalConfig.main} 
                      fallbacks={globalConfig.fallbacks || []} 
                      onChange={updateGlobalBaseline} 
                    />
                  </div>

                  {/* Overrides */}
                  <div className="space-y-6">
                    {globalConfig.size_overrides?.map((ov: any, i: number) => (
                      <div key={i} className="relative p-10 rounded-[2rem] border border-border bg-muted/10 transition-all hover:bg-muted/20">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => removeGlobalOverride(i)}
                          className="absolute top-6 right-6 h-9 w-9 text-muted-foreground/30 hover:text-red-500 hover:bg-red-500/5 rounded-full"
                        >
                          <Trash2 size={18} />
                        </Button>

                        <div className="grid grid-cols-1 xl:grid-cols-[220px_1fr] gap-12">
                          <div className="space-y-4">
                            <label className="text-[10px] font-black uppercase text-muted-foreground/60 tracking-widest px-1">Complexity Threshold</label>
                            <div className="flex items-center gap-3 p-1.5 pl-4 bg-background border border-border rounded-2xl focus-within:ring-2 focus-within:ring-primary/10 transition-shadow shadow-sm">
                               <input 
                                type="number" 
                                value={ov.max_lines} 
                                onChange={(e) => updateGlobalOverride(i, { max_lines: parseInt(e.target.value) })}
                                className="w-full bg-transparent border-0 py-2 text-sm font-black outline-none tracking-tight"
                              />
                              <span className="text-[10px] font-black text-muted-foreground/40 pr-4 uppercase tracking-tighter">Lines</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground/50 italic px-1 leading-relaxed">
                              PRs up to this total line count will use this logic chain.
                            </p>
                          </div>
                          <ModelChain 
                            primary={ov.model} 
                            fallbacks={ov.fallbacks || []} 
                            onChange={(p, fbs) => updateGlobalOverride(i, { model: p, fallbacks: fbs })} 
                          />
                        </div>
                      </div>
                    ))}
                  </div>
               </div>

               <div className="flex justify-end pt-8 border-t border-border/10">
                  <Button 
                    onClick={handleGlobalUpdate} 
                    disabled={saving === 'global'}
                    className="h-14 px-10 rounded-[1.25rem] shadow-2xl shadow-primary/20 transition-all active:scale-95 group/btn overflow-hidden relative"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover/btn:translate-x-full transition-transform duration-1000" />
                    {saving === 'global' ? <RefreshCw size={20} className="animate-spin" /> : <Save size={20} />}
                    <span className="ml-3 font-black text-sm uppercase tracking-widest">Update Global Strategy</span>
                  </Button>
               </div>
            </div>
          </div>
        )}
      </section>

      {/* 2. Provider Rate Limits Section */}
      <section className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-150">
        <div className="px-2 space-y-1.5">
          <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-primary/60 flex items-center gap-2">
            <ShieldAlert size={14} className="text-amber-500" /> Model Intelligence Quotas
          </h3>
          <p className="text-sm text-muted-foreground font-medium">Provider rate limits and token capacity management</p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 px-2">
            {[1, 2, 3].map(i => <Skeleton key={i} height="200px" className="rounded-[2rem]" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 px-2">
            {configs.map(cfg => (
              <div key={cfg.modelId} className="surface p-10 border border-border/60 rounded-[2.5rem] bg-background/40 hover:bg-background/80 hover:border-primary/20 transition-all group/card border-b-4 border-b-primary/5 hover:border-b-primary/20">
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-primary/10 text-primary group-hover/card:scale-110 transition-transform">
                      <Cpu size={20} />
                    </div>
                    <span className="font-black text-sm tracking-tight text-foreground/90">{cfg.modelId}</span>
                  </div>
                  <span className="text-[8px] font-black uppercase tracking-[0.2em] px-2.5 py-1 rounded-full border border-border bg-muted/30 text-muted-foreground/60 group-hover/card:bg-primary/5 group-hover/card:text-primary/70 transition-colors">
                    {cfg.provider}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-8">
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-muted-foreground/40 uppercase tracking-tighter flex items-center gap-1 px-1">
                      RPM
                    </label>
                    <input 
                      type="number" 
                      value={cfg.rpm} 
                      onChange={(e) => setConfigs(configs.map(c => c.modelId === cfg.modelId ? { ...c, rpm: parseInt(e.target.value) } : c))}
                      className="w-full bg-muted/20 border border-border/50 rounded-xl px-3 py-2 text-xs font-black focus:ring-2 focus:ring-primary/10 outline-none transition-all focus:bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-muted-foreground/40 uppercase tracking-tighter flex items-center gap-1 px-1">
                      RPD
                    </label>
                    <input 
                      type="number" 
                      value={cfg.rpd}
                      onChange={(e) => setConfigs(configs.map(c => c.modelId === cfg.modelId ? { ...c, rpd: parseInt(e.target.value) } : c))}
                      className="w-full bg-muted/20 border border-border/50 rounded-xl px-3 py-2 text-xs font-black focus:ring-2 focus:ring-primary/10 outline-none transition-all focus:bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-muted-foreground/40 uppercase tracking-tighter flex items-center gap-1 px-1">
                       TPM
                    </label>
                    <input 
                      type="number" 
                      value={cfg.tpm}
                      onChange={(e) => setConfigs(configs.map(c => c.modelId === cfg.modelId ? { ...c, tpm: parseInt(e.target.value) } : c))}
                      className="w-full bg-muted/20 border border-border/50 rounded-xl px-3 py-2 text-xs font-black focus:ring-2 focus:ring-primary/10 outline-none transition-all focus:bg-background"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between mt-auto">
                  <div className="flex flex-col">
                    <span className="text-[8px] font-bold text-muted-foreground/30 uppercase tracking-[0.1em]">Last Calibration</span>
                    <span className="text-[9px] font-black text-muted-foreground/60">
                      {new Date(cfg.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <Button 
                    size="sm" 
                    variant="ghost"
                    className="h-9 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest gap-2 hover:bg-primary/10 hover:text-primary transition-all active:scale-95" 
                    disabled={saving === cfg.modelId}
                    onClick={() => handleUpdate(cfg.modelId, cfg)}
                  >
                    {saving === cfg.modelId ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
                    {saving === cfg.modelId ? 'Saving' : 'Apply'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
