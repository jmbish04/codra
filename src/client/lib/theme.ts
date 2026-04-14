import { useState, useEffect, useCallback } from 'react';

export type Theme = 'light' | 'dark';

function getSystemTheme(): Theme {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function getStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem('codra-theme');
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  // Both class and attribute so CSS + any Tailwind dark: variants work
  root.classList.toggle('dark', theme === 'dark');
  root.setAttribute('data-theme', theme);
  try {
    localStorage.setItem('codra-theme', theme);
  } catch {
    // ignore
  }
}

// Apply immediately at module load to prevent flash
const _initial: Theme = getStoredTheme() ?? getSystemTheme();
if (typeof document !== 'undefined') applyTheme(_initial);

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme() ?? getSystemTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  return { theme, toggleTheme };
}
