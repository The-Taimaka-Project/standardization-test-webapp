'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

const KEY = 'std-theme';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');

  // Sync state with whatever the inline boot script (in layout.tsx) already
  // applied to <html>. Reading after mount avoids hydration mismatch.
  useEffect(() => {
    const t = (document.documentElement.getAttribute('data-theme') as Theme | null) ?? 'light';
    setTheme(t);
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(KEY, next); } catch {}
  }

  return (
    <button onClick={toggle} className="btn" title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} aria-label="Toggle theme">
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}
