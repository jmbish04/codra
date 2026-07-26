import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@client/components/ui/button';
import { cn } from '@client/lib/utils';

interface CopyButtonProps {
  /** The text to copy to the clipboard. */
  value: string;
  /** Label shown before copying. */
  label?: string;
  /** Label shown for ~2s after a successful copy. */
  copiedLabel?: string;
  className?: string;
  size?: 'sm' | 'default';
  variant?: 'default' | 'secondary' | 'outline' | 'ghost';
  disabled?: boolean;
}

/**
 * A copy-to-clipboard button with an in-component "Copied" confirmation — no
 * browser alert. Reverts after 2s.
 */
export function CopyButton({
  value,
  label = 'Copy',
  copiedLabel = 'Copied!',
  className,
  size = 'sm',
  variant = 'secondary',
  disabled,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API blocked — leave the button state unchanged rather than alert.
    }
  };

  return (
    <Button
      type="button"
      size={size}
      variant={copied ? 'default' : variant}
      onClick={copy}
      disabled={disabled}
      aria-live="polite"
      className={cn('gap-1.5 transition-colors', className)}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? copiedLabel : label}
    </Button>
  );
}
