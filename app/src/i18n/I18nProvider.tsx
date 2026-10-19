import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { probeHyphenation } from '../theme/hyphenation';
import { DATE_LOCALE, LOCALES, MESSAGES, type Locale, type Messages } from './messages';

// Like appearance, the UI language is a per-device preference.
const KEY = 'samix.locale.v1';

function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(KEY);
    if (LOCALES.includes(stored as Locale)) return stored as Locale;
  } catch {
    // Storage unavailable: fall back to the system language.
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

/** `lang` drives hyphenation and screen readers; re-probe hyphenation for it. */
function applyLocale(locale: Locale): void {
  const root = document.documentElement;
  root.lang = locale;
  root.dataset.hyphenation = String(probeHyphenation(locale));
}

/** Sets <html lang> before React mounts. */
export function bootLocale(): void {
  applyLocale(initialLocale());
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Messages;
  /** BCP 47 tag for toLocale*String. */
  dateLocale: string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState(initialLocale);

  useEffect(() => {
    applyLocale(locale);
    try {
      localStorage.setItem(KEY, locale);
    } catch {
      // Session-only choice.
    }
  }, [locale]);

  const value = useMemo(
    () => ({ locale, setLocale, t: MESSAGES[locale], dateLocale: DATE_LOCALE[locale] }),
    [locale]
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}
