import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@client/lib/api';
import { PageHeader } from '@client/components/layout/page-header';
import { Button } from '@client/components/ui/button';
import { Alert } from '@client/components/ui/alert';
import { Skeleton } from '@client/components/shared/skeleton';
import {
  Cpu,
  Save,
  ShieldAlert,
  Layers,
  RefreshCw,
  Gauge,
} from 'lucide-react';
import type { ModelConfig } from '@shared/schema';
import {
  getModelLabel,
  getProviderLabel,
  ModelRouteEditor,
  type ModelRouteConfig,
} from '@client/components/features/models/model-chain';
import { cn } from '@client/lib/utils';

const DEFAULT_GLOBAL_CONFIG: ModelRouteConfig = {
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
      model: '@cf/moonshotai/kimi-k2.6',
      fallbacks: ['@cf/zai-org/glm-4.7-flash'],
    },
  ],
};

export function normalizeGlobalConfig(config: any): ModelRouteConfig {
  if (!config || !config.main) return DEFAULT_GLOBAL_CONFIG;
  return {
    main: config.main,
    fallbacks: Array.isArray(config.fallbacks) ? config.fallbacks : DEFAULT_GLOBAL_CONFIG.fallbacks,
    size_overrides: Array.isArray(config.size_overrides) ? config.size_overrides : DEFAULT_GLOBAL_CONFIG.size_overrides,
  };
}

function routeEqual(a: ModelRouteConfig | null, b: ModelRouteConfig | null) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function quotaEqual(a?: ModelConfig, b?: ModelConfig) {
  return Boolean(a && b && a.rpm === b.rpm && a.rpd === b.rpd && a.tpm === b.tpm);
}

function quotaPayload(config: ModelConfig) {
  return {
    rpm: config.rpm,
    rpd: config.rpd,
    tpm: config.tpm,
    provider: config.provider,
  };
}

export function SettingsPage() {
  const [configs, setConfigs] = useState<ModelConfig[]>([]);
  const [savedConfigs, setSavedConfigs] = useState<ModelConfig[]>([]);
  const [globalConfig, setGlobalConfig] = useState<ModelRouteConfig | null>(null);
  const [savedGlobalConfig, setSavedGlobalConfig] = useState<ModelRouteConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const globalDirty = useMemo(
    () => !routeEqual(globalConfig, savedGlobalConfig),
    [globalConfig, savedGlobalConfig],
  );

  const dirtyConfigs = useMemo(
    () => configs.filter(cfg => !quotaEqual(cfg, savedConfigs.find(saved => saved.modelId === cfg.modelId))),
    [configs, savedConfigs],
  );

  const loadConfigs = async () => {
    try {
      const [modelsRes, globalRes] = await Promise.all([
        api.getModelConfigs(),
        api.getGlobalConfig(),
      ]);
      const nextGlobalConfig = normalizeGlobalConfig(globalRes.config);
      setConfigs(modelsRes.configs);
      setSavedConfigs(modelsRes.configs);
      setGlobalConfig(nextGlobalConfig);
      setSavedGlobalConfig(nextGlobalConfig);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load settings';
      setError(msg);
      toast.error('Failed to load settings', { description: msg });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadConfigs(); }, []);

  const handleGlobalUpdate = async () => {
    if (!globalConfig || !globalDirty) return;
    setSaving('global');
    setError(null);
    const tid = toast.loading('Saving global strategy...');
    try {
      await api.updateGlobalConfig(globalConfig);
      setSavedGlobalConfig(globalConfig);
      toast.success('Global strategy saved', {
        id: tid,
        description: `Primary model: ${getModelLabel(globalConfig.main)}`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Update failed';
      setError(msg);
      toast.error('Failed to save strategy', { id: tid, description: msg });
    } finally {
      setSaving(null);
    }
  };

  const markConfigSaved = (id: string, saved: ModelConfig) => {
    setConfigs(current => current.map(cfg => (cfg.modelId === id ? saved : cfg)));
    setSavedConfigs(current => current.map(cfg => (cfg.modelId === id ? saved : cfg)));
  };

  const handleUpdate = async (id: string) => {
    const current = configs.find(c => c.modelId === id);
    if (!current) return;
    setSaving(id);
    setError(null);
    const tid = toast.loading(`Updating ${id}...`);
    try {
      await api.updateModelConfig(id, quotaPayload(current));
      const saved = { ...current, updatedAt: new Date().toISOString() };
      markConfigSaved(id, saved);
      toast.success('Model quota updated', { id: tid, description: id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Update failed';
      setError(msg);
      toast.error('Failed to update quota', { id: tid, description: msg });
    } finally {
      setSaving(null);
    }
  };

  const handleSaveAllQuotas = async () => {
    if (dirtyConfigs.length === 0) return;
    setSaving('quotas');
    setError(null);
    const tid = toast.loading(`Saving ${dirtyConfigs.length} quota ${dirtyConfigs.length === 1 ? 'change' : 'changes'}...`);
    try {
      await Promise.all(dirtyConfigs.map(cfg => api.updateModelConfig(cfg.modelId, quotaPayload(cfg))));
      const now = new Date().toISOString();
      const dirtyIds = new Set(dirtyConfigs.map(cfg => cfg.modelId));
      setConfigs(current => current.map(cfg => (dirtyIds.has(cfg.modelId) ? { ...cfg, updatedAt: now } : cfg)));
      setSavedConfigs(current =>
        configs.map(cfg => (dirtyIds.has(cfg.modelId) ? { ...cfg, updatedAt: now } : current.find(saved => saved.modelId === cfg.modelId) ?? cfg)),
      );
      toast.success('Quotas saved', { id: tid });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Update failed';
      setError(msg);
      toast.error('Failed to save quotas', { id: tid, description: msg });
    } finally {
      setSaving(null);
    }
  };

  const updateQuota = (id: string, field: 'rpm' | 'rpd' | 'tpm', value: number) => {
    setConfigs(current =>
      current.map(cfg =>
        cfg.modelId === id ? { ...cfg, [field]: Math.max(1, value) } : cfg,
      ),
    );
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

      <section className="surface min-w-0 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Layers size={15} strokeWidth={1.9} />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">Global model strategy</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Account-wide baseline route and file-size tiers.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={handleGlobalUpdate}
            disabled={!globalDirty || saving !== null || !globalConfig}
            className="h-8 shrink-0 gap-2"
          >
            {saving === 'global'
              ? <RefreshCw size={14} className="animate-spin" />
              : <Save size={14} />}
            Save strategy
          </Button>
        </div>

        <div className="min-w-0">
          {!loading && globalConfig ? (
            <div className="p-4 sm:p-6">
              <ModelRouteEditor
                value={globalConfig}
                onChange={setGlobalConfig}
                density="comfortable"
              />
            </div>
          ) : (
            <div className="px-5 py-5 space-y-3">
              <Skeleton height={20} />
              <Skeleton height={20} width="80%" />
            </div>
          )}
        </div>
      </section>

      <section className="surface min-w-0 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-warning-bg text-warning">
              <ShieldAlert size={15} strokeWidth={1.9} />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">Model usage quotas</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Provider rate limits and token capacity per model.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSaveAllQuotas}
            disabled={dirtyConfigs.length === 0 || saving !== null}
            className="h-8 shrink-0 gap-2"
          >
            {saving === 'quotas'
              ? <RefreshCw size={14} className="animate-spin" />
              : <Save size={14} />}
            Save all quotas
          </Button>
        </div>

        {loading ? (
          <div>
            {[1, 2, 3].map(i => (
              <div key={i} className="px-5 py-4 border-b border-border/50 last:border-0">
                <Skeleton height={20} />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid min-w-0 grid-cols-1 gap-3 p-4 xl:grid-cols-2">
            {configs.map((cfg, i) => {
              const saved = savedConfigs.find(item => item.modelId === cfg.modelId);
              const dirty = !quotaEqual(cfg, saved);
              return (
                <article
                  key={cfg.modelId}
                  className={cn(
                    'min-w-0 rounded-md border border-border bg-background/55 p-4 transition-colors hover:bg-primary/[0.02]',
                    dirty && 'border-primary/30 bg-primary/[0.025]',
                  )}
                >
                  <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/8 text-primary">
                        <Cpu size={14} />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{cfg.modelId}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="rounded border border-border bg-muted/35 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                            {getProviderLabel(cfg.provider)}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            Updated {new Date(cfg.updatedAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={dirty ? 'outline' : 'ghost'}
                      disabled={!dirty || saving !== null}
                      onClick={() => handleUpdate(cfg.modelId)}
                      className="h-8 shrink-0 gap-1.5 text-xs"
                    >
                      {saving === cfg.modelId
                        ? <RefreshCw size={11} className="animate-spin" />
                        : <Save size={11} />}
                      Apply
                    </Button>
                  </div>

                  <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
                    {(['rpm', 'rpd', 'tpm'] as const).map(field => (
                    <label key={field} className="min-w-0 rounded-md border border-border bg-card/60 px-3 py-2.5">
                      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        <Gauge size={11} />
                        {field.toUpperCase()}
                      </span>
                      <input
                        type="number"
                        min={1}
                        value={cfg[field]}
                        onChange={e => updateQuota(cfg.modelId, field, Number(e.target.value) || 0)}
                        className="mt-2 h-8 min-w-0 w-full bg-transparent text-left text-lg font-semibold text-foreground outline-none"
                      />
                    </label>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}
