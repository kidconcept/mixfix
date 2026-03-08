'use client';

import { useState, useEffect } from 'react';
import { themes, defaultTheme, applyTheme, getCurrentTheme, type Theme } from '@/lib/themes';

export default function ThemeSwitcher() {
  const [currentTheme, setCurrentTheme] = useState<Theme>(defaultTheme);

  useEffect(() => {
    const saved = getCurrentTheme();
    setCurrentTheme(saved);
    applyTheme(saved);
  }, []);

  const lightTheme = themes.find((t) => t.mode === 'light') ?? defaultTheme;
  const darkTheme = themes.find((t) => t.mode === 'dark') ?? defaultTheme;

  const handleThemeChange = (theme: Theme) => {
    setCurrentTheme(theme);
    applyTheme(theme);
  };

  const isCurrentDark = currentTheme.mode === 'dark';
  const isCurrentLight = currentTheme.mode === 'light';
  
  return (
    <div className="text-left">
      <div className="flex items-center gap-3 text-sm">
        <button
          onClick={() => handleThemeChange(lightTheme)}
          disabled={isCurrentLight}
          className="underline transition-colors disabled:no-underline"
          style={{
            color: isCurrentLight ? 'var(--text-secondary)' : 'var(--interactive-primary)',
            cursor: isCurrentLight ? 'default' : 'pointer',
          }}
        >
          Light Mode
        </button>
        <span style={{ color: 'var(--text-secondary)' }}>/</span>
        <button
          onClick={() => handleThemeChange(darkTheme)}
          disabled={isCurrentDark}
          className="underline transition-colors disabled:no-underline"
          style={{
            color: isCurrentDark ? 'var(--text-secondary)' : 'var(--interactive-primary)',
            cursor: isCurrentDark ? 'default' : 'pointer',
          }}
        >
          Dark Mode
        </button>
      </div>
    </div>
  );
}
