import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@client/lib/api';
import { Button } from '@client/components/ui/button';
import { Input } from '@client/components/ui/input';
import { Select } from '@client/components/ui/select';
import { Switch } from '@client/components/ui/switch';
import { Badge } from '@client/components/ui/badge';
import { Alert } from '@client/components/ui/alert';
import { PageHeader } from '@client/components/layout/page-header';
import { EmptyState } from '@client/components/shared/empty-state';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@client/components/ui/dialog';
import { FileCheck2, Plus, Trash2, Pencil } from 'lucide-react';
import type { StandardizationRule, StandardizationStrategy } from '@shared/api';

const STRATEGIES: { value: StandardizationStrategy; label: string; help: string }[] = [
  { value: 'create_if_missing', label: 'Create if missing', help: 'Add the file only if absent or empty; never touch a populated file.' },
  { value: 'merge_json', label: 'Merge JSON keys', help: 'Ensure the source’s top-level keys exist in the target JSON (e.g. .vscode/settings.json).' },
  { value: 'merge_mcp_servers', label: 'Merge MCP servers', help: 'Append any MCP servers from the source that the target is missing.' },
  { value: 'overwrite', label: 'Overwrite', help: 'Always replace the target with the source content.' },
];

const strategyLabel = (s: string) => STRATEGIES.find((x) => x.value === s)?.label ?? s;

type Draft = { id?: string; target_path: string; source_url: string; strategy: StandardizationStrategy };
const EMPTY_DRAFT: Draft = { target_path: '', source_url: '', strategy: 'create_if_missing' };

export function StandardizationPage() {
  const [rules, setRules] = useState<StandardizationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const res = await api.getStandardizationRules();
      setRules(res.rules);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load rules.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const toggle = async (rule: StandardizationRule, enabled: boolean) => {
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled } : r)));
    try {
      await api.updateStandardizationRule(rule.id, { enabled });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed.');
      void load();
    }
  };

  const remove = async (rule: StandardizationRule) => {
    if (!confirm(`Delete rule for ${rule.target_path}?`)) return;
    try {
      await api.deleteStandardizationRule(rule.id);
      setRules((prev) => prev.filter((r) => r.id !== rule.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed.');
    }
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.target_path.trim() || !draft.source_url.trim()) {
      toast.error('Target path and source URL are required.');
      return;
    }
    setSaving(true);
    try {
      if (draft.id) {
        await api.updateStandardizationRule(draft.id, {
          target_path: draft.target_path, source_url: draft.source_url, strategy: draft.strategy,
        });
      } else {
        await api.createStandardizationRule({
          target_path: draft.target_path, source_url: draft.source_url, strategy: draft.strategy,
          sort_order: (rules[rules.length - 1]?.sort_order ?? 0) + 10,
        });
      }
      setDraft(null);
      await load();
      toast.success('Saved.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        category="Configuration"
        title="Worker standardization"
        description="For Cloudflare Worker repos, codra checks each PR’s repo against these files and opens a separate follow-up PR for anything missing or drifted — it never edits the PR under review."
        actions={
          <Button onClick={() => setDraft({ ...EMPTY_DRAFT })}>
            <Plus className="h-4 w-4" /> Add rule
          </Button>
        }
      />

      {error && <Alert variant="destructive">{error}</Alert>}

      {loading ? (
        <div className="h-40" role="status" aria-busy="true" />
      ) : rules.length === 0 ? (
        <EmptyState
          icon={<FileCheck2 className="h-6 w-6" />}
          title="No standardization rules"
          description="Add a rule pointing at a reference file (GitHub URL) and codra will keep Worker repos in sync with it."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Target path</th>
                <th className="px-4 py-2 font-medium">Strategy</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Enabled</th>
                <th className="px-4 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="border-t border-border/60">
                  <td className="px-4 py-2 font-mono text-xs">{rule.target_path}</td>
                  <td className="px-4 py-2"><Badge variant="secondary">{strategyLabel(rule.strategy)}</Badge></td>
                  <td className="max-w-[22rem] truncate px-4 py-2">
                    <a href={rule.source_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      {rule.source_url.replace(/^https?:\/\/(www\.)?github\.com\//, '')}
                    </a>
                  </td>
                  <td className="px-4 py-2">
                    <Switch checked={rule.enabled} onCheckedChange={(v) => toggle(rule, v)} />
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" aria-label="Edit" onClick={() => setDraft({
                        id: rule.id, target_path: rule.target_path, source_url: rule.source_url, strategy: rule.strategy,
                      })}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label="Delete" onClick={() => remove(rule)}>
                        <Trash2 className="h-4 w-4 text-danger" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent>
          {draft && (
            <>
              <DialogHeader>
                <DialogTitle>{draft.id ? 'Edit rule' : 'Add standardization rule'}</DialogTitle>
                <DialogDescription>Point at a reference file and choose how codra reconciles it.</DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">Target path (in the repo)</label>
                  <Input
                    placeholder=".vscode/settings.json"
                    value={draft.target_path}
                    onChange={(e) => setDraft({ ...draft, target_path: e.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Source file URL (GitHub)</label>
                  <Input
                    placeholder="https://github.com/owner/repo/blob/<sha>/path"
                    value={draft.source_url}
                    onChange={(e) => setDraft({ ...draft, source_url: e.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Strategy</label>
                  <Select
                    value={draft.strategy}
                    onValueChange={(v) => setDraft({ ...draft, strategy: v as StandardizationStrategy })}
                    options={STRATEGIES.map((s) => ({ value: s.value, label: s.label }))}
                    variant="card"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {STRATEGIES.find((s) => s.value === draft.strategy)?.help}
                  </p>
                </div>
              </div>

              <DialogFooter>
                <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
                <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default StandardizationPage;
