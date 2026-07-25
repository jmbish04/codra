import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@client/lib/api';
import { Button } from '@client/components/ui/button';
import { Input } from '@client/components/ui/input';
import { Badge } from '@client/components/ui/badge';
import { Alert } from '@client/components/ui/alert';
import { PageHeader } from '@client/components/layout/page-header';
import type { RepoTestConfig } from '@shared/api';

export function TestingPage() {
  const [params] = useSearchParams();
  const [repo, setRepo] = useState(params.get('repo') ?? '');
  const [config, setConfig] = useState<RepoTestConfig | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [frontendPassword, setFrontendPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (r: string) => {
    if (!r.includes('/')) return;
    setLoading(true);
    try {
      const res = await api.getTestConfig(r);
      setConfig(res.config);
      setBaseUrl(res.config.baseUrl ?? '');
      setApiKey('');
      setFrontendPassword('');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load config.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (repo.includes('/')) void load(repo); /* eslint-disable-next-line */ }, []);

  const save = async () => {
    if (!repo.includes('/')) { toast.error('Enter a repo as owner/name.'); return; }
    setSaving(true);
    try {
      const res = await api.setTestConfig(repo, {
        baseUrl: baseUrl.trim() || null,
        // Only send secrets that were typed; leave blank to keep existing.
        ...(apiKey ? { apiKey } : {}),
        ...(frontendPassword ? { frontendPassword } : {}),
      });
      setConfig(res.config);
      setApiKey('');
      setFrontendPassword('');
      toast.success('Test config saved.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        category="Testing"
        title="PR test configuration"
        description="Set the base URL codra hits to test a repo's read-only endpoints and pages, plus the API key / frontend password to use when the standard WORKER_API_KEY is rejected. Secrets are encrypted at rest."
      />

      {error && <Alert variant="destructive">{error}</Alert>}

      <div className="space-y-4 rounded-lg border border-border p-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Repository (owner/name)</label>
          <div className="flex gap-2">
            <Input placeholder="jmbish04/core-remodel" value={repo} onChange={(e) => setRepo(e.target.value)} />
            <Button variant="secondary" onClick={() => load(repo)} disabled={loading}>Load</Button>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Test base URL</label>
          <Input placeholder="https://my-worker.example.workers.dev" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          <p className="mt-1 text-xs text-muted-foreground">Codra hits <span className="font-mono">{'{baseURL}{path}'}</span> for API tests and opens pages here for frontend tests.</p>
        </div>

        <div>
          <label className="mb-1 flex items-center gap-2 text-sm font-medium">
            API key {config?.hasApiKey && <Badge variant="success">set</Badge>}
          </label>
          <Input type="password" placeholder={config?.hasApiKey ? '•••••••• (leave blank to keep)' : 'Only if WORKER_API_KEY is rejected'} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        </div>

        <div>
          <label className="mb-1 flex items-center gap-2 text-sm font-medium">
            Frontend password {config?.hasFrontendPassword && <Badge variant="success">set</Badge>}
          </label>
          <Input type="password" placeholder={config?.hasFrontendPassword ? '•••••••• (leave blank to keep)' : 'Only if the page needs a login/password'} value={frontendPassword} onChange={(e) => setFrontendPassword(e.target.value)} />
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save & enable testing'}</Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Codra tries <span className="font-mono">WORKER_API_KEY</span> first. It only uses the values above when that key is rejected. Once set, codra runs the queued tests and reports the results back on the PR.
      </p>
    </div>
  );
}

export default TestingPage;
