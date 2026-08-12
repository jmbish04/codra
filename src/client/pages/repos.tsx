import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { toast } from 'sonner';
import { api } from '@client/lib/api';
import { Skeleton } from '@client/components/shared/skeleton';
import { EmptyState } from '@client/components/shared/empty-state';
import { Button } from '@client/components/ui/button';
import { Alert } from '@client/components/ui/alert';
import { PageHeader } from '@client/components/layout/page-header';
import { Switch } from '@client/components/ui/switch';
import {
  GitBranch,
  RefreshCw,
  Save,
  ArrowUpRight,
  RotateCcw,
  Settings2,
  AlertTriangle,
  X,
} from 'lucide-react';
import { cn } from '@client/lib/utils';
import type { RepoConfig, RepoConfigRecord } from '@shared/schema';
import {
  describeModelRoute,
  ModelRouteEditor,
  type ModelOption,
  type ModelRouteConfig,
  type ProviderOption,
} from '@client/components/features/models/model-chain';

const EMPTY_MODEL_ROUTE: ModelRouteConfig = {
  main: null,
  fallbacks: [],
  size_overrides: [],
};

type GlobalModelConfig = RepoConfig['model'];

function repoId(repo: Pick<RepoConfigRecord, 'owner' | 'repo'>) {
  return `${repo.owner}/${repo.repo}`;
}

function hasStoredModelStrategy(repo: RepoConfigRecord) {
  return repo.mainModel !== null || repo.fallbackModels !== null || repo.sizeOverrides !== null;
}

function normalizeRoute(config: GlobalModelConfig | ModelRouteConfig | null | undefined): ModelRouteConfig {
  return {
    main: typeof config?.main === 'string' && config.main.trim() ? config.main : null,
    fallbacks: Array.isArray(config?.fallbacks) ? config.fallbacks : EMPTY_MODEL_ROUTE.fallbacks,
    size_overrides: Array.isArray(config?.size_overrides)
      ? config.size_overrides
      : EMPTY_MODEL_ROUTE.size_overrides,
  };
}

function getGlobalRoute(globalConfig: GlobalModelConfig | ModelRouteConfig | null): ModelRouteConfig {
  return normalizeRoute(globalConfig);
}

function getStoredRepoRoute(repo: RepoConfigRecord): ModelRouteConfig | null {
  if (!hasStoredModelStrategy(repo)) return null;

  return {
    main: repo.mainModel ?? null,
    fallbacks: repo.fallbackModels ?? [],
    size_overrides: Array.isArray(repo.sizeOverrides) ? repo.sizeOverrides : [],
  };
}

function stringArraysEqual(a: string[] = [], b: string[] = []) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function tiersEqual(a: ModelRouteConfig['size_overrides'] = [], b: ModelRouteConfig['size_overrides'] = []) {
  return a.length === b.length && a.every((tier, index) => {
    const other = b[index];
    return Boolean(
      tier && other &&
      tier.max_lines === other.max_lines &&
      tier.model === other.model &&
      stringArraysEqual(tier.fallbacks ?? [], other.fallbacks ?? []),
    );
  });
}

function routesEqual(a: ModelRouteConfig, b: ModelRouteConfig) {
  return (
    a.main === b.main &&
    stringArraysEqual(a.fallbacks ?? [], b.fallbacks ?? []) &&
    tiersEqual(a.size_overrides ?? [], b.size_overrides ?? [])
  );
}

function hasMeaningfulCustomStrategy(repo: RepoConfigRecord, globalConfig: GlobalModelConfig | ModelRouteConfig | null) {
  const storedRoute = getStoredRepoRoute(repo);
  if (!storedRoute) return false;

  return (
    !routesEqual(storedRoute, getGlobalRoute(globalConfig)) &&
    !routesEqual(storedRoute, EMPTY_MODEL_ROUTE)
  );
}

function getRepoRoute(repo: RepoConfigRecord, globalConfig: GlobalModelConfig | ModelRouteConfig | null): ModelRouteConfig {
  if (!hasMeaningfulCustomStrategy(repo, globalConfig)) {
    return getGlobalRoute(globalConfig);
  }

  return getStoredRepoRoute(repo) ?? getGlobalRoute(globalConfig);
}

function formatLastActivity(value: string | Date | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString();
}

/**
 * The per-repo auto-toggles. Single source of truth: `label`
 * is the compact switch caption, `full` the sentence-form name used in the reset
 * dialog and toasts. `RepoFlag` is derived from here so adding a flag can't drift.
 */
const REPO_FLAGS = [
  { key: 'enabled', label: 'Code Review', full: 'Code Review', title: 'Automatically review pull requests' },
  { key: 'docstringEnabled', label: 'DocString', full: 'DocString Enforcer', title: 'Issue a Jules task when docstrings are missing or poor' },
  { key: 'toolboxEnabled', label: 'Toolbox', full: 'Toolbox Watcher', title: 'Open a PR to install missing standard files for the repo type' },
  { key: 'externalJulesEnabled', label: 'External Jules', full: 'External Jules PR review', title: 'Enable external Jules PR review routing for this repository' },
] as const;

type RepoFlag = (typeof REPO_FLAGS)[number]['key'];

const FLAG_LABEL: Record<RepoFlag, string> = Object.fromEntries(
  REPO_FLAGS.map((f) => [f.key, f.label]),
) as Record<RepoFlag, string>;

/** Stable pending-toggle key so the same format is used everywhere. */
function pendingKey(id: string, flag: RepoFlag) {
  return `${id}::${flag}`;
}

function pluralize(n: number, singular: string, plural = `${singular}s`) {
  return n === 1 ? singular : plural;
}

interface RepoRowProps {
  repo: RepoConfigRecord;
  globalConfig: GlobalModelConfig | ModelRouteConfig | null;
  modelOptions: ModelOption[];
  /** All in-flight toggle keys (see pendingKey); the row reads its own. */
  pendingToggles: Set<string>;
  /** A global reset is running — freeze every per-repo switch to avoid racing it. */
  resetting: boolean;
  onToggleFlag: (repo: RepoConfigRecord, flag: RepoFlag, value: boolean) => void;
  onEdit: (repo: RepoConfigRecord) => void;
}

function RepoRow({
  repo,
  globalConfig,
  modelOptions,
  pendingToggles,
  resetting,
  onToggleFlag,
  onEdit,
}: RepoRowProps) {
  const route = getRepoRoute(repo, globalConfig);
  const custom = hasMeaningfulCustomStrategy(repo, globalConfig);
  const lastActivity = formatLastActivity(repo.lastJobCreatedAt);
  const anyOn = repo.enabled || repo.docstringEnabled || repo.toolboxEnabled || repo.externalJulesEnabled;
  const id = repoId(repo);

  return (
    <article className="surface surface-static-shadow min-w-0 px-3 py-3 sm:px-4">
      <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(180px,1fr)_auto] lg:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              'h-2.5 w-2.5 shrink-0 rounded-full',
              anyOn ? 'bg-success' : 'bg-muted-foreground/35',
            )}
          />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">
              {repo.owner}/{repo.repo}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                  anyOn
                    ? 'border-success-border bg-success-bg text-success'
                    : 'border-border bg-muted/40 text-muted-foreground',
                )}
              >
                {anyOn ? 'Active' : 'Off'}
              </span>
              <span className="truncate text-[11px] text-muted-foreground">
                {describeModelRoute(route, modelOptions)}
                {custom ? ' · custom' : ''}
              </span>
              {lastActivity && (
                <span className="text-[11px] text-muted-foreground">
                  Last {lastActivity}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
          {REPO_FLAGS.map(({ key, label, title }) => (
            <div
              key={key}
              title={title}
              className="flex items-center gap-2 rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5"
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {label}
              </span>
              <Switch
                checked={repo[key]}
                disabled={resetting || pendingToggles.has(pendingKey(id, key))}
                aria-label={`${repo[key] ? 'Disable' : 'Enable'} ${label} for ${repo.owner}/${repo.repo}`}
                onCheckedChange={(next) => onToggleFlag(repo, key, next)}
              />
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEdit(repo)}
            className="h-8 shrink-0 gap-1.5"
          >
            <Settings2 size={13} />
            Edit
          </Button>
        </div>
      </div>
    </article>
  );
}

interface RepoModelModalProps {
  repo: RepoConfigRecord | null;
  globalConfig: GlobalModelConfig | ModelRouteConfig | null;
  modelOptions: ModelOption[];
  providerOptions: ProviderOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onModelApplied: (repo: RepoConfigRecord, route: ModelRouteConfig) => void;
  onModelReset: (repo: RepoConfigRecord) => void;
}

function RepoModelModal({
  repo,
  globalConfig,
  modelOptions,
  providerOptions,
  open,
  onOpenChange,
  onModelApplied,
  onModelReset,
}: RepoModelModalProps) {
  const selectedRepoId = repo ? repoId(repo) : null;
  const globalRouteKey = useMemo(
    () => JSON.stringify(getGlobalRoute(globalConfig)),
    [globalConfig],
  );
  const [route, setRoute] = useState<ModelRouteConfig>(EMPTY_MODEL_ROUTE);
  const [initialRoute, setInitialRoute] = useState<ModelRouteConfig>(EMPTY_MODEL_ROUTE);
  const [saving, setSaving] = useState<'apply' | 'reset' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repo) return;
    const nextRoute = getRepoRoute(repo, globalConfig);
    setRoute(nextRoute);
    setInitialRoute(nextRoute);
    setSaving(null);
    setError(null);
  }, [selectedRepoId, globalRouteKey]);

  const dirty = useMemo(() => !routesEqual(route, initialRoute), [initialRoute, route]);
  const hasStoredStrategy = repo ? hasStoredModelStrategy(repo) : false;

  const handleApply = async () => {
    if (!repo || !dirty) return;
    setSaving('apply');
    setError(null);
    const tid = toast.loading('Applying model strategy…');
    try {
      await api.updateRepoConfig(repo.owner, repo.repo, {
        model: {
          main: route.main,
          fallbacks: route.fallbacks,
          size_overrides: route.size_overrides,
        },
      });
      setInitialRoute(route);
      onModelApplied(repo, route);
      toast.success('Strategy saved', { id: tid, description: `${repo.owner}/${repo.repo} now uses a custom model chain.` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save model strategy.';
      setError(msg);
      toast.error('Could not save strategy', { id: tid, description: 'Your changes were not applied. Please try again.' });
    } finally {
      setSaving(null);
    }
  };

  const handleReset = async () => {
    if (!repo) return;
    setSaving('reset');
    setError(null);
    const tid = toast.loading('Resetting to global defaults…');
    try {
      await api.updateRepoConfig(repo.owner, repo.repo, {
        model: {
          main: null,
          fallbacks: null,
          size_overrides: null,
        },
      });
      const globalRoute = getGlobalRoute(globalConfig);
      setRoute(globalRoute);
      setInitialRoute(globalRoute);
      onModelReset(repo);
      toast.success('Reset to global strategy', { id: tid, description: `${repo.owner}/${repo.repo} will inherit account defaults.` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to reset model strategy.';
      setError(msg);
      toast.error('Reset failed', { id: tid, description: 'Could not remove the custom strategy. Try again.' });
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-background/75 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in data-[state=closed]:fade-out" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[calc(100vw-1.5rem)] max-w-5xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-6">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold text-foreground">
                Edit model strategy
              </Dialog.Title>
              <Dialog.Description className="mt-1 truncate text-sm text-muted-foreground">
                {repo ? repoId(repo) : 'Repository routing'}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close modal" className="h-8 w-8 shrink-0">
                <X size={15} />
              </Button>
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            {error && <Alert variant="destructive" className="mb-4">{error}</Alert>}
            <ModelRouteEditor
              value={route}
              onChange={setRoute}
              models={modelOptions}
              providers={providerOptions}
              density="comfortable"
            />
          </div>

          <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-muted/10 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <Button
              variant="ghost"
              onClick={handleReset}
              disabled={!repo || saving !== null || !hasStoredStrategy}
              className="gap-2 text-muted-foreground hover:text-foreground"
            >
              {saving === 'reset' ? <RefreshCw size={14} className="animate-spin" /> : <RotateCcw size={14} />}
              Use global
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Dialog.Close asChild>
                <Button variant="outline" disabled={saving !== null}>Cancel</Button>
              </Dialog.Close>
              <Button onClick={handleApply} disabled={!dirty || saving !== null} className="gap-2">
                {saving === 'apply' ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                Apply
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface ResetConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoCount: number;
  resetting: boolean;
  onConfirm: () => void;
}

/** "A, B, and C" from the canonical flag names, so this text never drifts from REPO_FLAGS. */
const RESET_CHECK_NAMES = REPO_FLAGS.map((f) => f.full);
const checkNameList =
  RESET_CHECK_NAMES.slice(0, -1).join(', ') + ', and ' + RESET_CHECK_NAMES[RESET_CHECK_NAMES.length - 1];

function ResetConfirmDialog({ open, onOpenChange, repoCount, resetting, onConfirm }: ResetConfirmDialogProps) {
  return (
    // Don't let Escape / overlay-click dismiss the dialog while the destructive
    // request is in flight.
    <Dialog.Root open={open} onOpenChange={(next) => { if (!resetting || next) onOpenChange(next); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-background/75 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in data-[state=closed]:fade-out" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-1.5rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-5 shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle size={18} />
            </span>
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold text-foreground">
                Turn off every check?
              </Dialog.Title>
              <Dialog.Description className="mt-1.5 text-sm text-muted-foreground">
                This sets {checkNameList} to off for all {repoCount}{' '}
                {pluralize(repoCount, 'repository', 'repositories')}. Codra stops issuing
                automatic checks until you re-enable them per repo. On-demand{' '}
                <span className="font-medium text-foreground">@codra-app</span> comments still work.
              </Dialog.Description>
            </div>
          </div>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Dialog.Close asChild>
              <Button variant="outline" disabled={resetting}>Cancel</Button>
            </Dialog.Close>
            <Button
              onClick={onConfirm}
              disabled={resetting}
              className="gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {resetting ? <RefreshCw size={14} className="animate-spin" /> : <RotateCcw size={14} />}
              Reset all repositories
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Repository settings page. Lists every repo Codra can access (sorted by last
 * review activity) with per-repo auto-toggles — Code Review, DocString
 * Enforcer, Toolbox Watcher, External Jules PR review — plus a bulk "Reset all"
 * that turns them all off, and a per-repo model-strategy editor.
 *
 * Local state it owns: `repos` (the list + optimistic toggle merges),
 * `pendingToggles` (in-flight per-switch keys), `resetOpen`/`resetting` (the
 * bulk-reset dialog + request), and `editingRepoId` (the model-strategy modal).
 */
export function ReposPage() {
  const [repos, setRepos] = useState<RepoConfigRecord[]>([]);
  const [globalConfig, setGlobalConfig] = useState<ModelRouteConfig>(EMPTY_MODEL_ROUTE);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [providerOptions, setProviderOptions] = useState<ProviderOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingRepoId, setEditingRepoId] = useState<string | null>(null);
  // Pending toggle keys: `${owner}/${repo}:${flag}` so each switch is independent.
  const [pendingToggles, setPendingToggles] = useState<Set<string>>(() => new Set());
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const editingRepo = useMemo(
    () => repos.find(repo => repoId(repo) === editingRepoId) ?? null,
    [repos, editingRepoId],
  );

  const loadRepos = () => {
    setLoading(true);
    Promise.all([
      api.getRepos(),
      api.getGlobalConfig(),
      api.getModelConfigs(),
    ])
      .then(([reposRes, globalRes, modelsRes]) => {
        const nextRepos = Array.isArray(reposRes?.repos) ? reposRes.repos : [];
        const providers = Array.isArray(modelsRes?.providers) ? modelsRes.providers : [];
        const configs = Array.isArray(modelsRes?.configs) ? modelsRes.configs : [];

        setRepos(nextRepos);
        setGlobalConfig(normalizeRoute(globalRes?.config));
        setProviderOptions(providers.map(provider => ({ value: provider.id, label: provider.name })));
        setModelOptions(configs.map(config => ({
          value: config.modelId,
          label: `${config.providerName} / ${config.modelName}`,
          providerId: config.providerId,
        })));
        setLoading(false);
      })
      .catch(e => {
        setError(e instanceof Error ? e.message : 'Failed to load repositories.');
        setLoading(false);
      });
  };

  useEffect(() => { loadRepos(); }, []);

  const mergeRepo = (targetId: string, updates: Partial<RepoConfigRecord>) => {
    setRepos(current =>
      current.map(repo =>
        repoId(repo) === targetId ? { ...repo, ...updates } : repo,
      ),
    );
  };

  const handleToggleFlag = async (repo: RepoConfigRecord, flag: RepoFlag, value: boolean) => {
    const targetId = repoId(repo);
    const key = pendingKey(targetId, flag);
    setPendingToggles(current => new Set(current).add(key));
    const label = FLAG_LABEL[flag];
    // Record<RepoFlag, boolean> — no cast, and adding a flag stays type-checked.
    const patch: Partial<Record<RepoFlag, boolean>> = { [flag]: value };
    const tid = toast.loading(value ? `Enabling ${label}…` : `Disabling ${label}…`);
    try {
      await api.updateRepoConfig(repo.owner, repo.repo, patch);
      mergeRepo(targetId, patch);
      toast.success(value ? `${label} on` : `${label} off`, {
        id: tid,
        description: `${targetId} · ${label} is now ${value ? 'enabled' : 'disabled'}.`,
      });
    } catch (err) {
      toast.error('Could not update repository', { id: tid, description: 'The change did not go through. Please try again.' });
    } finally {
      setPendingToggles(current => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const handleReset = async () => {
    if (resetting) return;
    setResetting(true);
    const tid = toast.loading('Turning off all checks…');
    try {
      const result = await api.resetRepos();
      setRepos(current =>
        current.map(repo => ({
          ...repo,
          enabled: false,
          docstringEnabled: false,
          toolboxEnabled: false,
          externalJulesEnabled: false,
        })),
      );
      setResetOpen(false);
      toast.success('All checks off', {
        id: tid,
        description: `${result.count} ${pluralize(result.count, 'repository', 'repositories')} reset. Re-enable per repo as needed.`,
      });
    } catch (err) {
      toast.error('Reset failed', { id: tid, description: 'No changes were made. Please try again.' });
    } finally {
      setResetting(false);
    }
  };

  const handleModelApplied = (repo: RepoConfigRecord, route: ModelRouteConfig) => {
    mergeRepo(repoId(repo), {
      mainModel: route.main,
      fallbackModels: route.fallbacks,
      sizeOverrides: route.size_overrides,
    });
  };

  const handleModelReset = (repo: RepoConfigRecord) => {
    mergeRepo(repoId(repo), {
      mainModel: null,
      fallbackModels: null,
      sizeOverrides: null,
    });
  };

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setError(null);
    const tid = toast.loading('Syncing with GitHub…');
    try {
      const result = await api.syncRepos();
      const syncedCount = result?.synced?.length ?? 0;
      toast.success('Repositories up to date', {
        id: tid,
        description: syncedCount > 0
          ? `${syncedCount} ${syncedCount === 1 ? 'repository' : 'repositories'} refreshed from GitHub.`
          : 'Everything is already in sync.',
      });
      loadRepos();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sync failed.';
      setError(msg);
      toast.error('Sync failed', { id: tid, description: 'Could not reach GitHub. Check your connection and try again.' });
    } finally {
      setSyncing(false);
    }
  };

  if (loading && repos.length === 0) {
    return (
      <section className="page-enter flex flex-col gap-6">
        <PageHeader category="Repositories" title="Repository settings" />
        <div className="surface overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
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
        category="Repositories"
        title="Repository settings"
        description={!loading && `${repos.length} ${pluralize(repos.length, 'repository', 'repositories')} with Codra access`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setResetOpen(true)}
              disabled={resetting || repos.length === 0}
              className="gap-2 text-destructive hover:text-destructive"
            >
              <RotateCcw size={13} className={cn(resetting && 'animate-spin')} />
              Reset all
            </Button>
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
                href="/api/repos/install"
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
        <div className="flex min-w-0 flex-col gap-2.5">
          {repos.map(repo => {
            const id = repoId(repo);
            return (
              <RepoRow
                key={id}
                repo={repo}
                globalConfig={globalConfig}
                modelOptions={modelOptions}
                pendingToggles={pendingToggles}
                resetting={resetting}
                onToggleFlag={handleToggleFlag}
                onEdit={(nextRepo) => setEditingRepoId(repoId(nextRepo))}
              />
            );
          })}
        </div>
      )}

      <ResetConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        repoCount={repos.length}
        resetting={resetting}
        onConfirm={handleReset}
      />

      <RepoModelModal
        repo={editingRepo}
        globalConfig={globalConfig}
        modelOptions={modelOptions}
        providerOptions={providerOptions}
        open={editingRepo !== null}
        onOpenChange={(open) => {
          if (!open) setEditingRepoId(null);
        }}
        onModelApplied={handleModelApplied}
        onModelReset={handleModelReset}
      />
    </section>
  );
}
