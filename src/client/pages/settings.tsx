import { useEffect, useMemo, useState } from 'react';
import pkg from '../../../package.json';
import { toast } from 'sonner';
import { api, type ProviderPayload } from '@client/lib/api';
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
  Search,
  ChevronDown,
  ChevronRight,
  X,
  Tag,
  ExternalLink,
  GitCommit,
} from 'lucide-react';
import type { LlmApiFormat, LlmProvider, ModelConfig, RepoConfig } from '@shared/schema';
import type { ModelConfigsResponse } from '@shared/api';
import {
  ModelRouteEditor,
  type ModelOption,
  type ModelRouteConfig,
  type ProviderOption,
} from '@client/components/features/models/model-chain';
import { cn } from '@client/lib/utils';

const EMPTY_GLOBAL_CONFIG: ModelRouteConfig = {
  main: null,
  fallbacks: [],
  size_overrides: [],
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
  rpm: number | null;
  tpm: number | null;
  rpd: number | null;
};

type SyncError = { providerId: string; providerName: string; error: string };

type GlobalConfigInput = RepoConfig['model'] | Partial<ModelRouteConfig> | null | undefined;

export function normalizeGlobalConfig(config: GlobalConfigInput): ModelRouteConfig {
  return {
    main: typeof config?.main === 'string' && config.main.trim() ? config.main : null,
    fallbacks: Array.isArray(config?.fallbacks) ? config.fallbacks : EMPTY_GLOBAL_CONFIG.fallbacks,
    size_overrides: Array.isArray(config?.size_overrides) ? config.size_overrides : EMPTY_GLOBAL_CONFIG.size_overrides,
  };
}

function stringArraysEqual(a: string[] = [], b: string[] = []) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function tiersEqual(a: ModelRouteConfig['size_overrides'] = [], b: ModelRouteConfig['size_overrides'] = []) {
  return a.length === b.length && a.every((tier, index) => {
    const other = b[index];
    return Boolean(
      other &&
      tier.max_lines === other.max_lines &&
      tier.model === other.model &&
      stringArraysEqual(tier.fallbacks ?? [], other.fallbacks ?? []),
    );
  });
}

function routeEqual(a: ModelRouteConfig | null, b: ModelRouteConfig | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.main === b.main &&
    stringArraysEqual(a.fallbacks ?? [], b.fallbacks ?? []) &&
    tiersEqual(a.size_overrides ?? [], b.size_overrides ?? [])
  );
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

function parseOptionalLimit(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function formatOptionalLimit(value: number | null) {
  return value === null ? 'Unset' : value.toLocaleString();
}

function providerToDraft(provider: LlmProvider): ProviderDraft {
  return { ...provider, apiKey: '' };
}

function formatLabel(format: LlmApiFormat) {
  return API_FORMAT_OPTIONS.find(option => option.value === format)?.label ?? format;
}

function domId(prefix: string, value: string) {
  return `${prefix}-${value.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
}

function isCustomProvider(provider: Pick<LlmProvider, 'name' | 'apiFormat'>) {
  return provider.apiFormat !== 'cloudflare-workers-ai' && !FIXED_PROVIDER_NAMES.has(provider.name);
}

function providerIsReady(provider: Pick<LlmProvider, 'enabled' | 'hasApiKey' | 'apiFormat'>) {
  return provider.enabled && (provider.hasApiKey || provider.apiFormat === 'cloudflare-workers-ai');
}

function providerHasCredential(provider: Pick<ProviderDraft, 'hasApiKey' | 'apiFormat' | 'apiKey'>) {
  return provider.apiFormat === 'cloudflare-workers-ai' || provider.hasApiKey || provider.apiKey.trim().length > 0;
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

/* ─── Section wrapper ─────────────────────────────────────────────────────── */
function SectionCard({
  icon,
  title,
  description,
  action,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="surface min-w-0 overflow-hidden">
      <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          {icon && (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            <p className="truncate text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/* ─── Field label ─────────────────────────────────────────────────────────── */
function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
      {children}
    </label>
  );
}

/* ─── Stat pill ───────────────────────────────────────────────────────────── */
function StatPill({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-border bg-muted/30 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
      {label}
    </span>
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
    rpm: null,
    tpm: null,
    rpd: null,
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
  const [addingModel, setAddingModel] = useState(false);

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
      if (!quiet) toast.error('Could not refresh catalog', { id: tid ?? undefined, description: msg });
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
    if (provider.enabled && !providerHasCredential(provider)) {
      setExpandedProviderId(provider.id);
      toast.error('Add an API key before enabling this provider.');
      return;
    }

    setSaving(`provider:${provider.id}`);
    setError(null);
    const tid = toast.loading('Saving provider...');
    try {
      const payload: ProviderPayload = {
        name: provider.name,
        apiFormat: provider.apiFormat,
        baseUrl: provider.baseUrl || null,
        enabled: provider.enabled,
      };
      if (provider.apiKey !== undefined && providerDraftDirty(provider)) {
        if (provider.apiKey.trim()) {
          payload.apiKey = provider.apiKey.trim();
        } else {
          payload.clearApiKey = true;
        }
      }
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
      const results = await Promise.allSettled(dirtyConfigs.map(cfg => api.updateModelConfig(cfg.modelId, modelPayload(cfg))));
      const saved = results
        .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof api.updateModelConfig>>> => result.status === 'fulfilled')
        .map(result => result.value);
      const failed = results.length - saved.length;

      const savedById = new Map(saved.map(result => [result.config.modelId, result.config]));
      setConfigs(current => current.map(cfg => savedById.get(cfg.modelId) ?? cfg));
      setSavedConfigs(current => current.map(cfg => savedById.get(cfg.modelId) ?? cfg));

      if (failed > 0) {
        const msg = `${failed} model update${failed === 1 ? '' : 's'} failed. Saved ${saved.length}.`;
        setError(msg);
        toast.error('Some models were not saved', { id: tid, description: msg });
      } else {
        toast.success('Models saved', { id: tid });
      }
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
      setAddingModel(false);
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

  const updateQuota = (id: string, field: 'rpm' | 'rpd' | 'tpm', value: number | null) => {
    updateModel(id, { [field]: value } as Partial<ModelConfig>);
  };

  const newProviderReady = newProvider.name.trim().length > 0 &&
    newProvider.baseUrl.trim().length > 0 &&
    newProvider.apiKey.trim().length > 0 &&
    !selectedProviderNameExists;

  const configuredProviderCount = providers.filter(providerIsReady).length;

  return (
    <section className="page-enter flex flex-col gap-5 pb-20">
      <PageHeader
        category="Defaults"
        title="Settings"
        description="Manage LLM providers, model routing, and usage limits."
      />


          {error && (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <span className="ml-2 text-sm font-medium">{error}</span>
            </Alert>
          )}

          {syncErrors.length > 0 && (
            <Alert variant="warning">
              <div className="space-y-0.5">
                <p className="font-semibold text-sm">Some provider catalogs could not refresh</p>
                <p className="text-xs opacity-75">
                  {syncErrors.map(item => `${item.providerName}: ${item.error}`).join(' · ')}
                </p>
              </div>
            </Alert>
          )}

          {/* ── LLM Providers ──────────────────────────────────────────────────── */}
          <section className="surface min-w-0 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">LLM Providers</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {loading ? 'Loading…' : `${configuredProviderCount} of ${providers.length} configured`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => refreshModelCatalog()}
              disabled={loading || catalogRefreshing || saving !== null}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            >
              <RefreshCw size={13} className={cn(catalogRefreshing && 'animate-spin')} />
              {catalogRefreshing ? 'Syncing…' : 'Sync'}
            </button>
            <button
              type="button"
              onClick={() => setAddingProvider(v => !v)}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors',
                addingProvider
                  ? 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground'
                  : 'bg-primary text-primary-foreground hover:opacity-90',
              )}
            >
              {addingProvider ? <X size={13} /> : <Plus size={13} />}
              {addingProvider ? 'Cancel' : 'Add'}
            </button>
          </div>
        </div>

        {/* Add provider form */}
        {addingProvider && (
          <div className="animate-slide-down border-b border-border bg-muted/[0.04] px-4 py-5 sm:px-5 sm:py-6">
            <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              New provider
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="new-provider-type">Protocol</FieldLabel>
                <Select
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
              </div>
              <div>
                <FieldLabel htmlFor="new-provider-name">Display name</FieldLabel>
                <Input
                  id="new-provider-name"
                  placeholder="My provider"
                  value={newProvider.name}
                  onChange={e => setNewProvider(current => ({ ...current, name: e.target.value }))}
                />
                {selectedProviderNameExists && (
                  <p className="mt-1.5 text-xs text-warning">{newProvider.name.trim()} already exists</p>
                )}
              </div>
              <div>
                <FieldLabel htmlFor="new-provider-base-url">Base URL</FieldLabel>
                <Input
                  id="new-provider-base-url"
                  placeholder={selectedPreset.exampleUrl}
                  value={newProvider.baseUrl}
                  onChange={e => setNewProvider(current => ({ ...current, baseUrl: e.target.value }))}
                />
              </div>
              <div>
                <FieldLabel htmlFor="new-provider-api-key">API key</FieldLabel>
                <Input
                  id="new-provider-api-key"
                  type="password"
                  placeholder="sk-…"
                  value={newProvider.apiKey}
                  onChange={e => setNewProvider(current => ({ ...current, apiKey: e.target.value }))}
                />
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setAddingProvider(false)}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={createProvider}
                disabled={saving !== null || !newProviderReady}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40"
              >
                {saving === 'provider:new' ? <RefreshCw size={11} className="animate-spin" /> : <Plus size={11} />}
                Create
              </button>
            </div>
          </div>
        )}

        {/* Provider list */}
        {loading ? (
          <div className="divide-y divide-border/40">
            {[148, 148, 148].map((h, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4 sm:px-5">
                <div className="flex-1 space-y-2">
                  <Skeleton height={13} width="40%" />
                  <Skeleton height={11} width="25%" />
                </div>
                <Skeleton height={20} width={36} />
              </div>
            ))}
          </div>
        ) : providers.length === 0 && !addingProvider ? (
          <div className="px-5 py-14 text-center">
            <p className="text-sm font-medium text-foreground">No providers yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Add one to start routing models.</p>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {providers.map(provider => {
              const nativeCloudflare = provider.apiFormat === 'cloudflare-workers-ai';
              const customProvider = isCustomProvider(provider);
              const savedProvider = savedProviders.find(saved => saved.id === provider.id);
              const dirty = providerDraftDirty(provider, savedProvider);
              const modelCount = providerModelCounts.get(provider.id) ?? 0;
              const expanded = expandedProviderId === provider.id;
              const canEnableProvider = providerHasCredential(provider);
              const ready = providerIsReady(provider);
              const providerNameId = domId('provider-name', provider.id);
              const providerBaseUrlId = domId('provider-base-url', provider.id);
              const providerApiKeyId = domId('provider-api-key', provider.id);

              return (
                <article
                  key={provider.id}
                  className={cn(
                    'group min-w-0 transition-colors duration-150',
                    dirty && 'bg-primary/[0.018]',
                  )}
                >
                  {/* Row */}
                  <div className="flex min-w-0 items-center gap-3 px-4 py-4 sm:gap-4 sm:px-5">

                    {/* Name + meta */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{provider.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        <span className="font-mono">{provider.apiFormat}</span>
                        {modelCount > 0 && (
                          <span className="ml-2 opacity-70">· {modelCount} model{modelCount !== 1 ? 's' : ''}</span>
                        )}
                      </p>
                    </div>

                    {/* Credential — hidden on smallest screens */}
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                      {nativeCloudflare
                        ? 'Worker binding'
                        : provider.hasApiKey
                          ? 'Key saved'
                          : <span className="text-warning">No key</span>
                      }
                    </span>

                    {/* Controls */}
                    <div className="flex shrink-0 items-center gap-1">
                      {/* Save — only visible when dirty */}
                      {dirty && (
                        <button
                          type="button"
                          onClick={() => saveProvider(provider)}
                          disabled={saving !== null}
                          className="animate-fade-in mr-1 inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                          {saving === `provider:${provider.id}` ? <RefreshCw size={10} className="animate-spin" /> : <Save size={10} />}
                          Save
                        </button>
                      )}

                      <Switch
                        checked={provider.enabled && canEnableProvider}
                        onCheckedChange={enabled => {
                          if (enabled && !canEnableProvider) {
                            setExpandedProviderId(provider.id);
                            toast.error('Add an API key before enabling this provider.');
                            return;
                          }
                          updateProviderDraft(provider.id, { enabled });
                        }}
                      />

                      <button
                        type="button"
                        onClick={() => setExpandedProviderId(expanded ? null : provider.id)}
                        aria-label={expanded ? 'Collapse' : 'Configure'}
                        className={cn(
                          'ml-0.5 inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors',
                          expanded
                            ? 'text-foreground'
                            : 'text-muted-foreground/60 hover:text-muted-foreground',
                        )}
                      >
                        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </button>

                      {customProvider && (
                        <button
                          type="button"
                          aria-label="Delete provider"
                          onClick={() => removeProvider(provider.id)}
                          disabled={saving !== null}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/40 transition-colors hover:text-danger disabled:pointer-events-none group-hover:text-muted-foreground/70"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded edit panel */}
                  {expanded && (
                    <div className="animate-slide-down border-t border-border/40 bg-muted/[0.04] px-4 py-5 sm:px-5">
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {customProvider && (
                          <>
                            <div>
                              <FieldLabel htmlFor={providerNameId}>Display name</FieldLabel>
                              <Input
                                id={providerNameId}
                                value={provider.name}
                                onChange={e => updateProviderDraft(provider.id, { name: e.target.value })}
                              />
                            </div>
                            <Select
                              label="Protocol"
                              value={provider.apiFormat}
                              onValueChange={value => updateProviderDraft(provider.id, { apiFormat: value as LlmApiFormat })}
                              options={API_FORMAT_OPTIONS.filter(option => option.value !== 'cloudflare-workers-ai')}
                            />
                            <div>
                              <FieldLabel htmlFor={providerBaseUrlId}>Base URL</FieldLabel>
                              <Input
                                id={providerBaseUrlId}
                                placeholder="https://llm.example.com/v1"
                                value={provider.baseUrl ?? ''}
                                onChange={e => updateProviderDraft(provider.id, { baseUrl: e.target.value || null })}
                              />
                            </div>
                          </>
                        )}
                        {nativeCloudflare ? (
                          <p className="col-span-full text-xs text-muted-foreground">
                            Uses the Worker AI binding defined in your Wrangler configuration.
                          </p>
                        ) : (
                          <div className="col-span-full">
                            <FieldLabel htmlFor={providerApiKeyId}>API key</FieldLabel>
                            <Input
                              id={providerApiKeyId}
                              type="password"
                              placeholder={provider.hasApiKey ? 'Enter a new key to replace the saved one' : 'sk-…'}
                              value={provider.apiKey}
                              onChange={e => updateProviderDraft(provider.id, { apiKey: e.target.value })}
                              className="max-w-sm"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}

        {/* Footer */}
        {!loading && (
          <div className="border-t border-border/30 px-4 py-2.5 sm:px-5">
            <p className="text-xs text-muted-foreground/60">
              {catalogRefreshing
                ? 'Syncing model lists…'
                : catalogRefreshedOnce
                  ? 'Synced this session'
                  : 'Loaded from database'}
            </p>
          </div>
        )}
      </section>

      {/* ── Global model strategy ───────────────────────────────────────────── */}
      <SectionCard
        title="Global model strategy"
        description="Account-wide baseline route and file-size tiers"
        action={
          <Button
            size="sm"
            onClick={handleGlobalUpdate}
            disabled={!globalDirty || saving !== null || !globalConfig}
            className="h-8 gap-1.5 text-xs"
          >
            {saving === 'global' ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
            Save strategy
          </Button>
        }
      >
        <div className="p-5">
          {!loading && globalConfig ? (
            <ModelRouteEditor
              value={globalConfig}
              onChange={setGlobalConfig}
              models={modelOptions}
              providers={providerOptions}
              density="comfortable"
            />
          ) : (
            <div className="space-y-3">
              <Skeleton height={20} />
              <Skeleton height={20} width="70%" />
            </div>
          )}
        </div>
      </SectionCard>

      {/* ── Models & Usage Limits ────────────────────────────────────────────── */}
      <SectionCard
        title="Models & usage limits"
        description={`${configs.length} models · provider mappings and rate limits`}
        action={
          <div className="flex items-center gap-2">
            {dirtyConfigs.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleSaveAllModels}
                disabled={saving !== null}
                className="h-8 gap-1.5 text-xs"
              >
                {saving === 'models' ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
                Save all ({dirtyConfigs.length})
              </Button>
            )}
            <Button
              size="sm"
              variant={addingModel ? 'outline' : 'default'}
              onClick={() => setAddingModel(v => !v)}
              className="h-8 gap-1.5 text-xs"
            >
              {addingModel ? <X size={12} /> : <Plus size={12} />}
              {addingModel ? 'Cancel' : 'Add model'}
            </Button>
          </div>
        }
      >
        {/* Add model form */}
        {addingModel && (
          <div className="border-b border-border bg-muted/[0.03] p-5">
            <p className="mb-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">New model</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <FieldLabel htmlFor="new-model-id">Codra model ID</FieldLabel>
                <Input
                  id="new-model-id"
                  placeholder="e.g. gemma-4-31b-it"
                  value={newModel.modelId}
                  onChange={e => setNewModel(current => ({ ...current, modelId: e.target.value }))}
                />
              </div>
              <div>
                <FieldLabel htmlFor="new-model-name">Provider model name</FieldLabel>
                <Input
                  id="new-model-name"
                  placeholder="e.g. gemma-4-31b-it"
                  value={newModel.modelName}
                  onChange={e => setNewModel(current => ({ ...current, modelName: e.target.value }))}
                />
              </div>
              <Select
                label="Provider"
                value={newModel.providerId}
                onValueChange={providerId => setNewModel(current => ({ ...current, providerId }))}
                options={providerOptions}
                placeholder="Select provider"
              />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 sm:max-w-xs">
              {(['rpm', 'rpd', 'tpm'] as const).map(field => (
                <div key={field}>
                  <FieldLabel htmlFor={`new-model-${field}`}>{field.toUpperCase()}</FieldLabel>
                  <Input
                    id={`new-model-${field}`}
                    type="number"
                    min={1}
                    value={newModel[field] ?? ''}
                    placeholder="None"
                    onChange={e => setNewModel(current => ({ ...current, [field]: parseOptionalLimit(e.target.value) }))}
                  />
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-end">
              <Button
                size="sm"
                onClick={createModel}
                disabled={saving !== null || !newModel.modelId.trim() || !newModel.modelName.trim() || !newModel.providerId}
                className="h-8 gap-1.5 text-xs"
              >
                {saving === 'model:new' ? <RefreshCw size={12} className="animate-spin" /> : <Plus size={12} />}
                Create model
              </Button>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col gap-2 border-b border-border px-5 py-3 sm:flex-row sm:items-center">
          <label className="relative min-w-0 flex-1">
            <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
            <Input
              className="pl-8 text-sm"
              placeholder="Search models…"
              value={modelSearch}
              onChange={e => setModelSearch(e.target.value)}
            />
          </label>
          <div className="shrink-0 sm:w-44">
            <Select
              value={modelProviderFilter}
              onValueChange={setModelProviderFilter}
              options={modelProviderFilterOptions}
            />
          </div>
          <p className="shrink-0 text-xs text-muted-foreground">
            {filteredConfigs.length}/{configs.length}
          </p>
        </div>

        {/* Model list */}
        {loading ? (
          <div className="space-y-0 divide-y divide-border/50">
            {[1, 2, 3].map(i => (
              <div key={i} className="px-5 py-4">
                <Skeleton height={18} />
              </div>
            ))}
          </div>
        ) : (
          <div className="max-h-[520px] overflow-y-auto divide-y divide-border/50 scroll-smooth [scrollbar-width:thin]">
            {filteredConfigs.map((cfg) => {
              const saved = savedConfigs.find(item => item.modelId === cfg.modelId);
              const dirty = !configEqual(cfg, saved);
              const expanded = expandedModelId === cfg.modelId;
              const providerModelNameId = domId('model-provider-name', cfg.modelId);

              return (
                <article
                  key={cfg.modelId}
                  className={cn(
                    'min-w-0 transition-colors',
                    dirty && 'bg-primary/[0.02]',
                  )}
                >
                  {/* Row */}
                  <div className="flex min-w-0 items-center gap-3 px-5 py-3">
                    {/* Icon */}
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/50 text-muted-foreground">
                      <Cpu size={12} />
                    </span>

                    {/* Model info */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{cfg.modelId}</p>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="rounded border border-border/60 bg-muted/30 px-1.5 py-0.5 font-medium">
                          {cfg.providerName}
                        </span>
                        <span className="hidden sm:inline truncate opacity-70">{cfg.modelName}</span>
                      </div>
                    </div>

                    {/* Rate limits — compact pills */}
                    <div className="hidden items-center gap-1 xl:flex">
                      {(['rpm', 'rpd', 'tpm'] as const).map(field => (
                        <span key={field} className="rounded border border-border/50 bg-muted/20 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                          {field.toUpperCase()} {formatOptionalLimit(cfg[field])}
                        </span>
                      ))}
                    </div>

                    {/* Actions */}
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={saving !== null}
                        onClick={() => testModel(cfg.modelId)}
                        className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                        aria-label="Test connection"
                      >
                        {saving === `test:${cfg.modelId}` ? <RefreshCw size={11} className="animate-spin" /> : <PlugZap size={11} />}
                        <span className="hidden sm:inline">Test</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setExpandedModelId(expanded ? null : cfg.modelId)}
                        className="h-7 w-7 rounded p-0 text-muted-foreground"
                        aria-label={expanded ? 'Collapse' : 'Edit'}
                      >
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </Button>
                      <Button
                        size="sm"
                        variant={dirty ? 'default' : 'ghost'}
                        disabled={!dirty || saving !== null}
                        onClick={() => handleUpdate(cfg.modelId)}
                        className="h-7 gap-1 px-2.5 text-xs"
                      >
                        {saving === cfg.modelId ? <RefreshCw size={11} className="animate-spin" /> : <Save size={11} />}
                        <span className="hidden sm:inline">Apply</span>
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Delete model"
                        disabled={saving !== null}
                        onClick={() => deleteModel(cfg.modelId)}
                        className="h-7 w-7 text-muted-foreground/40 hover:bg-danger/5 hover:text-danger"
                      >
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  </div>

                  {/* Expanded edit panel */}
                  {expanded && (
                    <div className="border-t border-border/50 bg-muted/[0.03] px-5 py-4">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <Select
                          label="Provider"
                          value={cfg.providerId}
                          onValueChange={providerId => updateModel(cfg.modelId, { providerId })}
                          options={providerOptions}
                        />
                        <div>
                          <FieldLabel htmlFor={providerModelNameId}>Provider model name</FieldLabel>
                          <Input
                            id={providerModelNameId}
                            value={cfg.modelName}
                            onChange={e => updateModel(cfg.modelId, { modelName: e.target.value })}
                          />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {(['rpm', 'rpd', 'tpm'] as const).map(field => {
                            const limitId = domId(`model-${field}`, cfg.modelId);
                            return (
                            <div key={field}>
                              <FieldLabel htmlFor={limitId}>{field.toUpperCase()}</FieldLabel>
                              <Input
                                id={limitId}
                                type="number"
                                min={1}
                                value={cfg[field] ?? ''}
                                placeholder="None"
                                onChange={e => updateQuota(cfg.modelId, field, parseOptionalLimit(e.target.value))}
                              />
                            </div>
                          );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}

            {filteredConfigs.length === 0 && (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                No models match the current filters.
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {/* ── System Information ────────────────────────────────────────────── */}
      <SectionCard
        title="System"
        description="Codra instance details and build information"
      >
        <div className="divide-y divide-border/50">

          {/* Version row */}
          <div className="flex items-center gap-4 px-5 py-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Tag size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">Version</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Installed Codra release</p>
            </div>
            <code className="inline-flex items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/8 px-3.5 py-1.5 text-sm font-bold tracking-tight text-primary">
              v{pkg.version}
            </code>
          </div>

          {/* Changelog / links row */}
          <div className="flex items-center gap-4 px-5 py-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground">
              <GitCommit size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">Releases</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Browse all versions and release notes on GitHub</p>
            </div>
            <a
              href="https://github.com/devarshishimpi/codra/releases/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-transparent px-3.5 py-1.5 text-xs font-semibold text-muted-foreground transition-all duration-150 hover:border-primary/40 hover:bg-primary/5 hover:text-primary hover:shadow-[0_0_0_3px_color-mix(in_oklch,var(--primary)_10%,transparent)]"
            >
              View releases
              <ExternalLink size={11} />
            </a>
          </div>

        </div>
      </SectionCard>
    </section>
  );
}
