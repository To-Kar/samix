// Dates and money in the UI language. `locale` is a BCP 47 tag; components
// get these bound to the active language via useFormat() (i18n/I18nProvider).

export function formatLongDate(d: Date, locale: string): string {
  return d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatShortDate(iso: string | null, locale: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

export function formatDateTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function hostnameOf(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function formatUsd(n: number, locale: string): string {
  return `${n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} $`;
}
