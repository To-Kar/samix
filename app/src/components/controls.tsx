import type { ReactNode } from 'react';

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="samix-label">{label}</h3>
      {children}
      {hint ? <p className="samix-hint">{hint}</p> : null}
    </section>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap self-start rounded-theme border border-line overflow-hidden">
      {options.map(([v, label]) => (
        <button
          key={String(v)}
          aria-pressed={v === value}
          onClick={() => onChange(v)}
          className="px-3 py-1.5 bg-paper-raised text-ink border-l border-line first:border-l-0 aria-pressed:bg-accent aria-pressed:text-on-accent aria-pressed:font-semibold"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
