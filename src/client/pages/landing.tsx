import { Sun, Moon, ArrowRight, ExternalLink } from 'lucide-react';
import { useTheme } from '@client/lib/theme';
import codraDark from '@/assets/codra-fullicon-dark.svg';
import codraLight from '@/assets/codra-fullicon-light.svg';

const FEATURES = [
  {
    title: 'Understands your codebase',
    desc: 'Reviews diffs with full context from the surrounding code, not just the changed lines.',
  },
  {
    title: 'Flags real issues',
    desc: 'Security vulnerabilities, logic errors, and pattern violations — surfaced before merge.',
  },
  {
    title: 'Configurable per repo',
    desc: 'Set review depth, model chain, and strictness from the dashboard. No config files.',
  },
];

export function LandingPage() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-svh bg-background text-foreground flex flex-col">

      {/* ── Header ── */}
      <header className="bg-card border-b border-border px-6 sm:px-10 h-14 flex items-center justify-between shrink-0">
        <img
          src={theme === 'dark' ? codraDark : codraLight}
          className="h-7 w-auto"
          alt="Codra"
        />
        <div className="flex items-center gap-3">
          <a
            href="/auth/github"
            className="h-8 px-4 inline-flex items-center gap-1.5 rounded-md bg-foreground text-background text-xs font-semibold hover:bg-foreground/90 transition-colors"
          >
            Sign in
            <ArrowRight size={12} />
          </a>
          <button
            onClick={toggleTheme}
            className="h-8 w-8 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_400px]">

        {/* Left — Hero */}
        <div className="bg-card flex flex-col justify-between px-8 py-12 sm:px-14 sm:py-16 lg:border-r border-b lg:border-b-0 border-border">

          <div className="space-y-8 max-w-lg">
            {/* Badge */}
            <span className="inline-flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-widest text-primary border border-primary/30 bg-primary/5 px-2.5 py-1 rounded-full">
              AI-powered · GitHub App
            </span>

            <div className="space-y-4">
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.08] font-mono uppercase">
                AI code review<br />on every PR.
              </h1>
              <p className="text-[0.95rem] text-muted-foreground leading-relaxed max-w-sm">
                Codra reviews pull requests automatically — checking for bugs,
                security issues, and code patterns specific to your repository.
              </p>
            </div>

            <a href="/auth/github">
              <button className="inline-flex items-center gap-2.5 h-10 px-5 bg-foreground text-background text-sm font-semibold rounded-lg hover:bg-foreground/90 active:scale-[0.98] transition-all">
                Get started with GitHub
                <ArrowRight size={15} />
              </button>
            </a>
          </div>

          {/* Footer links */}
          <div className="flex items-center gap-5 pt-14 text-xs text-muted-foreground border-t border-border mt-12">
            <a
              href="https://codra.run"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 hover:text-foreground transition-colors"
            >
              <ExternalLink size={11} />
              codra.run
            </a>
            <a
              href="https://github.com/devarshishimpi/codra"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 hover:text-foreground transition-colors"
            >
              <ExternalLink size={11} />
              GitHub
            </a>
          </div>
        </div>

        {/* Right — Features */}
        <div className="flex flex-col justify-center gap-6 px-8 py-12 sm:px-12 sm:py-16 border-t lg:border-t-0 border-border">
          <p className="text-[0.7rem] font-semibold uppercase tracking-widest text-muted-foreground/60">
            What it does
          </p>

          <div className="space-y-7">
            {FEATURES.map((item, i) => (
              <div key={item.title} className="flex gap-4">
                <span className="mt-[3px] w-5 h-5 rounded-full bg-primary/10 text-primary text-[0.65rem] font-bold flex items-center justify-center shrink-0">
                  {i + 1}
                </span>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

      </main>
    </div>
  );
}
