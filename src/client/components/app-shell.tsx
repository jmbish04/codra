import { NavLink, Outlet, Link } from 'react-router-dom';
import { api } from '@client/lib/api';
import {
  LayoutDashboard,
  GitBranch,
  BarChart2,
  HeartPulse,
  LogOut,
  Sun,
  Moon,
  Zap,
  Activity,
  Settings,
} from 'lucide-react';
import { cn } from '@client/lib/utils';
import { useTheme } from '@client/lib/theme';

const links = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/jobs',      label: 'Jobs',     icon: Activity,        end: false },
  { to: '/repos',     label: 'Repos',    icon: GitBranch,       end: false },
  { to: '/stats',     label: 'Stats',    icon: BarChart2,       end: false },
  { to: '/health',    label: 'System',   icon: HeartPulse,      end: false },
  { to: '/settings',  label: 'Settings', icon: Settings,        end: false },
];

export function AppShell() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="flex min-h-svh bg-background">

      {/* ────────────────────────── Sidebar ────────────────────────── */}
      <aside
        style={{ width: 'var(--sidebar-width)' }}
        className="fixed inset-y-0 left-0 z-30 flex flex-col glass border-r border-border transition-colors duration-300"
      >

        <Link to="/dashboard" className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4 transition-colors hover:bg-secondary/50">
          {/* Emerald icon mark */}
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary shadow-sm">
            <Zap size={14} className="text-primary-foreground" strokeWidth={2.5} />
          </div>
          <div className="flex items-baseline gap-1">
            <span
              className="text-[15px] font-bold text-foreground tracking-tight"
              style={{ letterSpacing: '-0.02em' }}
            >
              Codra
            </span>
            <span className="text-[9px] font-semibold uppercase tracking-widest text-primary/60">
              review
            </span>
          </div>
        </Link>

        {/* Navigation */}
        <nav className="flex-1 p-2.5 pt-3">
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
          <div className="flex flex-col gap-0.5">
            <button
              id="theme-toggle"
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="nav-item"
            >
              {theme === 'dark'
                ? <><Sun size={15} strokeWidth={1.75} className="shrink-0 text-muted-foreground/70" /> Light mode</>
                : <><Moon size={15} strokeWidth={1.75} className="shrink-0 text-muted-foreground/70" /> Dark mode</>
              }
            </button>
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
      <main
        style={{ marginLeft: 'var(--sidebar-width)' }}
        className="flex-1 min-w-0 transition-colors duration-300"
      >
        <div className="mx-auto max-w-screen-xl px-8 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
