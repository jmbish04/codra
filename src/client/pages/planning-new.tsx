import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@client/lib/api';
import type { RepoConfigRecord } from '@shared/schema';
import { PlateEditor } from '@client/components/plate-editor';
import { PageHeader } from '@client/components/layout/page-header';
import { Button } from '@client/components/ui/button';
import { Alert } from '@client/components/ui/alert';
import { Send, Loader2 } from 'lucide-react';

const AUTOSAVE_MS = 1000;

/**
 * PlanningNewPage
 */
export function PlanningNewPage() {
  const navigate = useNavigate();
  const [repos, setRepos] = useState<RepoConfigRecord[]>([]);
  const [repoKey, setRepoKey] = useState(''); // "owner/repo"
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [packageId, setPackageId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const creating = useRef(false);

  useEffect(() => {
    api.getRepos().then((r) => setRepos(r.repos)).catch(() => setError('Failed to load repositories.'));
  }, []);

  // Debounced autosave: create the draft on first save, then patch.
  useEffect(() => {
    if (!repoKey || !title.trim()) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSaveState('saving');
      try {
        if (!packageId && !creating.current) {
          creating.current = true;
          const [owner, repo] = repoKey.split('/');
          const res = await api.createPlanningPackage({ owner, repo, title: title.trim(), requestPromptJson: prompt });
          setPackageId(res.package.id);
          creating.current = false;
        } else if (packageId) {
          await api.patchPlanningPackage(packageId, { title: title.trim(), requestPromptJson: prompt });
        }
        setSaveState('saved');
      } catch (e) {
        creating.current = false;
        setSaveState('error');
        setError(e instanceof Error ? e.message : 'Autosave failed.');
      }
    }, AUTOSAVE_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [repoKey, title, prompt, packageId]);

  /**
   * submit
   */
  const submit = async () => {
    if (!packageId) return;
    setError(null);
    try {
      await api.orchestratePlanningPackage(packageId);
      navigate(`/planning/${packageId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start Jules.');
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PageHeader
        category="Planning"
        title="New feature request"
        description="Pick a repo and describe the feature. Jules studies the codebase and produces an informed plan; codra reviews it. Drafts autosave — come back anytime."
      />
      {error && <Alert variant="destructive">{error}</Alert>}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Repository</span>
          <select
            value={repoKey}
            onChange={(e) => setRepoKey(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">Select a repo…</option>
            {repos.map((r) => (
              <option key={`${r.owner}/${r.repo}`} value={`${r.owner}/${r.repo}`}>{r.owner}/{r.repo}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Feature title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Add SSO login"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">Prompt to Jules</span>
        <div className="min-h-[280px] rounded-md border border-border p-3">
          <PlateEditor value={prompt} onChange={setPrompt} placeholder="Describe the feature, constraints, acceptance criteria…" />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'saved' && 'Draft saved'}
          {saveState === 'error' && 'Save failed'}
          {saveState === 'idle' && (repoKey && title.trim() ? 'Ready' : 'Pick a repo and title to start a draft')}
        </span>
        <Button onClick={submit} disabled={!packageId} className="gap-1.5">
          {saveState === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Submit to Jules
        </Button>
      </div>
    </div>
  );
}
