import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@client/lib/api';
import { PageHeader } from '@client/components/layout/page-header';
import { Button } from '@client/components/ui/button';
import { Alert } from '@client/components/ui/alert';
import { Skeleton } from '@client/components/shared/skeleton';
import {
  Cpu, Save, ShieldAlert, Layers, ListPlus, Trash2, RefreshCw,
} from 'lucide-react';
import type { ModelConfig } from '@shared/schema';
import { ModelChain, MODELS } from '@client/components/features/models/model-chain';
import { cn } from '@client/lib/utils';

// ─── Default global config matching the expected dashboard defaults ───────────
const DEFAULT_GLOBAL_CONFIG = {
  main: 'gemma-4-31b-it',
  fallbacks: ['gemma-4-26b-a4b-it', '@cf/zai-org/glm-4.7-flash'],
  size_overrides: [
    {
      max_lines: 300,
      model: 'gemma-4-31b-it',
      fallbacks: ['gemma-4-26b-a4b-it', '@cf/zai-org/glm-4.7-flash'],
    },
    {
      max_lines: 100,
      model: '@cf/moonshotai/kimi-k2.5',
      fallbacks: ['@cf/zai-org/glm-4.7-flash'],
    },
  ],
};

// ─── SettingsPage ────────────────────────────────────────────────────────
export function SettingsPage() {
  const [configs, setConfigs] = useState<ModelConfig[]>([]);
  const [globalConfig, setGlobalConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadConfigs = async () => {
    try {
      const [modelsRes, globalRes] = await Promise.all([
        api.getModelConfigs(),
        api.getGlobalConfig(),
      ]);
      setConfigs(modelsRes.configs);

      // If global config has no main model set, seed with defaults
      const cfg = globalRes.config;
      if (!cfg || !cfg.main) {
        setGlobalConfig(DEFAULT_GLOBAL_CONFIG);
      } else {
        // Ensure fallbacks array is always populated with defaults if empty
        setGlobalConfig({
          ...cfg,
          fallbacks: cfg.fallbacks?.length ? cfg.fallbacks : DEFAULT_GLOBAL_CONFIG.fallbacks,
          size_overrides: cfg.size_overrides ?? DEFAULT_GLOBAL_CONFIG.size_overrides,
        });
      }
    } catch (e: any) {
      setError(e.message);
      toast.error('Failed to load settings', { description: e.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadConfigs(); }, []);

  const handleGlobalUpdate = async () => {
    setSaving('global');
    setError(null);
    const tid = toast.loading('Saving global strategy…');
    try {
      await api.updateGlobalConfig(globalConfig);
      toast.success('Global strategy saved', {
        id: tid,
        description: `Primary model: ${MODELS.find(m => m.value === globalConfig.main)?.label ?? globalConfig.main}`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Update failed';
      setError(msg);
      toast.error('Failed to save strategy', { id: tid, description: msg });
    } finally {
      setSaving(null);
    }
  };

  const handleUpdate = async (id: string, updates: Partial<ModelConfig>) => {
    setSaving(id);
    setError(null);
    const tid = toast.loading(`Updating ${id}…`);
    try {
      const current = configs.find(c => c.modelId === id);
      if (!current) return;
      const next = { ...current, ...updates };
      await api.updateModelConfig(id, next);
      setConfigs(configs.map(c =>
        c.modelId === id ? { ...c, ...updates, updatedAt: new Date().toISOString() } : c,
      ));
      toast.success('Model quota updated', { id: tid, description: id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Update failed';
      setError(msg);
      toast.error('Failed to update quota', { id: tid, description: msg });
    } finally {
      setSaving(null);
    }
  };

  const updateGlobalBaseline = (p: string, fbs: string[]) => {
    setGlobalConfig({ ...globalConfig, main: p, fallbacks: fbs });
  };

  const addGlobalOverride = () => {
    setGlobalConfig({
      ...globalConfig,
      size_overrides: [
        ...(globalConfig?.size_overrides || []),
        { max_lines: 300, model: MODELS[0].value, fallbacks: [] },
      ],
    });
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
    <section className="page-enter flex flex-col gap-6 pb-20">
      <PageHeader
        category="Defaults"
        title="Review settings"
        description="Choose the default model chain, file-size tiers, and provider quotas."
      />

      {error && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <span className="ml-2 font-semibold text-sm">{error}</span>
        </Alert>
      )}

      {/* ── Section 1: Global Model Settings ────── */}
      <div className="flex flex-col gap-4">
        {/* Section header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
          <div className="flex items-center gap-2">
            <Layers size={13} strokeWidth={1.75} className="text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Global Model Settings</h2>
            <span className="text-xs text-muted-foreground">· Account-wide model chains &amp; complexity thresholds</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={addGlobalOverride}
            disabled={!globalConfig}
            className="gap-1.5 h-7 text-[10px] font-semibold"
          >
            <ListPlus size={12} />
            New Tier
          </Button>
        </div>

        {/* Content card */}
        <div className="surface overflow-hidden">
          {!loading && globalConfig ? (
            <div>
              {/* Baseline */}
              <div className="px-5 py-5 border-b border-border/50">
                <div className="relative border border-primary/20 rounded-md px-4 py-4 bg-primary/[0.01]">
                  <span className="absolute -top-2.5 left-3 bg-card px-2 text-[9px] font-bold uppercase tracking-widest text-primary border border-primary/20 rounded">
                    Baseline{globalConfig.size_overrides?.length > 0
                      ? ` · >${Math.max(...globalConfig.size_overrides.map((o: any) => o.max_lines))} lines`
                      : ''}
                  </span>
                  <ModelChain
                    primary={globalConfig.main}
                    fallbacks={globalConfig.fallbacks || []}
                    onChange={updateGlobalBaseline}
                  />
                </div>
              </div>

              {/* Per-size overrides */}
              {globalConfig.size_overrides?.map((ov: any, i: number) => (
                <div key={i} className="px-5 py-5 border-b border-border/50">
                  <div className="relative border border-border rounded-md px-4 py-4 bg-muted/5">
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      onClick={(e) => { e.preventDefault(); removeGlobalOverride(i); }}
                      className="absolute top-2 right-2 h-7 w-7 text-muted-foreground/30 hover:text-danger hover:bg-danger/5"
                    >
                      <Trash2 size={13} />
                    </Button>

                    <div className="grid grid-cols-1 xl:grid-cols-[160px_1fr] gap-6">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Max Lines
                        </label>
                        <div className="flex items-center gap-2 h-9 px-3 bg-background border border-border rounded-md focus-within:ring-1 focus-within:ring-ring">
                          <input
                            type="number"
                            value={ov.max_lines}
                            onChange={e => updateGlobalOverride(i, { max_lines: parseInt(e.target.value) })}
                            className="flex-1 bg-transparent text-sm font-semibold outline-none"
                          />
                          <span className="text-[10px] text-muted-foreground/50 font-mono shrink-0">loc</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground/50">
                          PRs up to {ov.max_lines} lines.
                        </p>
                      </div>
                      <ModelChain
                        primary={ov.model}
                        fallbacks={ov.fallbacks || []}
                        onChange={(p, fbs) => updateGlobalOverride(i, { model: p, fallbacks: fbs })}
                      />
                    </div>
                  </div>
                </div>
              ))}

              {/* Save row */}
              <div className="flex justify-end px-5 py-4 bg-muted/10">
                <Button
                  onClick={handleGlobalUpdate}
                  disabled={saving === 'global'}
                  className="gap-2"
                >
                  {saving === 'global'
                    ? <RefreshCw size={14} className="animate-spin" />
                    : <Save size={14} />}
                  Save Global Strategy
                </Button>
              </div>
            </div>
          ) : (
            <div className="px-5 py-5 space-y-3">
              <Skeleton height={20} />
              <Skeleton height={20} width="80%" />
            </div>
          )}
        </div>
      </div>

      {/* ── Section 2: Provider Rate Limits ────────────── */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <ShieldAlert size={13} strokeWidth={1.75} className="text-warning" />
          <h2 className="text-sm font-semibold text-foreground">Model Usage Quotas</h2>
          <span className="text-xs text-muted-foreground">· Provider rate limits and token capacity</span>
        </div>

        {loading ? (
          <div className="surface overflow-hidden">
            {[1, 2, 3].map(i => (
              <div key={i} className="px-5 py-4 border-b border-border/50 last:border-0">
                <Skeleton height={20} />
              </div>
            ))}
          </div>
        ) : (
          <div className="surface overflow-x-auto">
            <div className="min-w-[700px]">
              {/* Table header */}
              <div className="grid grid-cols-[1fr_80px_80px_80px_100px_90px] gap-0 border-b border-border bg-muted/40">
              <div className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Model</div>
              <div className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center">RPM</div>
              <div className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center">RPD</div>
              <div className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center">TPM</div>
              <div className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Updated</div>
              <div className="px-4 py-2.5" />
            </div>

            {configs.map((cfg, i) => (
              <div
                key={cfg.modelId}
                className={cn(
                  'group grid grid-cols-[1fr_80px_80px_80px_100px_90px] items-center gap-0 transition-colors hover:bg-primary/[0.02]',
                  i < configs.length - 1 && 'border-b border-border/40',
                )}
              >
                {/* Model name */}
                <div className="px-4 py-3.5 min-w-0">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1 rounded bg-primary/8 text-primary group-hover:bg-primary/15 transition-colors">
                      <Cpu size={12} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{cfg.modelId}</p>
                      <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wide">{cfg.provider}</p>
                    </div>
                  </div>
                </div>

                {/* RPM */}
                <div className="px-3 py-3.5">
                  <input
                    type="number"
                    value={cfg.rpm}
                    onChange={e =>
                      setConfigs(configs.map(c =>
                        c.modelId === cfg.modelId ? { ...c, rpm: parseInt(e.target.value) } : c,
                      ))
                    }
                    className="w-full bg-transparent text-sm font-mono font-semibold text-center text-muted-foreground focus:text-foreground focus:bg-muted/30 rounded px-1.5 py-1 outline-none transition-colors focus:ring-1 focus:ring-ring border border-transparent focus:border-border"
                  />
                </div>

                {/* RPD */}
                <div className="px-3 py-3.5">
                  <input
                    type="number"
                    value={cfg.rpd}
                    onChange={e =>
                      setConfigs(configs.map(c =>
                        c.modelId === cfg.modelId ? { ...c, rpd: parseInt(e.target.value) } : c,
                      ))
                    }
                    className="w-full bg-transparent text-sm font-mono font-semibold text-center text-muted-foreground focus:text-foreground focus:bg-muted/30 rounded px-1.5 py-1 outline-none transition-colors focus:ring-1 focus:ring-ring border border-transparent focus:border-border"
                  />
                </div>

                {/* TPM */}
                <div className="px-3 py-3.5">
                  <input
                    type="number"
                    value={cfg.tpm}
                    onChange={e =>
                      setConfigs(configs.map(c =>
                        c.modelId === cfg.modelId ? { ...c, tpm: parseInt(e.target.value) } : c,
                      ))
                    }
                    className="w-full bg-transparent text-sm font-mono font-semibold text-center text-muted-foreground focus:text-foreground focus:bg-muted/30 rounded px-1.5 py-1 outline-none transition-colors focus:ring-1 focus:ring-ring border border-transparent focus:border-border"
                  />
                </div>

                {/* Updated */}
                <div className="px-3 py-3.5">
                  <span className="text-[11px] font-mono text-muted-foreground/50">
                    {new Date(cfg.updatedAt).toLocaleDateString()}
                  </span>
                </div>

                {/* Save */}
                <div className="px-4 py-3.5 flex justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={saving === cfg.modelId}
                    onClick={() => handleUpdate(cfg.modelId, cfg)}
                    className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {saving === cfg.modelId
                      ? <RefreshCw size={11} className="animate-spin" />
                      : <Save size={11} />}
                    {saving === cfg.modelId ? 'Saving…' : 'Apply'}
                  </Button>
                </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
