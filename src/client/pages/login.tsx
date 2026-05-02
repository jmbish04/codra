import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@client/components/ui/button';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@client/lib/theme';
import codraDark from '@/assets/codra-fullicon-dark.svg';
import codraLight from '@/assets/codra-fullicon-light.svg';

function getErrorMessage(error: string | null) {
  switch (error) {
    case 'not_allowed':
      return 'This GitHub account is not allowed to access the Codra dashboard.';
    case 'access_denied':
      return 'GitHub sign-in was cancelled before authorization completed.';
    case 'invalid_state':
      return 'Your sign-in session expired. Please try signing in with GitHub again.';
    case 'invalid_callback':
      return 'GitHub did not return a valid callback. Please try again.';
    case 'oauth_failed':
      return 'GitHub sign-in failed while completing the OAuth flow.';
    default:
      return null;
  }
}

export function LoginPage() {
  const { theme, toggleTheme } = useTheme();
  const [searchParams] = useSearchParams();
  const error = useMemo(() => getErrorMessage(searchParams.get('error')), [searchParams]);

  return (
    <div className="min-h-svh flex items-center justify-center bg-background p-6 relative">
      <button
        onClick={toggleTheme}
        className="fixed top-6 right-6 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-sm hover:bg-secondary transition-colors z-50 text-muted-foreground hover:text-foreground"
        aria-label="Toggle theme"
      >
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>

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

      <div
        className="relative z-10 w-full max-w-[420px]"
        style={{ animation: 'fade-up 0.6s var(--ease-out-expo) both' }}
      >
        <div className="glass p-10 flex flex-col gap-8 rounded-md shadow-2xl">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <img
                src={theme === 'dark' ? codraDark : codraLight}
                alt="Codra"
                className="h-9 w-auto"
              />
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              PR review control panel. Sign in with the approved GitHub account for this Codra instance.
            </p>
          </div>

          <div className="h-px bg-border" />

          <div className="rounded-md border border-border/70 bg-background/70 px-4 py-3 text-sm text-muted-foreground leading-relaxed">
            Dashboard access is restricted to GitHub users listed in the deployment allowlist. This production instance currently accepts the configured owner account only.
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

          <a href="/auth/github" className="w-full">
            <Button
              id="login-submit"
              type="button"
              className="w-full h-10 font-semibold"
            >
              Sign in with GitHub
            </Button>
          </a>
        </div>
      </div>
    </div>
  );
}
