import { useEffect, useState } from 'react';
import { api } from '@client/lib/api';
import { PageHeader } from '@client/components/page-header';
import { Card } from '@client/components/ui/card';
import { Button } from '@client/components/ui/button';
import { Alert } from '@client/components/ui/alert';
import { Skeleton } from '@client/components/skeleton';
import { Cpu, Save, ShieldAlert, Zap, Clock, Hash } from 'lucide-react';
import type { ModelConfig } from '@shared/schema';

export function SettingsPage() {
  const [configs, setConfigs] = useState<ModelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);

  const loadConfigs = () => {
    api.getModelConfigs()
      .then(res => {
        setConfigs(res.configs);
        setLoading(false);
      })
      .catch(e => {
        setError(e.message);
        setLoading(false);
      });
  };

  useEffect(() => { loadConfigs(); }, []);

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

  return (
    <div className="flex flex-col gap-6 page-enter">
      <PageHeader 
        category="Admin"
        title="Global Settings"
        description="Manage AI model rate limits and global parameters"
      />

      {error && <Alert variant="destructive">{error}</Alert>}

      <div className="grid grid-cols-1 gap-6">
        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <ShieldAlert size={14} className="text-amber-500" /> Free Tier Rate Limits
          </h3>
          <p className="text-xs text-muted-foreground -mt-2">
            The values below reflect the <span className="text-amber-500/80 font-medium italic">Free Tier</span> quotas for each provider. High-volume analysis may be paused if these are exceeded.
          </p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} height="160px" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {configs.map(cfg => (
              <div key={cfg.modelId} className="surface p-5 border border-border/50 flex flex-col gap-5 hover:border-primary/30 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded bg-primary/10 text-primary">
                      <Cpu size={16} />
                    </div>
                    <span className="font-bold text-sm tracking-tight">{cfg.modelId}</span>
                  </div>
                  <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded border border-border bg-muted/30 text-muted-foreground">
                    {cfg.provider}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-bold text-muted-foreground uppercase flex items-center gap-1">
                      <Zap size={8} /> RPM
                    </label>
                    <input 
                      type="number" 
                      value={cfg.rpm} 
                      onChange={(e) => setConfigs(configs.map(c => c.modelId === cfg.modelId ? { ...c, rpm: parseInt(e.target.value) } : c))}
                      className="bg-muted/50 border border-border/50 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-primary/30"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-bold text-muted-foreground uppercase flex items-center gap-1">
                      <Clock size={8} /> RPD
                    </label>
                    <input 
                      type="number" 
                      value={cfg.rpd}
                      onChange={(e) => setConfigs(configs.map(c => c.modelId === cfg.modelId ? { ...c, rpd: parseInt(e.target.value) } : c))}
                      className="bg-muted/50 border border-border/50 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-primary/30"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-bold text-muted-foreground uppercase flex items-center gap-1">
                      <Hash size={8} /> TPM
                    </label>
                    <input 
                      type="number" 
                      value={cfg.tpm}
                      onChange={(e) => setConfigs(configs.map(c => c.modelId === cfg.modelId ? { ...c, tpm: parseInt(e.target.value) } : c))}
                      className="bg-muted/50 border border-border/50 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-primary/30"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between mt-auto pt-3 border-t border-border/30">
                  <span className="text-[8px] text-muted-foreground">
                    Updated {new Date(cfg.updatedAt).toLocaleDateString()}
                  </span>
                  <Button 
                    size="sm" 
                    className="h-7 text-[10px] gap-1.5" 
                    disabled={saving === cfg.modelId}
                    onClick={() => handleUpdate(cfg.modelId, cfg)}
                  >
                    <Save size={11} />
                    {saving === cfg.modelId ? 'Saving' : 'Save'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
