import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@client/components/layout/page-header';
import { Button } from '@client/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@client/components/ui/card';
import { Input } from '@client/components/ui/input';
import { Plus, Download, Upload, Trash2, Edit2, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/components/ui/dialog';
import { PlateEditor } from '@client/components/plate-editor';
import { Label } from '@client/components/ui/label';

interface Prompt {
  name: string;
  content: string;
}

export function PromptsPage() {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [content, setContent] = useState('');

  const fetchPrompts = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/prompts');
      if (!res.ok) throw new Error('Failed to fetch prompts');
      const data = (await res.json()) as any;
      setPrompts(data.prompts || []);
    } catch (error) {
      toast.error('Could not load prompts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPrompts();
  }, []);

  const handleOpenDialog = (prompt?: Prompt) => {
    if (prompt) {
      setEditingPrompt(prompt);
      setName(prompt.name);
      setContent(prompt.content);
    } else {
      setEditingPrompt(null);
      setName('');
      setContent('');
    }
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim() || !content.trim()) {
      toast.error('Name and content are required');
      return;
    }

    try {
      setIsSaving(true);
      const res = await fetch('/api/prompts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ name: name.trim(), content: content.trim() }]),
      });

      if (!res.ok) throw new Error('Failed to save prompt');

      toast.success('Prompt saved successfully');
      setIsDialogOpen(false);
      fetchPrompts();
    } catch (error) {
      toast.error('Could not save prompt');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Are you sure you want to delete the prompt "${name}"?`)) return;

    try {
      const res = await fetch(`/api/prompts/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('Failed to delete prompt');

      toast.success('Prompt deleted');
      fetchPrompts();
    } catch (error) {
      toast.error('Could not delete prompt');
    }
  };

  const handleDownload = () => {
    const blob = new Blob([JSON.stringify(prompts, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'prompts.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsImporting(true);
      const text = await file.text();
      const importedPrompts = JSON.parse(text);

      if (!Array.isArray(importedPrompts)) {
        throw new Error('Invalid format: expected an array of prompts');
      }

      const res = await fetch('/api/prompts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(importedPrompts),
      });

      if (!res.ok) throw new Error('Failed to import prompts');

      toast.success('Prompts imported successfully');
      fetchPrompts();
    } catch (error) {
      toast.error('Failed to import prompts: Invalid file format');
    } finally {
      setIsImporting(false);
      if (e.target) e.target.value = ''; // reset input
    }
  };

  return (
    <section className="page-enter flex flex-col gap-5 pb-20">
      <div className="flex items-start justify-between">
        <PageHeader
          category="Configuration"
          title="Prompts"
          description="Manage and customize the system prompts used by AI agents."
        />
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleDownload} disabled={prompts.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
          <div className="relative">
            <input
              type="file"
              accept=".json"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
              onChange={handleImport}
              disabled={isImporting}
            />
            <Button variant="outline" disabled={isImporting}>
              {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Import
            </Button>
          </div>
          <Button onClick={() => handleOpenDialog()}>
            <Plus className="mr-2 h-4 w-4" />
            Add Prompt
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : prompts.length === 0 ? (
        <div className="text-center py-20 border rounded-lg bg-muted/20">
          <p className="text-muted-foreground">No prompts found.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {prompts.map((prompt) => (
            <Card key={prompt.name}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-lg font-semibold">{prompt.name}</CardTitle>
                <div className="flex space-x-2">
                  <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(prompt)}>
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDelete(prompt.name)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <pre className="whitespace-pre-wrap rounded-md bg-muted p-4 text-sm font-mono overflow-auto max-h-60">
                  {prompt.content}
                </pre>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingPrompt ? 'Edit Prompt' : 'Create Prompt'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name / Key</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!!editingPrompt}
                placeholder="e.g. repo-agent-system-prompt"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="content">Content</Label>
              {isDialogOpen && (
                <PlateEditor
                  key={editingPrompt?.name || 'new'}
                  value={content}
                  onChange={setContent}
                  placeholder="You are an expert code reviewer..."
                  className="min-h-[300px]"
                />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editingPrompt ? 'Save Changes' : 'Create Prompt'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
