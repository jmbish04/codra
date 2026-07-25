import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@client/lib/api';
import { Switch } from '@client/components/ui/switch';
import { Alert } from '@client/components/ui/alert';
import { Badge } from '@client/components/ui/badge';
import { PageHeader } from '@client/components/layout/page-header';
import { EmptyState } from '@client/components/shared/empty-state';
import { formatDateTime } from '@client/lib/format';
import { KeyRound, AlertTriangle } from 'lucide-react';
import type { SecretsStoreSecretInfo, StandardSecretBinding, MissingSecretReport } from '@shared/api';

export function SecretsPage() {
  const [storeId, setStoreId] = useState('');
  const [available, setAvailable] = useState<SecretsStoreSecretInfo[]>([]);
  const [standard, setStandard] = useState<StandardSecretBinding[]>([]);
  const [missing, setMissing] = useState<MissingSecretReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const [avail, std, miss] = await Promise.all([
        api.getAvailableSecrets(),
        api.getStandardSecretBindings(),
        api.getMissingSecretReports(),
      ]);
      setStoreId(avail.store_id);
      setAvailable(avail.secrets);
      setStandard(std.bindings);
      setMissing(miss.reports);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load secrets.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const standardBySecret = new Map(standard.map((b) => [`${b.store_id}:${b.secret_name}`, b]));

  const toggle = async (secret: SecretsStoreSecretInfo, on: boolean) => {
    try {
      if (on) {
        await api.upsertStandardSecretBinding({
          binding_name: secret.name,
          secret_name: secret.name,
          store_id: storeId,
          description: secret.comment,
        });
      } else {
        const existing = standardBySecret.get(`${storeId}:${secret.name}`);
        if (existing) await api.deleteStandardSecretBinding(existing.id);
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed.');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        category="Configuration"
        title="Standard secret bindings"
        description="Choose which Cloudflare Secrets Store secrets are standard for Worker repos. Codra adds any missing ones to a repo's wrangler.jsonc via its follow-up PR — after verifying each still exists in the store."
      />

      {error && <Alert variant="destructive">{error}</Alert>}

      {missing.length > 0 && (
        <Alert variant="warning">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">{missing.length} secret(s) codra expected but couldn’t find in the store</p>
              <ul className="mt-1 space-y-0.5 text-sm">
                {missing.map((m) => (
                  <li key={m.id}>
                    <span className="font-mono">{m.secret_name}</span> — needed for {m.owner}/{m.repo}
                    {m.triggering_pr_number != null ? ` (PR #${m.triggering_pr_number})` : ''} · {formatDateTime(m.created_at)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Alert>
      )}

      {loading ? (
        <div className="h-40" role="status" aria-busy="true" />
      ) : available.length === 0 ? (
        <EmptyState
          icon={<KeyRound className="h-6 w-6" />}
          title="No secrets found in the store"
          description="Either the store is empty or codra's Cloudflare API token can't read it. Check CF_API_TOKEN / CF_ACCOUNT_ID."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Secret</th>
                <th className="px-4 py-2 font-medium">Description</th>
                <th className="px-4 py-2 font-medium">Standard</th>
              </tr>
            </thead>
            <tbody>
              {available.map((s) => {
                const isStandard = standardBySecret.has(`${storeId}:${s.name}`);
                return (
                  <tr key={s.name} className="border-t border-border/60">
                    <td className="px-4 py-2 font-mono text-xs">{s.name}</td>
                    <td className="px-4 py-2 text-muted-foreground">{s.comment || '—'}</td>
                    <td className="px-4 py-2">
                      <Switch checked={isStandard} onCheckedChange={(v) => toggle(s, v)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Store <Badge variant="secondary">{storeId || '—'}</Badge>
      </p>
    </div>
  );
}

export default SecretsPage;
