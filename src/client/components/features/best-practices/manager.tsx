import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@client/components/ui/button';
import { Input } from '@client/components/ui/input';
import { Select } from '@client/components/ui/select';
import { Switch } from '@client/components/ui/switch';
import { PlateEditor } from '@client/components/plate-editor';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/components/ui/dialog';
import {
  Layers,
  Plus,
  Trash2,
  Edit2,
  RefreshCw,
  X,
  BookOpen,
  Terminal,
} from 'lucide-react';
import { cn } from '@client/lib/utils';

export interface BestPractice {
  id: string;
  name: string;
  infraId: string;
  infraName: string;
  criteria: string;
  instructions: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Infrastructure {
  id: string;
  name: string;
  createdAt: string;
}

export function BestPracticesManager() {
  const [practices, setPractices] = useState<BestPractice[]>([]);
  const [infrastructures, setInfrastructures] = useState<Infrastructure[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingPractice, setEditingPractice] = useState<BestPractice | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Form states
  const [name, setName] = useState('');
  const [infraId, setInfraId] = useState('cloudflare-workers');
  const [customInfraName, setCustomInfraName] = useState('');
  const [criteria, setCriteria] = useState('');
  const [instructions, setInstructions] = useState('');

  const fetchInfrastructures = async () => {
    try {
      const res = await fetch('/api/best-practices/infrastructures');
      if (!res.ok) throw new Error('Failed to fetch infrastructures');
      const data = await res.json() as any;
      setInfrastructures(data.infrastructures || []);
    } catch (err) {
      toast.error('Could not load infrastructure categories.');
    }
  };

  const fetchBestPractices = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/best-practices');
      if (!res.ok) throw new Error('Failed to fetch best practices');
      const data = await res.json() as any;
      setPractices(data.bestPractices || []);
    } catch (err) {
      toast.error('Could not load best practices.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBestPractices();
    fetchInfrastructures();
  }, []);

  const handleOpenDialog = (practice?: BestPractice) => {
    if (practice) {
      setEditingPractice(practice);
      setName(practice.name);
      setInfraId(practice.infraId);
      setCustomInfraName('');
      setCriteria(practice.criteria);
      setInstructions(practice.instructions);
    } else {
      setEditingPractice(null);
      setName('');
      setInfraId('cloudflare-workers');
      setCustomInfraName('');
      setCriteria('');
      setInstructions('');
    }
    setIsDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Please enter a descriptive name.');
      return;
    }
    if (infraId === 'other' && !customInfraName.trim()) {
      toast.error('Please specify the new infrastructure name.');
      return;
    }
    if (!criteria.trim()) {
      toast.error('Please specify code matching criteria.');
      return;
    }
    if (!instructions.trim()) {
      toast.error('Please write instruction content.');
      return;
    }

    try {
      setIsSaving(true);
      const payload = {
        name,
        infraId,
        infraName: infraId === 'other' ? customInfraName : undefined,
        criteria,
        instructions,
      };

      let res;
      if (editingPractice) {
        res = await fetch(`/api/best-practices/${editingPractice.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch('/api/best-practices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({})) as any;
        throw new Error(errorData.error || 'Failed to save best practice');
      }

      toast.success(editingPractice ? 'Best practice updated' : 'Best practice created');
      setIsDialogOpen(false);
      fetchBestPractices();
      fetchInfrastructures();
    } catch (err: any) {
      toast.error(err.message || 'Error occurred while saving');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this best practice?')) return;

    try {
      const res = await fetch(`/api/best-practices/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete best practice');
      toast.success('Best practice deleted');
      fetchBestPractices();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete');
    }
  };

  const handleToggleActive = async (practice: BestPractice) => {
    try {
      const res = await fetch(`/api/best-practices/${practice.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !practice.isActive }),
      });
      if (!res.ok) throw new Error('Failed to toggle status');
      setPractices(current =>
        current.map(p => (p.id === practice.id ? { ...p, isActive: !p.isActive } : p))
      );
      toast.success(practice.isActive ? 'Best practice deactivated' : 'Best practice activated');
    } catch (err: any) {
      toast.error('Failed to toggle best practice state');
    }
  };

  const infraOptions = [
    ...infrastructures.map(infra => ({ value: infra.id, label: infra.name })),
    { value: 'other', label: 'Other (Create new...)' },
  ];

  return (
    <section className="surface min-w-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Custom Best Practices</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Configure target rules and criteria. Matching rules are injected during code reviews.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => handleOpenDialog()}
          className="h-8 gap-1.5 text-xs"
        >
          <Plus size={12} />
          Add Practice
        </Button>
      </div>

      {/* Main List */}
      {loading ? (
        <div className="divide-y divide-border/40 p-5 space-y-4">
          <div className="h-10 w-full animate-pulse bg-muted rounded" />
          <div className="h-10 w-full animate-pulse bg-muted rounded" />
          <div className="h-10 w-full animate-pulse bg-muted rounded" />
        </div>
      ) : practices.length === 0 ? (
        <div className="px-5 py-14 text-center">
          <BookOpen className="mx-auto h-8 w-8 text-muted-foreground/45" />
          <p className="mt-2 text-sm font-medium text-foreground">No best practices configured</p>
          <p className="mt-1 text-xs text-muted-foreground">Add one to inject rules into AI code reviews.</p>
        </div>
      ) : (
        <div className="divide-y divide-border/40">
          {practices.map(practice => (
            <article
              key={practice.id}
              className={cn(
                'group flex min-w-0 flex-col gap-2 p-4 transition-colors sm:flex-row sm:items-center sm:gap-4 sm:px-5',
                !practice.isActive && 'opacity-60'
              )}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">{practice.name}</h3>
                  <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    {practice.infraName}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Terminal size={12} className="opacity-70" />
                  <span className="truncate">Criteria: <code className="bg-muted px-1 py-0.5 rounded text-[11px]">{practice.criteria}</code></span>
                </div>
              </div>

              {/* Controls */}
              <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/20 pt-2 sm:border-0 sm:pt-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Active</span>
                  <Switch
                    checked={practice.isActive}
                    onCheckedChange={() => handleToggleActive(practice)}
                  />
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleOpenDialog(practice)}
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                    aria-label="Edit best practice"
                  >
                    <Edit2 size={13} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(practice.id)}
                    className="h-8 w-8 p-0 text-muted-foreground hover:bg-danger/5 hover:text-danger"
                    aria-label="Delete best practice"
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Editor dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl bg-card border border-border">
          <DialogHeader>
            <DialogTitle>{editingPractice ? 'Edit Best Practice' : 'Add Best Practice'}</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                  Descriptive Name
                </label>
                <Input
                  placeholder="e.g. Workers AI Gateway Integration"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Select
                  label="Infrastructure"
                  value={infraId}
                  onValueChange={setInfraId}
                  options={infraOptions}
                />
              </div>
            </div>

            {infraId === 'other' && (
              <div className="space-y-1.5 animate-slide-down">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                  Infrastructure Category Name
                </label>
                <Input
                  placeholder="e.g. Workers AI"
                  value={customInfraName}
                  onChange={e => setCustomInfraName(e.target.value)}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 flex items-center justify-between">
                <span>Code criteria (comma-separated evaluation rules)</span>
                <span className="normal-case font-normal opacity-70 text-[9px]">e.g. ai-gateway, shadcn, d1</span>
              </label>
              <Input
                placeholder="Injected if file path or content matches these terms"
                value={criteria}
                onChange={e => setCriteria(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                Instructions (Rich PlateJS Text Editor)
              </label>
              <PlateEditor
                value={instructions}
                onChange={setInstructions}
                placeholder="Enter rules, best practices, and suggestions..."
                className="max-h-[300px] overflow-y-auto"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsDialogOpen(false)}
                disabled={isSaving}
                className="text-muted-foreground"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? <RefreshCw className="mr-1.5 h-3 w-3 animate-spin" /> : null}
                Save Practice
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
