import { Zap } from 'lucide-react';

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-border/40 py-12">
      <div className="container mx-auto px-6">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4 lg:grid-cols-5 mb-12">
          <div className="col-span-2 lg:col-span-2">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex h-7 w-7 items-center justify-center rounded bg-primary">
                <Zap size={14} className="text-primary-foreground" />
              </div>
              <span className="text-base font-black tracking-tighter text-foreground uppercase">Codra</span>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground max-w-xs">
              Self-hosted AI code review. Built in the open, for teams that care about what runs in their stack.
            </p>
          </div>

          <div>
            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground mb-4">Community</h4>
            <ul className="space-y-3 text-xs text-muted-foreground">
              <li><a href="https://github.com/devarshishimpi/codra" className="transition-colors hover:text-foreground">GitHub</a></li>
              <li><a href="#" className="transition-colors hover:text-foreground">Discussions</a></li>
              <li><a href="#" className="transition-colors hover:text-foreground">Code of Conduct</a></li>
              <li><a href="#" className="transition-colors hover:text-foreground">Contributing</a></li>
            </ul>
          </div>

          <div>
            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground mb-4">Resources</h4>
            <ul className="space-y-3 text-xs text-muted-foreground">
              <li><a href="#" className="transition-colors hover:text-foreground">Documentation</a></li>
              <li><a href="#" className="transition-colors hover:text-foreground">Integrations</a></li>
              <li><a href="#" className="transition-colors hover:text-foreground">Security</a></li>
              <li><a href="#" className="transition-colors hover:text-foreground">Changelog</a></li>
            </ul>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-t border-border/20 pt-6 text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/50">
          <p>© {currentYear} The Codra Community · MIT License</p>
          <div className="flex gap-6">
            <a href="#" className="transition-colors hover:text-muted-foreground">Privacy</a>
            <a href="#" className="transition-colors hover:text-muted-foreground">Terms</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
