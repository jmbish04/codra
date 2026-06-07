import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@client/components/ui/button';
import { Sun, Moon, ShieldCheck } from 'lucide-react';
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
    <div className="min-h-svh flex flex-col items-center justify-center bg-background px-4 py-8 relative">
      <button
        onClick={toggleTheme}
        className="fixed top-6 right-6 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-sm hover:bg-secondary transition-colors z-50 text-muted-foreground hover:text-foreground"
        aria-label="Toggle theme"
      >
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      <div 
        className="w-full max-w-md flex flex-col items-center"
      >
        {/* Card */}
        <div className="w-full bg-card border border-border rounded-2xl p-10 sm:p-14 flex flex-col items-center gap-8">



          {/* Logo */}
          <img
            src={theme === 'dark' ? codraDark : codraLight}
            alt="Codra"
            className="h-11 w-auto"
          />

          {/* Heading + sub */}
          <div className="text-center space-y-2">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Welcome back
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Sign in with your approved GitHub account to access the PR review dashboard.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="w-full rounded-lg border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger text-left">
              {error}
            </div>
          )}

          {/* CTA */}
          <a href="/auth/github" className="w-full">
            <Button
              id="login-submit"
              type="button"
              className="w-full h-12 rounded-xl font-semibold text-[0.95rem] bg-foreground text-background hover:bg-foreground/90 transition-colors"
            >
              Sign in with GitHub
            </Button>
          </a>
        </div>

        {/* Footer note — outside the card */}
        <div className="mt-6 flex items-center gap-2.5 text-muted-foreground px-2">
          <ShieldCheck size={16} className="text-success shrink-0" />
          <p className="text-xs leading-snug">
            Only authorized GitHub users can access this instance.
          </p>
        </div>
      </div>
    </div>
  );
}
