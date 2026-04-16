import { Link } from 'react-router-dom';
import { Zap, Sun, Moon } from 'lucide-react';
import { Button } from '@client/components/ui/button';
import { useTheme } from '@client/lib/theme';

export function TopNav() {
  const { theme, toggleTheme } = useTheme();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 flex h-16 items-center justify-between px-8 glass border-b border-border/40">
      <div className="flex items-center gap-4">
        <Link to="/" className="flex items-center gap-3 group transition-transform hover:scale-105">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary shadow-lg shadow-primary/20">
            <Zap size={18} className="text-primary-foreground" strokeWidth={3} />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-lg font-black tracking-tighter text-foreground uppercase">Codra</span>
            <span className="text-[8px] font-black tracking-[0.3em] text-primary uppercase">Engine</span>
          </div>
        </Link>
      </div>

      <div className="hidden items-center gap-10 md:flex">
        {[
          { name: 'Architecture', href: '#features' },
          { name: 'Ecosystem', href: '#' },
          { name: 'Docs', href: '#' },
        ].map((item) => (
          <a
            key={item.name}
            href={item.href}
            className="text-[10px] font-black uppercase tracking-[0.25em] text-muted-foreground transition-colors hover:text-primary"
          >
            {item.name}
          </a>
        ))}
      </div>

      <div className="flex items-center gap-6">
        <button
          onClick={toggleTheme}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 text-muted-foreground transition-all hover:bg-secondary hover:text-primary active:scale-90"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <Link to="/login">
          <Button size="sm" className="h-9 px-6 text-[10px] font-black uppercase tracking-widest shadow-lg shadow-primary/10">
            Sign In
          </Button>
        </Link>
      </div>
    </nav>
  );
}
