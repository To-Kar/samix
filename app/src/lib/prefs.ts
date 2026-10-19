// Per-user display preferences. localStorage only: a convenience, never
// required (it can be unavailable or empty), so every access is guarded.

export const LEAD_PARAGRAPH_OPTIONS = [2, 3, 4, 6, 8] as const;
const KEY_LEAD = 'samix.leadParagraphs';
export const DEFAULT_LEAD_PARAGRAPHS = 4;

export function getLeadParagraphs(): number {
  try {
    const n = Number(localStorage.getItem(KEY_LEAD));
    return (LEAD_PARAGRAPH_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_LEAD_PARAGRAPHS;
  } catch {
    return DEFAULT_LEAD_PARAGRAPHS;
  }
}

export function setLeadParagraphs(n: number): void {
  try {
    localStorage.setItem(KEY_LEAD, String(n));
  } catch {
    /* ignore */
  }
}
