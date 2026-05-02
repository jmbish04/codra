import { useState, useMemo, useEffect } from 'react';
import { cn } from '@client/lib/utils';
import { Select } from '@client/components/ui/select';
import { Button } from '@client/components/ui/button';
import { Trash2, ListPlus } from 'lucide-react';

export const PROVIDERS = [
  { value: 'cloudflare', label: 'Cloudflare' },
  { value: 'google',     label: 'Google' },
];

export const MODELS = [
  { value: 'gemma-4-31b-it',               label: 'Gemma 4 (31b)',       provider: 'google' },
  { value: 'gemma-4-26b-a4b-it',           label: 'Gemma 4 (26b)',       provider: 'google' },
  { value: '@cf/moonshotai/kimi-k2.5',     label: 'Kimi K2.5',           provider: 'cloudflare' },
  { value: '@cf/zai-org/glm-4.7-flash',    label: 'GLM 4.7 Flash',       provider: 'cloudflare' },
];

interface ModelSelectorProps {
  value: string;
  onValueChange: (value: string) => void;
  hideLabels?: boolean;
  className?: string;
}

export function ModelSelector({ value, onValueChange, hideLabels, className }: ModelSelectorProps) {
  const currentModel = MODELS.find(m => m.value === value) || MODELS[0];
  const [provider, setProvider] = useState(currentModel.provider);

  // Keep provider in sync when value changes from parent
  useEffect(() => {
    const model = MODELS.find(m => m.value === value);
    if (model && model.provider !== provider) {
      setProvider(model.provider);
    }
  }, [value]);

  const filteredModels = useMemo(() => 
    MODELS.filter(m => m.provider === provider).map(m => ({ value: m.value, label: m.label })),
  [provider]);

  return (
    <div className={cn("grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2 sm:items-end", className)}>
      <Select 
        label={hideLabels ? undefined : "Provider"}
        value={provider}
        onValueChange={(p) => {
          setProvider(p);
          const first = MODELS.find(m => m.provider === p);
          if (first) onValueChange(first.value);
        }}
        options={PROVIDERS}
      />
      <Select 
        label={hideLabels ? undefined : "Model"}
        value={value}
        onValueChange={onValueChange}
        options={filteredModels}
      />
    </div>
  );
}

interface ModelChainProps {
  primary: string;
  fallbacks: string[];
  onChange: (primary: string, fallbacks: string[]) => void;
}

export function ModelChain({ primary, fallbacks, onChange }: ModelChainProps) {
  const addFallback = () => onChange(primary, [...fallbacks, MODELS[0].value]);
  const removeFallback = (idx: number) => onChange(primary, fallbacks.filter((_, i) => i !== idx));
  const updateFallback = (idx: number, val: string) => {
    const next = [...fallbacks];
    next[idx] = val;
    onChange(primary, next);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3 relative pl-4 border-l border-border/60">
        <div className="relative">
          <div className="absolute -left-[1.35rem] top-4 w-3 h-0.5 bg-primary/20"></div>
          <ModelSelector 
            value={primary} 
            onValueChange={(val) => onChange(val, fallbacks)} 
          />
        </div>

        {fallbacks.map((fb, i) => (
          <div key={i} className="relative group flex items-end gap-2 animate-in slide-in-from-left-2 fade-in">
            <div className="absolute -left-[1.35rem] top-4 w-3 h-0.5 bg-amber-500/20"></div>
            <div className="flex-1">
              <ModelSelector 
                value={fb} 
                hideLabels
                onValueChange={(val) => updateFallback(i, val)} 
              />
            </div>
            <Button 
              variant="ghost" 
              size="sm" 
              type="button"
              className="h-9 px-2 text-muted-foreground/40 hover:text-red-500 hover:bg-red-500/5 mb-0"
              onClick={(e) => { e.stopPropagation(); removeFallback(i); }}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ))}

        <button 
          type="button"
          className="ml-1 text-[10px] font-bold text-primary/60 hover:text-primary transition-colors flex items-center gap-1.5 py-1"
          onClick={addFallback}
        >
          <ListPlus size={12} /> Add Secondary Model
        </button>
      </div>
    </div>
  );
}
