import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { applyTheme } from './apply';
import { BUILT_IN_THEMES } from './registry';
import { resolveTheme, type ResolvedTheme } from './resolve';
import { loadSettings, saveSettings } from './store';
import { DEFAULT_SETTINGS, type SamixTheme, type ThemeSettings } from './types';

const DARK_QUERY = '(prefers-color-scheme: dark)';

const systemIsDark = () => typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches;

/** Paints the stored theme before React mounts, so the first frame is already right. */
export function bootTheme(): void {
  const settings = loadSettings();
  applyTheme(document.documentElement, resolveTheme(BUILT_IN_THEMES, settings, systemIsDark()), settings);
}

interface ThemeContextValue {
  themes: SamixTheme[];
  settings: ThemeSettings;
  update: (patch: Partial<ThemeSettings>) => void;
  reset: () => void;
  resolved: ResolvedTheme;
  systemDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(loadSettings);
  const [systemDark, setSystemDark] = useState(systemIsDark);

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(DARK_QUERY);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved = useMemo(() => resolveTheme(BUILT_IN_THEMES, settings, systemDark), [settings, systemDark]);

  useLayoutEffect(() => {
    applyTheme(document.documentElement, resolved, settings);
  }, [resolved, settings]);

  useEffect(() => saveSettings(settings), [settings]);

  const update = useCallback((patch: Partial<ThemeSettings>) => setSettings((prev) => ({ ...prev, ...patch })), []);
  const reset = useCallback(() => setSettings({ ...DEFAULT_SETTINGS, lightPartners: {} }), []);

  const value = useMemo(
    () => ({ themes: BUILT_IN_THEMES, settings, update, reset, resolved, systemDark }),
    [settings, update, reset, resolved, systemDark]
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme outside ThemeProvider');
  return ctx;
}
