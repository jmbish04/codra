import { NavLink, Outlet, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from '@client/lib/api';
import {
  LayoutDashboard,
  AlignLeft,
  GitBranch,
  BarChart2,
  HeartPulse,
  LogOut,
  Sun,
  Moon,
  Activity,
  Settings,
  Star,
  X,
} from 'lucide-react';
import { cn } from '@client/lib/utils';
import { useTheme } from '@client/lib/theme';
import codraDark from '@/assets/codra-fullicon-dark.svg';
import codraLight from '@/assets/codra-fullicon-light.svg';
import type { AuthSessionUser } from '@shared/api';

const links = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/jobs',      label: 'Jobs',     icon: Activity,        end: false },
  { to: '/repos',     label: 'Repos',    icon: GitBranch,       end: false },
  { to: '/stats',     label: 'Stats',    icon: BarChart2,       end: false },
  { to: '/settings',  label: 'Settings', icon: Settings,        end: false },
];

export function AppShell() {
  const { theme, toggleTheme } = useTheme();
  const [sessionUser, setSessionUser] = useState<AuthSessionUser | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    api.getSession()
      .then((response) => {
        if (!cancelled) {
          setSessionUser(response.user);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSessionUser(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-svh bg-background">

      {/* Mobile Overlay */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-30 lg:hidden" 
          onClick={() => setMobileMenuOpen(false)} 
        />
      )}

      {/* ────────────────────────── Sidebar ────────────────────────── */}
      <aside
        style={{ width: 'var(--sidebar-width)' }}
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col glass border-r border-border transition-transform duration-300 lg:translate-x-0 h-[100dvh]",
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >

        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <Link to="/dashboard" className="flex items-center gap-2 transition-colors hover:opacity-80">
            <img 
              src={theme === 'dark' ? codraDark : codraLight} 
              alt="Codra" 
              className="h-7 w-auto" 
            />
          </Link>
          <div className="flex items-center gap-1">
            <button
              onClick={toggleTheme}
              className="hidden lg:flex h-8 w-8 items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden h-8 w-8 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              aria-label="Close sidebar"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2.5 pt-3 overflow-y-auto">
          <div className="mb-1 px-2 pb-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
              Navigation
            </p>
          </div>
          <div className="flex flex-col gap-0.5">
            {links.map(({ to, label, end, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={() => setMobileMenuOpen(false)}
                className={({ isActive }) =>
                  cn('nav-item', isActive && 'active')
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      size={15}
                      strokeWidth={isActive ? 2.25 : 1.75}
                      className={cn(
                        'shrink-0 transition-colors',
                        isActive ? 'text-primary' : 'text-muted-foreground/70',
                      )}
                    />
                    {label}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>

        {/* Footer */}
        <div className="shrink-0 border-t border-border p-2.5">
          <a
            href="https://github.com/devarshishimpi/codra"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 mb-3 w-full rounded-md bg-secondary text-secondary-foreground hover:brightness-110 border border-border py-2 text-xs font-semibold transition-all"
          >
            <Star size={14} />
            Star on GitHub
          </a>
          {sessionUser && (
            <div className="mb-2 rounded-md border border-border/60 bg-background/60 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                Signed In
              </p>
              <p className="mt-1 truncate text-sm font-medium text-foreground">
                @{sessionUser.login}
              </p>
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            <button
              id="logout-btn"
              type="button"
              className="nav-item"
              onClick={async () => {
                await api.logout();
                location.href = '/login';
              }}
            >
              <LogOut size={15} strokeWidth={1.75} className="shrink-0 text-muted-foreground/70" />
              Log out
            </button>
          </div>


        </div>
      </aside>

      {/* ────────────────────────── Main ────────────────────────── */}
      <main className="flex-1 min-w-0 transition-colors duration-300 lg:ml-[var(--sidebar-width)] flex flex-col">
        
        {/* Top Header */}
        <header className="lg:hidden h-14 border-b border-border flex items-center justify-between px-4 shrink-0">
          <button
            className="p-2 -ml-2 text-muted-foreground hover:text-foreground"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open menu"
          >
            <AlignLeft size={20} />
          </button>

          <button
            onClick={toggleTheme}
            className="h-8 w-8 flex items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </header>

        <div className="mx-auto max-w-screen-xl w-full px-4 md:px-8 py-6 md:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
