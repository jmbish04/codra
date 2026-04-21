import { Hero } from '@client/components/landing/hero';
import { CTA } from '@client/components/landing/cta';
import { Footer } from '@client/components/landing/footer';
import { TopNav } from '@client/components/landing/top-nav';
import {
  ShieldCheck,
  Code2,
  Layers,
  Bot,
  GitPullRequest,
  Eye,
  MessageSquare,
} from 'lucide-react';

const FEATURES = [
  {
    icon: ShieldCheck,
    title: 'Security Analysis',
    desc: 'Flags credential leaks, injection vectors, insecure deserialization, and logic flaws that pattern matchers miss.',
  },
  {
    icon: Layers,
    title: 'Architectural Context',
    desc: 'Validates diffs against your repo\'s domain structure and design patterns — not just syntax.',
  },
  {
    icon: Bot,
    title: 'Adaptive Intelligence',
    desc: 'Routes reviews through configurable model chains — primary + fallback — scaled by PR complexity.',
  },
  {
    icon: Code2,
    title: '100% Open Source',
    desc: 'Full source on GitHub. Fork it, audit it, extend it. No black boxes.',
  },
];

const HOW_STEPS = [
  {
    icon: GitPullRequest,
    step: '01',
    title: 'PR opened',
    desc: 'A developer opens a pull request on any connected repository. Codra receives the webhook instantly.',
  },
  {
    icon: Eye,
    step: '02',
    title: 'Deep analysis',
    desc: 'Codra reads the diff in full context — not just changed lines, but the surrounding architecture and your repo\'s patterns.',
  },
  {
    icon: MessageSquare,
    step: '03',
    title: 'Inline review',
    desc: 'Structured comments land directly on the PR — severity-tagged, categorized, and actionable.',
  },
];

export function LandingPage() {
  return (
    <div className="min-h-screen bg-background overflow-x-hidden pt-14">
      <TopNav />

      <main>
        {/* ── Hero ── */}
        <Hero />

        {/* ── Features ── */}
        <section id="features" className="py-20 border-t border-border/40">
          <div className="container mx-auto px-6 md:px-10">
            <div className="mb-12">
              <p className="text-xs font-semibold uppercase tracking-widest text-primary/70 mb-3">
                Capabilities
              </p>
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
                Not a linter. A reviewer.
              </h2>
              <p className="text-sm text-muted-foreground mt-2 max-w-xl leading-relaxed">
                Static analysis catches syntax. Codra understands intent — the why behind a diff, not just the what.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-border/30 border border-border/30 rounded-lg overflow-hidden">
              {FEATURES.map(({ icon: Icon, title, desc }, i) => (
                <div
                  key={i}
                  className="bg-card p-6 hover:bg-card/80 transition-colors group"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary mb-4 transition-transform group-hover:scale-110">
                    <Icon size={16} strokeWidth={1.75} />
                  </div>
                  <h3 className="text-sm font-semibold text-foreground mb-2 tracking-tight">{title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── How it works ── */}
        <section id="how" className="py-20 border-t border-border/40">
          <div className="container mx-auto px-6 md:px-10">
            <div className="mb-12">
              <p className="text-xs font-semibold uppercase tracking-widest text-primary/70 mb-3">
                How it works
              </p>
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
                Zero config. Instant signal.
              </h2>
              <p className="text-sm text-muted-foreground mt-2 max-w-xl leading-relaxed">
                Install the GitHub App, connect your repos, and Codra reviews every PR automatically.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
              {/* Connector line (desktop) */}
              <div
                aria-hidden
                className="hidden md:block absolute top-5 left-[calc(16.67%+16px)] right-[calc(16.67%+16px)] h-px bg-border/60"
              />

              {HOW_STEPS.map(({ icon: Icon, step, title, desc }, i) => (
                <div key={i} className="relative flex flex-col gap-4">
                  <div className="flex items-center gap-4">
                    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-card border border-border/60 text-primary z-10">
                      <Icon size={17} strokeWidth={1.75} />
                    </div>
                    <span className="font-mono text-[11px] font-bold text-muted-foreground/40 tracking-widest">
                      {step}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-1.5 tracking-tight">{title}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA ── */}
        <CTA />
      </main>

      <Footer />
    </div>
  );
}
