import { Zap, GitBranch } from 'lucide-react';

export function Footer() {
  return (
    <footer className="border-t border-border/30 py-10">
      <div className="container mx-auto px-6 md:px-10">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">

          {/* Brand */}
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/15">
              <Zap size={11} className="text-primary" />
            </div>
            <span className="text-sm font-semibold text-foreground">Codra</span>
            <span className="text-[10px] text-muted-foreground/40 font-medium">· MIT License</span>
          </div>

          {/* Links */}
          <div className="flex items-center gap-8">
            {[
              { label: 'GitHub', href: 'https://github.com/devarshishimpi/codra', external: true },
              { label: 'Documentation', href: '#', external: false },
              { label: 'Changelog', href: '#', external: false },
            ].map(link => (
              <a
                key={link.label}
                href={link.href}
                target={link.external ? '_blank' : undefined}
                rel={link.external ? 'noopener noreferrer' : undefined}
                className="text-xs text-muted-foreground/50 hover:text-foreground transition-colors font-medium"
              >
                {link.label}
              </a>
            ))}
          </div>

          {/* Credit */}
          <p className="text-xs text-muted-foreground/40">
            Built by{' '}
            <a
              href="https://devarshi.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-primary transition-colors font-semibold"
            >
              Devarshi Shimpi
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
