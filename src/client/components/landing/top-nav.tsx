import { Link } from 'react-router-dom';
import { Zap, Sun, Moon } from 'lucide-react';
import { Button } from '@client/components/ui/button';
import { useTheme } from '@client/lib/theme';

export function TopNav() {
  const { theme, toggleTheme } = useTheme();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 h-14 flex items-center justify-between px-6 md:px-10 border-b border-border/30 bg-background/85 backdrop-blur-xl">
      {/* Logo */}
      <Link to="/" className="flex items-center gap-2.5 group">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary shadow-md shadow-primary/25 transition-transform group-hover:scale-105">
          <Zap size={14} className="text-primary-foreground" strokeWidth={2.5} />
        </div>
        <span className="text-sm font-bold tracking-tight text-foreground">
          Codra
        </span>
        <span className="hidden sm:inline text-[9px] font-semibold tracking-[0.2em] uppercase text-primary/60 border border-primary/20 rounded px-1.5 py-0.5">
          Review
        </span>
      </Link>

      {/* Center nav */}
      <div className="hidden md:flex items-center gap-8">
        {[
          { label: 'Features', href: '#features' },
          { label: 'How it works', href: '#how' },
          { label: 'Open source', href: '#oss' },
        ].map(item => (
          <a
            key={item.label}
            href={item.href}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors font-medium"
          >
            {item.label}
          </a>
        ))}
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={toggleTheme}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <Link to="/login">
          <Button size="sm" className="h-8 px-4 text-xs font-semibold">
            Sign in
          </Button>
        </Link>
      </div>
    </nav>
  );
}
