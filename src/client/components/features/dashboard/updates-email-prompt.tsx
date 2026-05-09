import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Check, Mail, RefreshCw } from 'lucide-react';
import { api } from '@client/lib/api';
import { Button } from '@client/components/ui/button';
import { Input } from '@client/components/ui/input';
import type { UpdatesEmailResponse } from '@shared/api';

export function UpdatesEmailPrompt() {
  const [status, setStatus] = useState<UpdatesEmailResponse | null>(null);
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getUpdatesEmailStatus()
      .then((response) => {
        if (!cancelled) setStatus(response);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (status?.status !== 'pending') return null;

  const subscribe = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);

    try {
      const response = await api.subscribeUpdates(email);
      setStatus(response);
      toast.success('Updates email saved', {
        description: 'You will only get important Codra release and security notes.',
      });
    } catch (error) {
      toast.error('Could not save updates email', {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="surface overflow-hidden">
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Mail size={16} strokeWidth={2.1} />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">Get important Codra updates</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Add an email for release notes, security fixes, and upgrade heads-up. You can opt out from any update email later. No spam.
            </p>
          </div>
        </div>

        <form onSubmit={subscribe} className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center lg:w-[31rem]">
          <Input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="h-9 min-w-0 flex-1"
            aria-label="Email for Codra release updates"
          />
          <div className="flex shrink-0 gap-2">
            <Button type="submit" size="sm" disabled={submitting} className="flex-1 gap-2 sm:flex-none">
              {submitting ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
              Save email
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}
