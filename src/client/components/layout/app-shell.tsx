import { NavLink, Outlet, Link } from 'react-router-dom';
import { useEffect, useState, type CSSProperties } from 'react';
import { api } from '@client/lib/api';
import {
  LayoutDashboard,
  AlignLeft,
  GitBranch,
  BarChart2,
  LogOut,
  Sun,
  Moon,
  Activity,
  Settings,
  Star,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@client/lib/utils';
import { useTheme } from '@client/lib/theme';
import codraDark from '@/assets/codra-fullicon-dark.svg';
import codraLight from '@/assets/codra-fullicon-light.svg';
import type { AuthSessionUser } from '@shared/api';

const links = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/jobs', label: 'Jobs', icon: Activity, end: false },
  { to: '/repos', label: 'Repos', icon: GitBranch, end: false },
  { to: '/stats', label: 'Stats', icon: BarChart2, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
];

const collapsedTooltipClass = [
  'lg:pointer-events-none lg:absolute lg:left-[calc(100%+0.75rem)]',
  'lg:z-50 lg:w-max lg:max-w-44 lg:rounded-lg',
  'lg:border lg:border-border lg:bg-white lg:dark:bg-popover',
  'lg:px-3 lg:py-1.5 lg:text-xs lg:font-semibold lg:text-black lg:dark:text-white',
  'lg:shadow-lg lg:opacity-0 lg:translate-x-1',
  'lg:transition-[opacity,transform] lg:duration-150',
  'lg:group-hover:opacity-100 lg:group-hover:translate-x-0',
  'lg:group-focus-visible:opacity-100 lg:group-focus-visible:translate-x-0',
];

function getStoredSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem('codra-sidebar-collapsed') === 'true';
  } catch {
    return false;
  }
}

export function AppShell() {
  const { theme, toggleTheme } = useTheme();
  const [sessionUser, setSessionUser] = useState<AuthSessionUser | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => getStoredSidebarCollapsed());

  const shellStyle = {
    '--app-sidebar-width': sidebarCollapsed
      ? 'var(--sidebar-collapsed-width)'
      : 'var(--sidebar-width)',
  } as CSSProperties;
  const githubProfileHref = sessionUser ? `https://github.com/${sessionUser.login}` : 'https://github.com';
  const accountName = sessionUser?.name?.trim() || sessionUser?.login || 'GitHub';
  const accountInitial = accountName.charAt(0).toUpperCase();

  useEffect(() => {
    let cancelled = false;
    api.getSession()
      .then(r => { if (!cancelled) setSessionUser(r.user); })
      .catch(() => { if (!cancelled) setSessionUser(null); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('codra-sidebar-collapsed', String(sidebarCollapsed));
    } catch {
      // ignore storage failures
    }
  }, [sidebarCollapsed]);

  return (
    <div className="flex min-h-svh bg-background" style={shellStyle}>

      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-background/60 backdrop-blur-md lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* ── SIDEBAR ─────────────────────────────────── */}
      <aside
        className={cn(
          'dashboard-sidebar',
          sidebarCollapsed && 'dashboard-sidebar-collapsed',
          'fixed bottom-3 left-3 top-3 z-40 flex flex-col',
          'rounded-xl border border-border/60',
          'bg-white dark:bg-black backdrop-blur-2xl',
          'text-black dark:text-white',
          'shadow-[0_6px_20px_-8px_oklch(0%_0_0/0.14),0_0_0_1px_color-mix(in_oklch,var(--primary)_6%,transparent)]',
          'dark:shadow-[0_8px_24px_-10px_oklch(0%_0_0/0.42),0_0_0_1px_color-mix(in_oklch,var(--primary)_9%,transparent)]',
          'transition-[transform,width] duration-300 ease-[var(--ease-out-expo)]',
          'w-[min(17rem,calc(100vw-1.5rem))]',
          'lg:bottom-4 lg:left-4 lg:top-4',
          'lg:w-[var(--app-sidebar-width)] lg:translate-x-0',
          'overflow-visible',
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-[calc(100%+1.5rem)]',
        )}
      >

        {/* ── Header ──────────────────────────────── */}
        <div className={cn(
          'relative flex shrink-0 items-center px-3 pt-4 pb-3',
          sidebarCollapsed ? 'lg:flex-col lg:items-center lg:gap-2 lg:pb-4' : 'justify-between',
        )}>

          {/* Logo */}
          <Link
            to="/dashboard"
            className={cn(
              'flex min-w-0 items-center gap-2.5 rounded-lg p-1 -m-1',
              'transition-opacity duration-150 hover:opacity-75',
              sidebarCollapsed && 'lg:justify-center',
            )}
            aria-label="Codra dashboard"
            onClick={() => setMobileMenuOpen(false)}
          >
            <img
              src={theme === 'dark' ? '/icons/codra-icon-dark.svg' : '/icons/codra-icon-light.svg'}
              alt=""
              className={cn(
                'hidden h-8 w-8 shrink-0 rounded-lg lg:block',
                !sidebarCollapsed && 'lg:hidden',
              )}
            />
            <img
              src={theme === 'dark' ? codraDark : codraLight}
              alt="Codra"
              className={cn('h-6 w-auto', sidebarCollapsed && 'lg:hidden')}
            />
          </Link>

          {/* Expand button (collapsed desktop) */}
          <button
            onClick={() => setSidebarCollapsed(false)}
            className={cn(
              'hidden h-8 w-8 items-center justify-center rounded-full',
              'bg-white text-black shadow-sm dark:bg-white/10 dark:text-white',
              'transition-[background-color,color,transform] duration-200 hover:-translate-y-px hover:bg-[color-mix(in_oklch,var(--primary)_12%,white)] dark:hover:bg-white/15',
              sidebarCollapsed && 'lg:flex',
            )}
            aria-label="Expand sidebar"
          >
            <ChevronRight size={15} strokeWidth={2.25} />
          </button>

          {/* Collapse / theme / close controls (expanded) */}
          <div className={cn('flex items-center gap-1', sidebarCollapsed && 'lg:hidden')}>
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="hidden h-8 w-8 items-center justify-center rounded-full bg-white text-black shadow-sm transition-[background-color,color,transform] duration-200 hover:-translate-y-px hover:bg-[color-mix(in_oklch,var(--primary)_12%,white)] dark:bg-white/10 dark:text-white dark:hover:bg-white/15 lg:flex"
              aria-label="Collapse sidebar"
            >
              <ChevronLeft size={15} strokeWidth={2.25} />
            </button>
            <button
              onClick={toggleTheme}
              className="hidden h-8 w-8 items-center justify-center rounded-full bg-white text-black shadow-sm transition-[background-color,color,transform] duration-200 hover:-translate-y-px hover:bg-[color-mix(in_oklch,var(--primary)_12%,white)] dark:bg-white/10 dark:text-white dark:hover:bg-white/15 lg:flex"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
            </button>
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-black shadow-sm transition-colors hover:bg-secondary dark:bg-white/10 dark:text-white lg:hidden"
              aria-label="Close menu"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Divider */}
        <div className="dashboard-sidebar-divider" />

        {/* ── Nav ─────────────────────────────────── */}
        <nav className="flex-1 overflow-visible px-2 py-3">
          {!sidebarCollapsed && (
            <p className="mb-2 px-2 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-black dark:text-white">
              Menu
            </p>
          )}

          <div className={cn('flex flex-col gap-1.5', sidebarCollapsed && 'lg:items-center')}>
            {links.map(({ to, label, end, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={() => setMobileMenuOpen(false)}
                className={({ isActive }) => cn(
                  'dashboard-sidebar-action',
                  'group relative flex h-[2.375rem] items-center gap-3 rounded-lg text-sm font-medium',
                  'outline-none transition-[background-color,color,box-shadow,transform] duration-200 ease-[var(--ease-out-quart)]',
                  'hover:-translate-y-px active:translate-y-0',
                  'focus-visible:ring-2 focus-visible:ring-ring',
                  sidebarCollapsed ? 'lg:w-[2.375rem] lg:justify-center lg:px-0' : 'px-3',
                  isActive
                    ? [
                      'text-black dark:text-white',
                      'bg-[color-mix(in_oklch,var(--primary)_12%,transparent)]',
                      'dark:bg-[color-mix(in_oklch,var(--primary)_18%,transparent)]',
                    ]
                    : 'text-black hover:bg-secondary/70 hover:text-black hover:shadow-[0_8px_18px_-14px_color-mix(in_oklch,var(--foreground)_35%,transparent)] dark:text-white dark:hover:text-white',
                )}
              >
                {({ isActive }) => (
                  <>
                    {/* Active left bar */}
                    <span className={cn(
                      'absolute -left-2 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full bg-primary',
                      'z-20 transition-[height,opacity] duration-200',
                      isActive ? 'h-5 opacity-100' : 'h-0 opacity-0',
                    )} />

                    {isActive && (
                      <span
                        className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-lg"
                        aria-hidden="true"
                      >
                        <span className="dashboard-sidebar-shine absolute inset-0 flex h-full w-full justify-center">
                          <span className="relative h-full w-8 bg-white/25 dark:bg-white/20" />
                        </span>
                      </span>
                    )}

                    {/* Icon wrapper */}
                    <span className={cn(
                      'dashboard-sidebar-action-icon',
                      'relative z-10 flex h-[1.75rem] w-[1.75rem] shrink-0 items-center justify-center rounded-md',
                      'transition-[color,transform] duration-200 ease-[var(--ease-out-quart)]',
                      isActive
                        ? 'text-black dark:text-white'
                        : 'text-black group-hover:text-black dark:text-white dark:group-hover:text-white',
                      sidebarCollapsed
                        ? 'lg:h-[1.875rem] lg:w-[1.875rem] lg:group-hover:scale-110'
                        : 'group-hover:translate-x-1',
                    )}>
                      <Icon size={15} strokeWidth={isActive ? 2.6 : 2.15} />
                    </span>

                    {/* Label / collapsed tooltip */}
                    <span className={cn(
                      'dashboard-sidebar-action-label dashboard-sidebar-tooltip',
                      'relative z-10 min-w-0 flex-1 truncate transition-[color,transform] duration-200 ease-[var(--ease-out-quart)]',
                      !sidebarCollapsed && 'group-hover:translate-x-1',
                      sidebarCollapsed && collapsedTooltipClass,
                      isActive && 'text-black dark:text-white lg:dark:text-white',
                    )}>
                      {label}
                    </span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>

        {/* Divider */}
        <div className="dashboard-sidebar-divider" />

        {/* ── Footer ──────────────────────────────── */}
        <div className={cn('shrink-0 space-y-2 p-2 pt-3', sidebarCollapsed && 'lg:flex lg:flex-col lg:items-center')}>

          {/* GitHub star */}
          <a
            href="https://github.com/devarshishimpi/codra"
            target="_blank"
            rel="noopener noreferrer"
            title="Star on GitHub"
            className={cn(
              'dashboard-sidebar-action',
              'group relative flex h-[2.375rem] w-full items-center justify-center gap-2 rounded-lg px-3',
              'border border-dashed border-border/60 bg-transparent',
              'text-xs font-bold text-black dark:text-white',
              'transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-[var(--ease-out-quart)]',
              'hover:border-primary/35 hover:bg-secondary/70 hover:text-black hover:shadow-[0_10px_20px_-18px_var(--primary)] active:translate-y-0 dark:hover:text-white',
              sidebarCollapsed && 'lg:w-[2.375rem] lg:px-0',
            )}
          >
            <Star
              size={14}
              strokeWidth={2.35}
              className="dashboard-sidebar-action-icon shrink-0 text-black transition-[color,transform] duration-200 ease-[var(--ease-out-quart)] group-hover:scale-110 dark:text-white"
            />
            <span className={cn('dashboard-sidebar-action-label transition-transform duration-200 ease-[var(--ease-out-quart)]', sidebarCollapsed && 'lg:hidden')}>
              Star on GitHub
            </span>
            <span className="dashboard-sidebar-tooltip">
              Star on GitHub
            </span>
          </a>

          {/* Account */}
          {sessionUser && (
            <a
              href={githubProfileHref}
              target="_blank"
              rel="noopener noreferrer"
              title={`${accountName} on GitHub`}
              className={cn(
                'dashboard-sidebar-action',
                'group relative flex w-full items-center gap-3 rounded-xl p-2',
                'border border-border/60 bg-transparent',
                'text-black dark:text-white',
                'transition-[background-color,border-color,box-shadow,transform] duration-200 ease-[var(--ease-out-quart)]',
                'hover:border-primary/35 hover:bg-secondary/75 hover:shadow-[0_10px_22px_-18px_var(--primary)]',
                sidebarCollapsed && 'lg:h-[2.375rem] lg:w-[2.375rem] lg:justify-center lg:rounded-lg lg:border-dashed lg:p-0',
              )}
            >
              <span className="relative shrink-0">
                {sessionUser.avatarUrl ? (
                  <img
                    src={sessionUser.avatarUrl}
                    alt=""
                    className="h-9 w-9 rounded-full object-cover ring-1 ring-border/70 transition-transform duration-200 ease-[var(--ease-out-quart)] group-hover:scale-105 lg:group-hover:scale-110"
                  />
                ) : (
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground ring-1 ring-border/70 transition-transform duration-200 ease-[var(--ease-out-quart)] group-hover:scale-105 lg:group-hover:scale-110">
                    {accountInitial}
                  </span>
                )}
              </span>
              <span className={cn('dashboard-sidebar-action-label min-w-0 flex-1', sidebarCollapsed && 'lg:hidden')}>
                <span className="block truncate text-[13px] font-bold leading-tight text-black dark:text-white">
                  {accountName}
                </span>
                <span className="mt-0.5 block truncate text-[11px] font-semibold leading-tight text-zinc-800 dark:text-zinc-200">
                  @{sessionUser.login}
                </span>
              </span>
              <span className="dashboard-sidebar-tooltip">
                {accountName}
              </span>
            </a>
          )}

          {/* Logout */}
          <button
            id="logout-btn"
            type="button"
            title="Log out"
            className={cn(
              'dashboard-sidebar-action',
              'group relative flex h-[2.375rem] w-full items-center justify-center gap-2 rounded-lg px-3',
              'border border-dashed border-border/60 bg-transparent',
              'text-xs font-bold text-black dark:text-white',
              'transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-[var(--ease-out-quart)]',
              'hover:border-primary/35 hover:bg-secondary/70 hover:text-black hover:shadow-[0_10px_20px_-18px_var(--primary)] active:translate-y-0 dark:hover:text-white',
              sidebarCollapsed && 'lg:w-[2.375rem] lg:px-0',
            )}
            onClick={async () => {
              await api.logout();
              location.href = '/login';
            }}
          >
            <LogOut
              size={14}
              strokeWidth={2.35}
              className="dashboard-sidebar-action-icon shrink-0 text-black transition-transform duration-200 ease-[var(--ease-out-quart)] group-hover:scale-110 dark:text-white"
            />
            <span className={cn('dashboard-sidebar-action-label transition-transform duration-200 ease-[var(--ease-out-quart)]', sidebarCollapsed && 'lg:hidden')}>
              Logout
            </span>
            <span className="dashboard-sidebar-tooltip">
              Log out
            </span>
          </button>
        </div>

        <div className="h-1 shrink-0" />
      </aside>

      {/* ── MAIN ────────────────────────────────────── */}
      <main className="flex min-w-0 flex-1 flex-col transition-[margin,color,background-color] duration-300 ease-[var(--ease-out-expo)] lg:ml-[calc(var(--app-sidebar-width)+2rem)]">

        {/* Mobile topbar */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4 lg:hidden">
          <button
            className="-ml-2 rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open menu"
          >
            <AlignLeft size={20} />
          </button>
          <button
            onClick={toggleTheme}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </header>

        <div className="app-shell-content mx-auto w-full max-w-screen-xl px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
