import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@client/lib/api';
import { PageHeader } from '@client/components/layout/page-header';
import { Button } from '@client/components/ui/button';
import { Alert } from '@client/components/ui/alert';
import { Skeleton } from '@client/components/shared/skeleton';
import { Input } from '@client/components/ui/input';
import { Select } from '@client/components/ui/select';
import { Switch } from '@client/components/ui/switch';
import {
  Cpu,
  Save,
  ShieldAlert,
  Layers,
  RefreshCw,
  PlugZap,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Search,
} from 'lucide-react';
import type { LlmApiFormat, LlmProvider, ModelConfig } from '@shared/schema';
import type { ModelConfigsResponse } from '@shared/api';
import {
  ModelRouteEditor,
  type ModelOption,
  type ModelRouteConfig,
  type ProviderOption,
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

const API_FORMAT_OPTIONS: Array<{ value: LlmApiFormat; label: string }> = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'gemini', label: 'Google' },
  { value: 'cloudflare-workers-ai', label: 'Cloudflare' },
];

const PROVIDER_PRESETS = [
  { value: 'custom-openai', label: 'Custom OpenAI-style API', apiFormat: 'openai' as const, baseUrl: '', name: 'Custom OpenAI', exampleUrl: 'https://api.example.com/v1' },
  { value: 'custom-anthropic', label: 'Custom Anthropic-style API', apiFormat: 'anthropic' as const, baseUrl: '', name: 'Custom Anthropic', exampleUrl: 'https://api.example.com/v1' },
  { value: 'custom-google', label: 'Custom Google-style API', apiFormat: 'gemini' as const, baseUrl: '', name: 'Custom Google', exampleUrl: 'https://generativelanguage.googleapis.com/v1beta' },
];

const FIXED_PROVIDER_NAMES = new Set(['OpenAI', 'OpenRouter', 'Anthropic', 'Google', 'Cloudflare']);

type ProviderDraft = LlmProvider & { apiKey: string };
type NewProviderDraft = {
  preset: string;
  name: string;
  apiFormat: LlmApiFormat;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
};
type NewModelDraft = {
  modelId: string;
  providerId: string;
  modelName: string;
  rpm: number;
  tpm: number;
  rpd: number;
};

type SyncError = { providerId: string; providerName: string; error: string };

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

function configEqual(a?: ModelConfig, b?: ModelConfig) {
  return Boolean(
    a && b &&
    a.rpm === b.rpm &&
    a.rpd === b.rpd &&
    a.tpm === b.tpm &&
    a.providerId === b.providerId &&
    a.modelName === b.modelName,
  );
}

function modelPayload(config: ModelConfig) {
  return {
    providerId: config.providerId,
    modelName: config.modelName,
    rpm: config.rpm,
    rpd: config.rpd,
    tpm: config.tpm,
  };
}

function providerToDraft(provider: LlmProvider): ProviderDraft {
  return { ...provider, apiKey: '' };
}

function formatLabel(format: LlmApiFormat) {
  return API_FORMAT_OPTIONS.find(option => option.value === format)?.label ?? format;
}

function isCustomProvider(provider: Pick<LlmProvider, 'name' | 'apiFormat'>) {
  return provider.apiFormat !== 'cloudflare-workers-ai' && !FIXED_PROVIDER_NAMES.has(provider.name);
}

function providerIsReady(provider: Pick<LlmProvider, 'enabled' | 'hasApiKey' | 'apiFormat'>) {
  return provider.enabled && (provider.hasApiKey || provider.apiFormat === 'cloudflare-workers-ai');
}

function providerStatusLabel(provider: Pick<LlmProvider, 'enabled' | 'hasApiKey' | 'apiFormat'>) {
  if (!provider.enabled) return 'Off';
  return providerIsReady(provider) ? 'Ready' : 'Needs key';
}

function providerDraftDirty(provider: ProviderDraft, saved?: LlmProvider) {
  if (!saved) return true;
  return (
    provider.name !== saved.name ||
    provider.apiFormat !== saved.apiFormat ||
    (provider.baseUrl ?? '') !== (saved.baseUrl ?? '') ||
    provider.enabled !== saved.enabled ||
    provider.apiKey.trim().length > 0
  );
}

export function SettingsPage() {
  const [providers, setProviders] = useState<ProviderDraft[]>([]);
  const [savedProviders, setSavedProviders] = useState<LlmProvider[]>([]);
  const [configs, setConfigs] = useState<ModelConfig[]>([]);
  const [savedConfigs, setSavedConfigs] = useState<ModelConfig[]>([]);
  const [globalConfig, setGlobalConfig] = useState<ModelRouteConfig | null>(null);
  const [savedGlobalConfig, setSavedGlobalConfig] = useState<ModelRouteConfig | null>(null);
  const [newProvider, setNewProvider] = useState<NewProviderDraft>({
    preset: 'custom-openai',
    name: 'Custom OpenAI',
    apiFormat: 'openai',
    baseUrl: '',
    apiKey: '',
    enabled: true,
  });
  const [newModel, setNewModel] = useState<NewModelDraft>({
    modelId: '',
    providerId: '',
    modelName: '',
    rpm: 60,
    tpm: 1_000_000,
    rpd: 1_000,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncErrors, setSyncErrors] = useState<SyncError[]>([]);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [catalogRefreshedOnce, setCatalogRefreshedOnce] = useState(false);
  const [addingProvider, setAddingProvider] = useState(false);
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState('');
  const [modelProviderFilter, setModelProviderFilter] = useState('all');
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null);

  const providerOptions: ProviderOption[] = useMemo(
    () => providers.map(provider => ({ value: provider.id, label: provider.name })),
    [providers],
  );

  const modelOptions: ModelOption[] = useMemo(
    () => configs.map(config => ({
      value: config.modelId,
      label: `${config.providerName} / ${config.modelName}`,
      providerId: config.providerId,
    })),
    [configs],
  );

  const existingProviderNames = useMemo(
    () => new Set(providers.map(provider => provider.name.toLowerCase())),
    [providers],
  );

  const selectedPreset = PROVIDER_PRESETS.find(preset => preset.value === newProvider.preset) ?? PROVIDER_PRESETS[0];
  const selectedProviderNameExists = existingProviderNames.has(newProvider.name.trim().toLowerCase());

  const providerModelCounts = useMemo(
    () => configs.reduce((counts, config) => {
      counts.set(config.providerId, (counts.get(config.providerId) ?? 0) + 1);
      return counts;
    }, new Map<string, number>()),
    [configs],
  );

  const globalDirty = useMemo(
    () => !routeEqual(globalConfig, savedGlobalConfig),
    [globalConfig, savedGlobalConfig],
  );

  const dirtyConfigs = useMemo(
    () => configs.filter(cfg => !configEqual(cfg, savedConfigs.find(saved => saved.modelId === cfg.modelId))),
    [configs, savedConfigs],
  );

  const modelProviderFilterOptions = useMemo(
    () => [
      { value: 'all', label: 'All providers' },
      ...providerOptions,
    ],
    [providerOptions],
  );

  const filteredConfigs = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();
    return configs.filter((config) => {
      const matchesProvider = modelProviderFilter === 'all' || config.providerId === modelProviderFilter;
      const matchesQuery = !query ||
        config.modelId.toLowerCase().includes(query) ||
        config.modelName.toLowerCase().includes(query) ||
        config.providerName.toLowerCase().includes(query);
      return matchesProvider && matchesQuery;
    });
  }, [configs, modelProviderFilter, modelSearch]);

  const applyModelConfigResponse = (modelsRes: ModelConfigsResponse) => {
    setProviders(modelsRes.providers.map(providerToDraft));
    setSavedProviders(modelsRes.providers);
    setConfigs(modelsRes.configs);
    setSavedConfigs(modelsRes.configs);
    setSyncErrors(modelsRes.syncErrors ?? []);
    setNewModel(current => ({
      ...current,
      providerId: current.providerId || modelsRes.providers[0]?.id || '',
    }));
  };

  const refreshModelCatalog = async ({ quiet = false }: { quiet?: boolean } = {}) => {
    if (catalogRefreshing) return;

    setCatalogRefreshing(true);
    setSyncErrors([]);
    const tid = quiet ? null : toast.loading('Refreshing model catalog...');
    try {
      const modelsRes = await api.refreshModelCatalog();
      applyModelConfigResponse(modelsRes);
      setCatalogRefreshedOnce(true);
      if (!quiet) {
        const failed = modelsRes.syncErrors?.length ?? 0;
        toast.success('Model catalog refreshed', {
          id: tid ?? undefined,
          description: failed > 0
            ? `${failed} provider${failed === 1 ? '' : 's'} reported an error.`
            : 'Provider model lists are now up to date.',
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Catalog refresh failed';
      setSyncErrors([{ providerId: 'catalog-refresh', providerName: 'Model catalog', error: msg }]);
      if (!quiet) {
        toast.error('Could not refresh catalog', { id: tid ?? undefined, description: msg });
      }
    } finally {
      setCatalogRefreshing(false);
    }
  };

  const loadConfigs = async () => {
    try {
      const [modelsRes, globalRes] = await Promise.all([
        api.getModelConfigs(),
        api.getGlobalConfig(),
      ]);
      const nextGlobalConfig = normalizeGlobalConfig(globalRes.config);
      applyModelConfigResponse(modelsRes);
      setGlobalConfig(nextGlobalConfig);
      setSavedGlobalConfig(nextGlobalConfig);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load settings';
      setError(msg);
      toast.error('Could not load settings', { description: 'Something went wrong fetching your configuration.' });
      return false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    loadConfigs().then((loaded) => {
      if (mounted && loaded) void refreshModelCatalog({ quiet: true });
    });
    return () => { mounted = false; };
  }, []);

  const handleGlobalUpdate = async () => {
    if (!globalConfig || !globalDirty) return;
    setSaving('global');
    setError(null);
    const tid = toast.loading('Saving model strategy...');
    try {
      await api.updateGlobalConfig(globalConfig);
      setSavedGlobalConfig(globalConfig);
      toast.success('Global strategy saved', {
        id: tid,
        description: 'Repositories without a custom strategy will use these settings.',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Update failed';
      setError(msg);
      toast.error('Could not save strategy', { id: tid, description: 'Your changes were not applied.' });
    } finally {
      setSaving(null);
    }
  };

  const updateProviderDraft = (id: string, updates: Partial<ProviderDraft>) => {
    setProviders(current => current.map(provider => provider.id === id ? { ...provider, ...updates } : provider));
  };

  const saveProvider = async (provider: ProviderDraft) => {
    setSaving(`provider:${provider.id}`);
    setError(null);
    const tid = toast.loading('Saving provider...');
    try {
      const payload: any = {
        name: provider.name,
        apiFormat: provider.apiFormat,
        baseUrl: provider.baseUrl || null,
        enabled: provider.enabled,
      };
      if (provider.apiKey.trim()) payload.apiKey = provider.apiKey.trim();
      const { provider: saved } = await api.updateProvider(provider.id, payload);
      setProviders(current => current.map(item => item.id === saved.id ? providerToDraft(saved) : item));
      setSavedProviders(current => current.map(item => item.id === saved.id ? saved : item));
      toast.success('Provider saved', { id: tid });
      if (saved.enabled && (saved.hasApiKey || saved.apiFormat === 'cloudflare-workers-ai')) {
        void refreshModelCatalog({ quiet: true });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Provider update failed';
      setError(msg);
      toast.error('Could not save provider', { id: tid, description: msg });
    } finally {
      setSaving(null);
    }
  };

  const createProvider = async () => {
    if (!newProvider.name.trim() || selectedProviderNameExists) return;
    setSaving('provider:new');
    setError(null);
    const tid = toast.loading('Creating provider...');
    try {
      const { provider } = await api.createProvider({
        name: newProvider.name.trim(),
        apiFormat: newProvider.apiFormat,
        baseUrl: newProvider.baseUrl.trim() || null,
        apiKey: newProvider.apiKey.trim() || undefined,
        enabled: newProvider.enabled,
      });
      setProviders(current => [...current, providerToDraft(provider)]);
      setSavedProviders(current => [...current, provider]);
      setNewProvider({
        preset: 'custom-openai',
        name: 'Custom OpenAI',
        apiFormat: 'openai',
        baseUrl: '',
        apiKey: '',
        enabled: true,
      });
      setNewModel(current => ({ ...current, providerId: current.providerId || provider.id }));
      setAddingProvider(false);
      toast.success('Provider created', { id: tid });
      if (provider.enabled && (provider.hasApiKey || provider.apiFormat === 'cloudflare-workers-ai')) {
        void refreshModelCatalog({ quiet: true });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Provider creation failed';
      setError(msg);
      toast.error('Could not create provider', { id: tid, description: msg });
    } finally {
      setSaving(null);
    }
  };

  const removeProvider = async (id: string) => {
    setSaving(`provider:${id}`);
    setError(null);
    const tid = toast.loading('Deleting provider...');
    try {
      await api.deleteProvider(id);
      setProviders(current => current.filter(provider => provider.id !== id));
      setSavedProviders(current => current.filter(provider => provider.id !== id));
      toast.success('Provider deleted', { id: tid });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Provider delete failed';
      setError(msg);
      toast.error('Could not delete provider', { id: tid, description: msg });
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
    const tid = toast.loading('Updating model...');
    try {
      const { config } = await api.updateModelConfig(id, modelPayload(current));
      markConfigSaved(id, config);
      toast.success('Model updated', { id: tid, description: 'Provider mapping and limits have been saved.' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Update failed';
      setError(msg);
      toast.error('Model update failed', { id: tid, description: msg });
    } finally {
      setSaving(null);
    }
  };

  const handleSaveAllModels = async () => {
    if (dirtyConfigs.length === 0) return;
    setSaving('models');
    setError(null);
    const tid = toast.loading(`Saving ${dirtyConfigs.length} model change${dirtyConfigs.length === 1 ? '' : 's'}...`);
    try {
      const saved = await Promise.all(dirtyConfigs.map(cfg => api.updateModelConfig(cfg.modelId, modelPayload(cfg))));
      const savedById = new Map(saved.map(result => [result.config.modelId, result.config]));
      setConfigs(current => current.map(cfg => savedById.get(cfg.modelId) ?? cfg));
      setSavedConfigs(current => current.map(cfg => savedById.get(cfg.modelId) ?? cfg));
      toast.success('Models saved', { id: tid });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Update failed';
      setError(msg);
      toast.error('Could not save models', { id: tid, description: msg });
    } finally {
      setSaving(null);
    }
  };

  const createModel = async () => {
    if (!newModel.modelId.trim() || !newModel.providerId || !newModel.modelName.trim()) return;
    setSaving('model:new');
    setError(null);
    const tid = toast.loading('Creating model...');
    try {
      const { config } = await api.updateModelConfig(newModel.modelId.trim(), {
        providerId: newModel.providerId,
        modelName: newModel.modelName.trim(),
        rpm: newModel.rpm,
        tpm: newModel.tpm,
        rpd: newModel.rpd,
      });
      setConfigs(current => [...current.filter(item => item.modelId !== config.modelId), config].sort((a, b) => a.modelId.localeCompare(b.modelId)));
      setSavedConfigs(current => [...current.filter(item => item.modelId !== config.modelId), config].sort((a, b) => a.modelId.localeCompare(b.modelId)));
      setNewModel(current => ({ ...current, modelId: '', modelName: '' }));
      toast.success('Model created', { id: tid });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Model creation failed';
      setError(msg);
      toast.error('Could not create model', { id: tid, description: msg });
    } finally {
      setSaving(null);
    }
  };

  const deleteModel = async (id: string) => {
    setSaving(id);
    setError(null);
    const tid = toast.loading('Deleting model...');
    try {
      await api.deleteModelConfig(id);
      setConfigs(current => current.filter(config => config.modelId !== id));
      setSavedConfigs(current => current.filter(config => config.modelId !== id));
      toast.success('Model deleted', { id: tid });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Delete failed';
      setError(msg);
      toast.error('Could not delete model', { id: tid, description: msg });
    } finally {
      setSaving(null);
    }
  };

  const testModel = async (id: string) => {
    setSaving(`test:${id}`);
    setError(null);
    const tid = toast.loading('Testing model connection...');
    try {
      const result = await api.testModelConfig(id);
      toast.success('Connection works', {
        id: tid,
        description: `${result.provider} returned ${result.outputTokens} output tokens.`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Connection failed';
      setError(msg);
      toast.error('Connection failed', { id: tid, description: msg });
    } finally {
      setSaving(null);
    }
  };

  const updateModel = (id: string, updates: Partial<ModelConfig>) => {
    setConfigs(current =>
      current.map(cfg =>
        cfg.modelId === id ? { ...cfg, ...updates } : cfg,
      ),
    );
  };

  const updateQuota = (id: string, field: 'rpm' | 'rpd' | 'tpm', value: number) => {
    updateModel(id, { [field]: Math.max(1, value) } as Partial<ModelConfig>);
  };

  const newProviderReady = newProvider.name.trim().length > 0 &&
    newProvider.baseUrl.trim().length > 0 &&
    newProvider.apiKey.trim().length > 0 &&
    !selectedProviderNameExists;

  const configuredProviderCount = providers.filter(providerIsReady).length;
  const customProviderCount = providers.filter(isCustomProvider).length;

  return (
    <section className="page-enter flex flex-col gap-6 pb-20">
      <PageHeader
        category="Defaults"
        title="Review settings"
        description="Choose provider credentials, custom models, default routes, and usage limits."
      />

      {error && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <span className="ml-2 font-semibold text-sm">{error}</span>
        </Alert>
      )}

      {syncErrors.length > 0 && (
        <Alert variant="warning">
          <div className="space-y-1">
            <p className="font-semibold">Some provider model catalogs could not refresh.</p>
            <p className="text-xs opacity-80">
              {syncErrors.map(item => `${item.providerName}: ${item.error}`).join(' | ')}
            </p>
          </div>
        </Alert>
      )}

      <section className="surface min-w-0 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <PlugZap size={15} strokeWidth={1.9} />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">LLM providers</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {configuredProviderCount} configured for model discovery and review routing.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshModelCatalog()}
            disabled={loading || catalogRefreshing || saving !== null}
            className="h-8 shrink-0 gap-2"
          >
            <RefreshCw size={13} className={cn(catalogRefreshing && 'animate-spin')} />
            Refresh models
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3 p-5">
            <Skeleton height={20} />
            <Skeleton height={20} width="80%" />
          </div>
        ) : (
          <div className="space-y-4 p-4 sm:p-6">
            <div className="min-w-0 overflow-hidden rounded-md border border-border bg-background/45">
              <div className="flex flex-col gap-3 border-b border-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="rounded border border-border bg-muted/25 px-2 py-1 font-medium">
                    {configuredProviderCount} ready
                  </span>
                  <span className="rounded border border-border bg-muted/25 px-2 py-1 font-medium">
                    {providers.length} providers
                  </span>
                  <span className="rounded border border-border bg-muted/25 px-2 py-1 font-medium">
                    {customProviderCount} custom
                  </span>
                  <span className="rounded border border-border bg-muted/25 px-2 py-1 font-medium">
                    {configs.length} models
                  </span>
                  <span className="text-xs">
                    {catalogRefreshing
                      ? 'Refreshing model lists...'
                      : catalogRefreshedOnce
                        ? 'Model lists refreshed this session.'
                        : 'Loaded from the database.'}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant={addingProvider ? 'outline' : 'default'}
                  onClick={() => setAddingProvider(current => !current)}
                  className="h-8 w-fit shrink-0 gap-2"
                >
                  <Plus size={13} />
                  {addingProvider ? 'Close' : 'Add provider'}
                </Button>
              </div>

              {addingProvider && (
                <div className="border-b border-border bg-muted/[0.035] p-4">
                  <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[200px_minmax(160px,1fr)_minmax(200px,1.2fr)_minmax(180px,1fr)_auto] lg:items-end">
                    <Select
                      label="Provider"
                      value={newProvider.preset}
                      onValueChange={value => {
                        const preset = PROVIDER_PRESETS.find(item => item.value === value) ?? PROVIDER_PRESETS[0];
                        setNewProvider(current => ({
                          ...current,
                          preset: preset.value,
                          name: preset.name,
                          apiFormat: preset.apiFormat,
                          baseUrl: preset.baseUrl,
                        }));
                      }}
                      options={PROVIDER_PRESETS.map(preset => ({ value: preset.value, label: preset.label }))}
                    />
                    <label className="block min-w-0">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                        Name
                      </span>
                      <Input
                        className="mt-1.5"
                        placeholder="Production vLLM"
                        value={newProvider.name}
                        onChange={e => setNewProvider(current => ({ ...current, name: e.target.value }))}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                        Base URL
                      </span>
                      <Input
                        className="mt-1.5"
                        placeholder={selectedPreset.exampleUrl}
                        value={newProvider.baseUrl}
                        onChange={e => setNewProvider(current => ({ ...current, baseUrl: e.target.value }))}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                        API key
                      </span>
                      <Input
                        className="mt-1.5"
                        type="password"
                        placeholder="Paste key"
                        value={newProvider.apiKey}
                        onChange={e => setNewProvider(current => ({ ...current, apiKey: e.target.value }))}
                      />
                    </label>
                    <Button
                      onClick={createProvider}
                      disabled={saving !== null || !newProviderReady}
                      className="h-9 gap-2"
                    >
                      {saving === 'provider:new' ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
                      {selectedProviderNameExists ? 'Name used' : 'Add'}
                    </Button>
                  </div>
                  {selectedProviderNameExists && (
                    <p className="mt-2 text-xs text-warning">
                      {newProvider.name.trim()} already exists.
                    </p>
                  )}
                </div>
              )}

              <div className="hidden border-b border-border bg-muted/10 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:grid lg:grid-cols-[minmax(180px,1.2fr)_130px_100px_minmax(130px,1fr)_180px]">
                <span>Provider</span>
                <span>Type</span>
                <span>Models</span>
                <span>Credential</span>
                <span className="text-right">Actions</span>
              </div>

              <div className="max-h-[28rem] divide-y divide-border/70 overflow-y-auto">
                  {providers.map(provider => {
                    const nativeCloudflare = provider.apiFormat === 'cloudflare-workers-ai';
                    const customProvider = isCustomProvider(provider);
                    const ready = providerIsReady(provider);
                    const savedProvider = savedProviders.find(saved => saved.id === provider.id);
                    const dirty = providerDraftDirty(provider, savedProvider);
                    const modelCount = providerModelCounts.get(provider.id) ?? 0;
                    const expanded = expandedProviderId === provider.id;
                    return (
                      <article
                        key={provider.id}
                        className={cn(
                          'min-w-0 transition-colors',
                          !provider.enabled && 'bg-muted/[0.03]',
                          dirty && 'bg-primary/[0.025]',
                        )}
                      >
                        <div className="grid min-w-0 gap-3 px-4 py-3 lg:grid-cols-[minmax(180px,1.2fr)_130px_100px_minmax(130px,1fr)_180px] lg:items-center">
                          <div className="flex min-w-0 items-start gap-3">
                            <span className={cn(
                              'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
                              ready ? 'bg-success-bg text-success' : provider.enabled ? 'bg-warning-bg text-warning' : 'bg-muted text-muted-foreground',
                            )}>
                              {ready ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                            </span>
                            <div className="min-w-0">
                              <h4 className="truncate py-1 text-sm font-semibold text-foreground">{provider.name}</h4>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                <span className={cn(
                                  'rounded border px-1.5 py-0.5 font-bold uppercase tracking-wide',
                                  ready
                                    ? 'border-success-border bg-success-bg text-success'
                                    : provider.enabled
                                      ? 'border-warning-border bg-warning-bg text-warning'
                                      : 'border-border bg-muted/30 text-muted-foreground',
                                )}>
                                  {providerStatusLabel(provider)}
                                </span>
                                <span className="lg:hidden">{formatLabel(provider.apiFormat)}</span>
                                <span className="lg:hidden">{modelCount} {modelCount === 1 ? 'model' : 'models'}</span>
                              </div>
                            </div>
                          </div>

                          <p className="text-xs text-muted-foreground">{formatLabel(provider.apiFormat)}</p>
                          <p className="text-xs text-muted-foreground">{modelCount}</p>
                          <p className="text-xs text-muted-foreground">
                            {nativeCloudflare ? 'Worker AI binding' : provider.hasApiKey ? 'Saved key hidden' : 'No API key'}
                          </p>

                          <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
                            <label className="flex h-8 items-center gap-2 rounded-md border border-border bg-muted/10 px-2.5 text-xs text-muted-foreground">
                              <span>{provider.enabled ? 'On' : 'Off'}</span>
                              <Switch
                                checked={provider.enabled}
                                onCheckedChange={enabled => updateProviderDraft(provider.id, { enabled })}
                              />
                            </label>
                            <Button
                              size="sm"
                              variant={expanded ? 'outline' : 'ghost'}
                              onClick={() => setExpandedProviderId(expanded ? null : provider.id)}
                              className="h-8 text-xs"
                            >
                              {expanded ? 'Close' : 'Edit'}
                            </Button>
                            <Button
                              size="sm"
                              variant={dirty ? 'default' : 'outline'}
                              onClick={() => saveProvider(provider)}
                              disabled={saving !== null || !dirty}
                              className="h-8 gap-1.5 text-xs"
                            >
                              {saving === `provider:${provider.id}` ? <RefreshCw size={11} className="animate-spin" /> : <Save size={11} />}
                              Save
                            </Button>
                            {customProvider && (
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label="Delete provider"
                                onClick={() => removeProvider(provider.id)}
                                disabled={saving !== null}
                                className="h-8 w-8 text-muted-foreground/55 hover:bg-danger/5 hover:text-danger"
                              >
                                <Trash2 size={13} />
                              </Button>
                            )}
                          </div>
                        </div>

                        {expanded && (
                          <div className="border-t border-border/60 bg-muted/[0.04] px-4 py-3">
                            {customProvider && (
                              <div className="mb-3 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-[minmax(160px,0.8fr)_160px_minmax(220px,1.4fr)]">
                                <label className="block min-w-0">
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                                    Name
                                  </span>
                                  <Input
                                    className="mt-1.5"
                                    value={provider.name}
                                    onChange={e => updateProviderDraft(provider.id, { name: e.target.value })}
                                  />
                                </label>
                                <Select
                                  label="Type"
                                  value={provider.apiFormat}
                                  onValueChange={value => updateProviderDraft(provider.id, { apiFormat: value as LlmApiFormat })}
                                  options={API_FORMAT_OPTIONS.filter(option => option.value !== 'cloudflare-workers-ai')}
                                />
                                <label className="block min-w-0">
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                                    Base URL
                                  </span>
                                  <Input
                                    className="mt-1.5"
                                    placeholder="https://llm.example.com/v1"
                                    value={provider.baseUrl ?? ''}
                                    onChange={e => updateProviderDraft(provider.id, { baseUrl: e.target.value || null })}
                                  />
                                </label>
                              </div>
                            )}

                            {nativeCloudflare ? (
                              <div className="rounded-md border border-border bg-muted/15 px-3 py-2.5 text-xs text-muted-foreground">
                                Native provider. Calls use the Worker AI binding configured in Wrangler.
                              </div>
                            ) : (
                              <label className="block min-w-0">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                                  API key
                                </span>
                                <Input
                                  className="mt-1.5 max-w-xl"
                                  type="password"
                                  placeholder={provider.hasApiKey ? 'Enter a new key to replace the saved key' : 'Paste key'}
                                  value={provider.apiKey}
                                  onChange={e => updateProviderDraft(provider.id, { apiKey: e.target.value })}
                                />
                              </label>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
              </div>
            </div>
          </div>
        )}
      </section>

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
                models={modelOptions}
                providers={providerOptions}
                density="comfortable"
              />
            </div>
          ) : (
            <div className="space-y-3 px-5 py-5">
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
              <h2 className="text-base font-semibold text-foreground">Models and usage limits</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Codra model IDs, provider model names, and rate metadata.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSaveAllModels}
            disabled={dirtyConfigs.length === 0 || saving !== null}
            className="h-8 shrink-0 gap-2"
          >
            {saving === 'models'
              ? <RefreshCw size={14} className="animate-spin" />
              : <Save size={14} />}
            Save all models
          </Button>
        </div>

        {loading ? (
          <div>
            {[1, 2, 3].map(i => (
              <div key={i} className="border-b border-border/50 px-5 py-4 last:border-0">
                <Skeleton height={20} />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4 p-4">
            <div className="rounded-md border border-border bg-muted/10 p-4">
              <div className="mb-3 flex min-w-0 items-center gap-2 text-xs font-semibold text-foreground">
                <Plus size={13} />
                Add custom model
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(150px,1fr)_minmax(150px,1fr)_180px_76px_76px_92px_auto] lg:items-end">
                <Input
                  placeholder="Codra model ID"
                  value={newModel.modelId}
                  onChange={e => setNewModel(current => ({ ...current, modelId: e.target.value }))}
                />
                <Input
                  placeholder="Provider model name"
                  value={newModel.modelName}
                  onChange={e => setNewModel(current => ({ ...current, modelName: e.target.value }))}
                />
                <Select
                  value={newModel.providerId}
                  onValueChange={providerId => setNewModel(current => ({ ...current, providerId }))}
                  options={providerOptions}
                  placeholder="Provider"
                />
                {(['rpm', 'rpd', 'tpm'] as const).map(field => (
                  <Input
                    key={field}
                    type="number"
                    min={1}
                    aria-label={field.toUpperCase()}
                    value={newModel[field]}
                    onChange={e => setNewModel(current => ({ ...current, [field]: Number(e.target.value) || 1 }))}
                  />
                ))}
                <Button
                  size="sm"
                  onClick={createModel}
                  disabled={saving !== null || !newModel.modelId.trim() || !newModel.modelName.trim() || !newModel.providerId}
                  className="h-9 gap-2"
                >
                  {saving === 'model:new' ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
                  Add
                </Button>
              </div>
            </div>

            <div className="rounded-md border border-border bg-background/45">
              <div className="grid min-w-0 grid-cols-1 gap-3 border-b border-border p-3 lg:grid-cols-[minmax(220px,1fr)_180px_auto] lg:items-center">
                <label className="relative min-w-0">
                  <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/55" />
                  <Input
                    className="pl-9"
                    placeholder="Search models"
                    value={modelSearch}
                    onChange={e => setModelSearch(e.target.value)}
                  />
                </label>
                <Select
                  value={modelProviderFilter}
                  onValueChange={setModelProviderFilter}
                  options={modelProviderFilterOptions}
                />
                <p className="text-xs text-muted-foreground lg:text-right">
                  {filteredConfigs.length} of {configs.length} models
                </p>
              </div>

              <div className="hidden border-b border-border bg-muted/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground lg:grid lg:grid-cols-[minmax(220px,1.6fr)_140px_minmax(180px,1fr)_190px_160px]">
                <span>Model</span>
                <span>Provider</span>
                <span>Provider model</span>
                <span>Limits</span>
                <span className="text-right">Actions</span>
              </div>

              <div className="max-h-[46rem] overflow-y-auto">
                {filteredConfigs.map((cfg) => {
                  const saved = savedConfigs.find(item => item.modelId === cfg.modelId);
                  const dirty = !configEqual(cfg, saved);
                  const expanded = expandedModelId === cfg.modelId;
                  return (
                    <article
                      key={cfg.modelId}
                      className={cn(
                        'border-b border-border/60 last:border-b-0',
                        dirty && 'bg-primary/[0.025]',
                      )}
                    >
                      <div className="grid min-w-0 grid-cols-1 gap-3 px-3 py-3 lg:grid-cols-[minmax(220px,1.6fr)_140px_minmax(180px,1fr)_190px_160px] lg:items-center">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/8 text-primary">
                            <Cpu size={13} />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-foreground">{cfg.modelId}</p>
                            <p className="truncate text-[11px] text-muted-foreground lg:hidden">{cfg.modelName}</p>
                          </div>
                        </div>
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="rounded border border-border bg-muted/35 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                            {cfg.providerName}
                          </span>
                          <span className="text-[11px] text-muted-foreground">{formatLabel(cfg.apiFormat)}</span>
                        </div>
                        <p className="hidden truncate text-xs text-muted-foreground lg:block">{cfg.modelName}</p>
                        <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                          <span className="rounded border border-border bg-muted/20 px-1.5 py-0.5">RPM {cfg.rpm}</span>
                          <span className="rounded border border-border bg-muted/20 px-1.5 py-0.5">RPD {cfg.rpd}</span>
                          <span className="rounded border border-border bg-muted/20 px-1.5 py-0.5">TPM {cfg.tpm}</span>
                        </div>
                        <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={saving !== null}
                            onClick={() => testModel(cfg.modelId)}
                            className="h-8 gap-1.5 text-xs"
                          >
                            {saving === `test:${cfg.modelId}`
                              ? <RefreshCw size={11} className="animate-spin" />
                              : <PlugZap size={11} />}
                            Test
                          </Button>
                          <Button
                            size="sm"
                            variant={expanded ? 'outline' : 'ghost'}
                            onClick={() => setExpandedModelId(expanded ? null : cfg.modelId)}
                            className="h-8 text-xs"
                          >
                            {expanded ? 'Close' : 'Edit'}
                          </Button>
                          <Button
                            size="sm"
                            variant={dirty ? 'outline' : 'ghost'}
                            disabled={!dirty || saving !== null}
                            onClick={() => handleUpdate(cfg.modelId)}
                            className="h-8 gap-1.5 text-xs"
                          >
                            {saving === cfg.modelId
                              ? <RefreshCw size={11} className="animate-spin" />
                              : <Save size={11} />}
                            Apply
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Delete model"
                            disabled={saving !== null}
                            onClick={() => deleteModel(cfg.modelId)}
                            className="h-8 w-8 text-muted-foreground/55 hover:bg-danger/5 hover:text-danger"
                          >
                            <Trash2 size={13} />
                          </Button>
                        </div>
                      </div>

                      {expanded && (
                        <div className="border-t border-border/60 bg-muted/[0.04] px-3 py-3">
                          <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[180px_minmax(220px,1fr)_90px_90px_110px]">
                            <Select
                              label="Provider"
                              value={cfg.providerId}
                              onValueChange={providerId => updateModel(cfg.modelId, { providerId })}
                              options={providerOptions}
                            />
                            <label className="min-w-0">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                Provider model name
                              </span>
                              <Input
                                value={cfg.modelName}
                                onChange={e => updateModel(cfg.modelId, { modelName: e.target.value })}
                                className="mt-1.5"
                              />
                            </label>
                            {(['rpm', 'rpd', 'tpm'] as const).map(field => (
                              <label key={field} className="min-w-0">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                  {field.toUpperCase()}
                                </span>
                                <Input
                                  type="number"
                                  min={1}
                                  value={cfg[field]}
                                  onChange={e => updateQuota(cfg.modelId, field, Number(e.target.value) || 0)}
                                  className="mt-1.5"
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}

                {filteredConfigs.length === 0 && (
                  <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No models match the current filters.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </section>
  );
}
