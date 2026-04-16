import { FormEvent, useState } from 'react';
import { api } from '@client/lib/api';
import { Button } from '@client/components/ui/button';
import { Input } from '@client/components/ui/input';
import { Zap } from 'lucide-react';

export function LoginPage() {
  const [password, setPassword] = useState('');
  const [pending, setPending]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.login({ password });
      location.href = '/dashboard';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-svh flex items-center justify-center bg-background p-6">

      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div
          className="absolute -top-60 -left-60 h-[700px] w-[700px] rounded-full opacity-20 blur-[120px]"
          style={{ background: 'var(--primary)' }}
        />
        <div
          className="absolute -bottom-60 -right-60 h-[600px] w-[600px] rounded-full opacity-10 blur-[120px]"
          style={{ background: 'var(--primary)' }}
        />
      </div>

      {/* Form card */}
      <div
        className="relative z-10 w-full max-w-[400px]"
        style={{ animation: 'fade-up 0.6s var(--ease-out-expo) both' }}
      >
        <div className="glass p-10 flex flex-col gap-8 rounded-2xl shadow-2xl">

          {/* Brand */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary shadow-md">
                <Zap size={18} className="text-primary-foreground" strokeWidth={2.5} />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span
                  className="text-xl font-bold text-foreground"
                  style={{ letterSpacing: '-0.025em' }}
                >
                  Codra
                </span>
                <span className="text-[9px] font-bold uppercase tracking-widest text-primary/60">
                  review
                </span>
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              PR review control panel. Sign in with the shared dashboard password.
            </p>
          </div>

          <div className="h-px bg-border" />

          {/* Field */}
          <div className="flex flex-col gap-2">
            <label
              htmlFor="password"
              className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
            >
              Password
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Dashboard password"
              autoFocus
              className="h-10 bg-background shadow-none text-base"
            />
          </div>

          {error && (
            <div
              className="rounded-md border px-3 py-2.5 text-sm"
              style={{
                background: 'var(--danger-bg)',
                borderColor: 'var(--danger-border)',
                color: 'var(--danger)',
              }}
            >
              {error}
            </div>
          )}

          <Button
            id="login-submit"
            type="submit"
            form="login-form"
            disabled={pending || !password}
            className="w-full h-10 font-semibold"
          >
            {pending ? 'Signing in…' : 'Sign in'}
          </Button>
        </div>

        {/* Invisible form so Button[form] works */}
        <form id="login-form" onSubmit={onSubmit} style={{ display: 'none' }} />
      </div>
    </div>
  );
}
