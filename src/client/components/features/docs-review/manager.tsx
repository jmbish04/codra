import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@client/components/ui/button';
import { Input } from '@client/components/ui/input';
import { Select } from '@client/components/ui/select';
import { Switch } from '@client/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/components/ui/dialog';
import { Plus, Trash2, Edit2, RefreshCw, FileSearch } from 'lucide-react';
import { cn } from '@client/lib/utils';

interface DocsReviewRule {
  id: string;
  name: string;
  trigger: string;
  skill: string;
  criteria: string;
  enabled: boolean;
  use_live_docs: boolean;
  sort_order: number;
  updated_at: string;
}

const SKILL_OPTIONS = [
  { value: 'agents-sdk', label: 'Agents SDK' },
  { value: 'workers-best-practices', label: 'Workers best practices' },
  { value: 'cloudflare-jedi', label: 'Cloudflare Jedi' },
  { value: 'cloudflare', label: 'Cloudflare (general)' },
];

export function DocsReviewManager() {
  const [rules, setRules] = useState<DocsReviewRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<DocsReviewRule | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState('');
  const [skill, setSkill] = useState('agents-sdk');
  const [criteria, setCriteria] = useState('');
  const [useLiveDocs, setUseLiveDocs] = useState(true);

  const fetchRules = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/docs-review-rules');
      if (!res.ok) throw new Error('Failed to fetch rules');
      const data = await res.json() as any;
      setRules(data.rules || []);
    } catch {
      toast.error('Could not load docs-review rules.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRules(); }, []);

  const openDialog = (rule?: DocsReviewRule) => {
    if (rule) {
      setEditing(rule);
      setName(rule.name);
      setTrigger(rule.trigger);
      setSkill(rule.skill);
      setCriteria(rule.criteria);
      setUseLiveDocs(rule.use_live_docs);
    } else {
      setEditing(null);
      setName('');
      setTrigger('');
      setSkill('agents-sdk');
      setCriteria('');
      setUseLiveDocs(true);
    }
    setIsDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error('Enter a descriptive name.');
    if (!trigger.trim()) return toast.error('Enter a trigger (regular expression).');
    if (!criteria.trim()) return toast.error('Describe what to review for.');
    try {
      setIsSaving(true);
      const payload = { name, trigger, skill, criteria, use_live_docs: useLiveDocs };
      const res = editing
        ? await fetch(`/api/docs-review-rules/${editing.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch('/api/docs-review-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as any;
        throw new Error(err.error || 'Failed to save rule');
      }
      toast.success(editing ? 'Rule updated' : 'Rule created');
      setIsDialogOpen(false);
      fetchRules();
    } catch (err: any) {
      toast.error(err.message || 'Error saving rule');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this docs-review rule?')) return;
    try {
      const res = await fetch(`/api/docs-review-rules/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      toast.success('Rule deleted');
      fetchRules();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete');
    }
  };

  const handleToggle = async (rule: DocsReviewRule) => {
    try {
      const res = await fetch(`/api/docs-review-rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      if (!res.ok) throw new Error('Failed to toggle');
      setRules(cur => cur.map(r => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)));
    } catch {
      toast.error('Failed to toggle rule');
    }
  };

  return (
    <section className="surface min-w-0 overflow-hidden">
      <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Docs-review triggers</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            When a rule's trigger matches a PR, codra checks the code against the official Cloudflare docs for the skill and files any gotchas as pending best practices.
          </p>
        </div>
        <Button size="sm" onClick={() => openDialog()} className="h-8 gap-1.5 text-xs">
          <Plus size={12} />
          Add Rule
        </Button>
      </div>

      {loading ? (
        <div className="p-5 space-y-4">
          <div className="h-10 w-full animate-pulse bg-muted rounded" />
          <div className="h-10 w-full animate-pulse bg-muted rounded" />
        </div>
      ) : rules.length === 0 ? (
        <div className="px-5 py-14 text-center">
          <FileSearch className="mx-auto h-8 w-8 text-muted-foreground/45" />
          <p className="mt-2 text-sm font-medium text-foreground">No docs-review rules</p>
          <p className="mt-1 text-xs text-muted-foreground">Add one to check PRs against the Cloudflare docs.</p>
        </div>
      ) : (
        <div className="divide-y divide-border/40">
          {rules.map(rule => (
            <article
              key={rule.id}
              className={cn('group flex min-w-0 flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5', !rule.enabled && 'opacity-60')}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">{rule.name}</h3>
                  <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    {rule.skill}
                  </span>
                  {rule.use_live_docs && (
                    <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary uppercase tracking-wider">
                      Live docs
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{rule.criteria}</p>
                <div className="text-xs text-muted-foreground">
                  Trigger: <code className="bg-muted px-1 py-0.5 rounded text-[11px]">{rule.trigger}</code>
                </div>
              </div>

              <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/20 pt-2 sm:border-0 sm:pt-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Enabled</span>
                  <Switch checked={rule.enabled} onCheckedChange={() => handleToggle(rule)} />
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => openDialog(rule)} className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground" aria-label="Edit rule">
                    <Edit2 size={13} />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(rule.id)} className="h-8 w-8 p-0 text-muted-foreground hover:bg-danger/5 hover:text-danger" aria-label="Delete rule">
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl bg-card border border-border">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Docs-Review Rule' : 'Add Docs-Review Rule'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Descriptive Name</label>
                <Input placeholder="e.g. Agents SDK — Durable Objects & migrations" value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Select label="Cloudflare skill (docs source)" value={skill} onValueChange={setSkill} options={SKILL_OPTIONS} />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 flex items-center justify-between">
                <span>Trigger (regular expression, matched against changed paths + diff)</span>
                <span className="normal-case font-normal opacity-70 text-[9px]">e.g. routeAgentRequest|extends Agent</span>
              </label>
              <Input placeholder="Regex — the review runs when this matches the PR" value={trigger} onChange={e => setTrigger(e.target.value)} className="font-mono text-xs" />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">What to review for</label>
              <textarea
                value={criteria}
                onChange={e => setCriteria(e.target.value)}
                placeholder="e.g. Verify DO interactions go through Agents SDK methods, migrations are in wrangler.jsonc, and DOs are exported from the entrypoint."
                className="min-h-[110px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block text-xs font-medium text-foreground">Query live Cloudflare docs</span>
                <span className="block text-[11px] text-muted-foreground">
                  Also call the official docs MCP (<code className="text-[10px]">search_cloudflare_documentation</code>) at review time and include the results.
                </span>
              </span>
              <Switch checked={useLiveDocs} onCheckedChange={setUseLiveDocs} />
            </label>

            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" onClick={() => setIsDialogOpen(false)} disabled={isSaving} className="text-muted-foreground">
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? <RefreshCw className="mr-1.5 h-3 w-3 animate-spin" /> : null}
                Save Rule
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
