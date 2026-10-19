import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { applyTheme } from './apply';
import { BUILT_IN_THEMES } from './registry';
import { resolveTheme, type ResolvedTheme } from './resolve';
import { loadSettings, loadUserThemes, MAX_USER_THEMES, saveSettings, saveUserThemes } from './store';
import { DEFAULT_SETTINGS, type SamixTheme, type ThemeSettings } from './types';

const DARK_QUERY = '(prefers-color-scheme: dark)';

const systemIsDark = () => typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches;

/** Paints the stored theme before React mounts, so the first frame is already right. */
export function bootTheme(): void {
  const settings = loadSettings();
  const themes = [...BUILT_IN_THEMES, ...loadUserThemes()];
  applyTheme(document.documentElement, resolveTheme(themes, settings, systemIsDark()), settings);
}

interface ThemeContextValue {
  /** Built-in themes first, then own ones. */
  themes: SamixTheme[];
  isOwn: (id: string) => boolean;
  /** Adds or replaces (same id) an own theme. Returns false when the limit is reached. */
  saveTheme: (theme: SamixTheme) => boolean;
  removeTheme: (id: string) => void;
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
  const [userThemes, setUserThemes] = useState(loadUserThemes);
  const themes = useMemo(() => [...BUILT_IN_THEMES, ...userThemes], [userThemes]);

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(DARK_QUERY);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved = useMemo(() => resolveTheme(themes, settings, systemDark), [themes, settings, systemDark]);

  useLayoutEffect(() => {
    applyTheme(document.documentElement, resolved, settings);
  }, [resolved, settings]);

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => saveUserThemes(userThemes), [userThemes]);

  const update = useCallback((patch: Partial<ThemeSettings>) => setSettings((prev) => ({ ...prev, ...patch })), []);
  const reset = useCallback(() => setSettings({ ...DEFAULT_SETTINGS, lightPartners: {} }), []);

  const isOwn = useCallback((id: string) => userThemes.some((t) => t.id === id), [userThemes]);

  const saveTheme = useCallback(
    (theme: SamixTheme) => {
      const replacing = userThemes.some((t) => t.id === theme.id);
      if (!replacing && userThemes.length >= MAX_USER_THEMES) return false;
      setUserThemes((prev) => (replacing ? prev.map((t) => (t.id === theme.id ? theme : t)) : [...prev, theme]));
      return true;
    },
    [userThemes]
  );

  const removeTheme = useCallback((id: string) => {
    setUserThemes((prev) => prev.filter((t) => t.id !== id));
    setSettings((prev) => ({
      ...prev,
      themeId: prev.themeId === id ? DEFAULT_SETTINGS.themeId : prev.themeId,
      lightPartners: Object.fromEntries(
        Object.entries(prev.lightPartners).filter(([owner, partner]) => owner !== id && partner !== id)
      ),
    }));
  }, []);

  const value = useMemo(
    () => ({ themes, isOwn, saveTheme, removeTheme, settings, update, reset, resolved, systemDark }),
    [themes, isOwn, saveTheme, removeTheme, settings, update, reset, resolved, systemDark]
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme outside ThemeProvider');
  return ctx;
}
