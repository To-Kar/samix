import { useState, type ReactNode } from 'react';
import { contrast, normalizeHex } from '../theme/color';
import { resolveTheme, type ResolvedTheme } from '../theme/resolve';
import { useTheme } from '../theme/ThemeProvider';
import { FONT_SCALES, type Mode, type ThemeSettings } from '../theme/types';

// Quick picks; any other colour goes through the same contrast gate.
const ACCENT_PRESETS = ['#8a2c1a', '#7a4a12', '#5d5a14', '#2f5d3a', '#1f5f6b', '#1d5bb8', '#5b3f8c', '#8a2a5c'];

const MODE_LABEL: Record<ThemeSettings['mode'], string> = { light: 'Hell', dark: 'Dunkel', system: 'System folgen' };
const MODE_NAME: Record<Mode, string> = { light: 'hell', dark: 'dunkel' };
const fmt = (ratio: number) => ratio.toFixed(1).replace('.', ',');

export function Appearance() {
  const { themes, settings, update, reset, resolved } = useTheme();
  const selected = resolved.selected;
  const darkOnly = !selected.modes.light;
  const partnerId = settings.lightPartners[selected.id] ?? selected.lightPartner;
  const partner = themes.find((t) => t.id === partnerId);

  return (
    <div className="flex flex-col gap-6 text-sm">
      <Field label="Theme">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {themes.map((t) => {
            const swatch = t.modes.light ?? t.modes.dark!;
            return (
              <button
                key={t.id}
                aria-pressed={t.id === selected.id}
                onClick={() => update({ themeId: t.id })}
                title={t.stance}
                className="samix-button text-left py-2"
              >
                <span className="flex gap-1 mb-1" aria-hidden="true">
                  {(['paper', 'ink', 'accent'] as const).map((k) => (
                    <i key={k} className="w-4 h-4 border border-line" style={{ background: swatch[k] }} />
                  ))}
                </span>
                {t.name}
              </button>
            );
          })}
        </div>
        {selected.stance ? <p className="samix-hint">{selected.stance}</p> : null}
      </Field>

      <Field label="Modus">
        <Segmented
          value={settings.mode}
          options={(['light', 'dark', 'system'] as const).map((m) => [m, MODE_LABEL[m]])}
          onChange={(mode) => update({ mode })}
        />
        {darkOnly ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="samix-hint">
              {selected.name} hat keinen hellen Modus. Bei hellem System gilt:
            </span>
            <select
              className="samix-input w-auto"
              value={partner?.id ?? ''}
              onChange={(e) => update({ lightPartners: { ...settings.lightPartners, [selected.id]: e.target.value } })}
              aria-label={`Heller Partner für ${selected.name}`}
            >
              {themes
                .filter((t) => t.modes.light)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} hell
                  </option>
                ))}
            </select>
          </div>
        ) : null}
        {resolved.theme.id !== selected.id ? (
          <p className="samix-note">
            <b>Hinweis:</b> Gerade gilt {resolved.theme.name} {MODE_NAME[resolved.mode]}, weil {selected.name} keinen
            hellen Modus hat.
          </p>
        ) : null}
      </Field>

      <Field label="Schriftgröße">
        <Segmented
          value={settings.fontScale}
          options={FONT_SCALES.map((s, i) => [i, `${Math.round(s * 100)} %`])}
          onChange={(fontScale) => update({ fontScale })}
        />
      </Field>

      <Field label="Fließtext" hint="„Lesefreundlich“ = Atkinson Hyperlegible, in jedem Theme.">
        <Segmented
          value={settings.bodyFont}
          options={[
            ['theme', 'Theme'],
            ['serif', 'Serif'],
            ['sans', 'Sans'],
            ['readable', 'Lesefreundlich'],
          ]}
          onChange={(bodyFont) => update({ bodyFont })}
        />
      </Field>

      <Field label="Zeilenlänge">
        <Segmented
          value={settings.measure}
          options={[
            ['narrow', 'Schmal'],
            ['medium', 'Mittel'],
            ['wide', 'Breit'],
          ]}
          onChange={(measure) => update({ measure })}
        />
      </Field>

      <Field label="Dichte">
        <Segmented
          value={settings.density}
          options={[
            ['compact', 'Kompakt'],
            ['normal', 'Normal'],
            ['airy', 'Luftig'],
          ]}
          onChange={(density) => update({ density })}
        />
      </Field>

      <AccentField />

      <Field label="Papierton" hint="Verschiebt nur den Farbton der Fläche, nie ihre Helligkeit.">
        <input
          type="range"
          min={-3}
          max={3}
          step={1}
          value={settings.paperTone}
          onChange={(e) => update({ paperTone: Number(e.target.value) })}
          className="w-full accent-accent"
          aria-label="Papierton"
        />
        <div className="flex justify-between samix-hint" aria-hidden="true">
          <span>wärmer</span>
          <span>Theme</span>
          <span>kühler</span>
        </div>
      </Field>

      <div>
        <button className="samix-button" onClick={reset}>
          Zurücksetzen
        </button>
      </div>
    </div>
  );
}

function AccentField() {
  const { themes, settings, update, systemDark } = useTheme();
  const [draft, setDraft] = useState(settings.accent ?? '');
  const picked = settings.accent;

  const commit = (value: string) => {
    setDraft(value);
    const hex = normalizeHex(value);
    if (hex) update({ accent: hex });
  };

  // Show the gate's result for both modes the selection can paint.
  const previews: ResolvedTheme[] = picked
    ? (['light', 'dark'] as const).map((mode) => resolveTheme(themes, { ...settings, mode }, systemDark))
    : [];

  return (
    <Field label="Akzentfarbe">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="samix-button"
          aria-pressed={picked === null}
          onClick={() => {
            setDraft('');
            update({ accent: null });
          }}
        >
          Theme
        </button>
        {ACCENT_PRESETS.map((c) => (
          <button
            key={c}
            aria-pressed={picked === c}
            aria-label={`Akzent ${c}`}
            onClick={() => commit(c)}
            className="w-7 h-7 rounded-full border border-line aria-pressed:outline aria-pressed:outline-2 aria-pressed:outline-ink aria-pressed:outline-offset-2"
            style={{ background: c }}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="samix-hint">Eigene Farbe</span>
        <input
          type="color"
          value={picked ?? '#000000'}
          onChange={(e) => commit(e.target.value)}
          className="w-9 h-8 rounded-theme border border-line bg-paper-raised"
          aria-label="Eigene Akzentfarbe wählen"
        />
        <input
          className="samix-input w-32 font-mono"
          value={draft}
          placeholder="#rrggbb"
          onChange={(e) => commit(e.target.value)}
          aria-label="Eigene Akzentfarbe als Hex-Wert"
          aria-invalid={draft !== '' && normalizeHex(draft) === null}
        />
      </div>
      {previews.map((r) => {
        const fix = r.corrections.find((c) => c.token === 'accent');
        return (
          <div key={r.mode} className="flex items-center gap-2">
            <i className="w-4 h-4 border border-line shrink-0" style={{ background: r.palette.accent }} aria-hidden="true" />
            <span className="w-28 shrink-0">
              {r.theme.name} {MODE_NAME[r.mode]}
            </span>
            {fix ? (
              <span>
                <b>angepasst</b> auf <code>{fix.to}</code> — {fmt(fix.after)} : 1 (vorher {fmt(fix.before)} : 1)
              </span>
            ) : (
              <span>
                <b>✓ unverändert</b> — {fmt(contrast(r.palette.accent, r.palette.paper))} : 1
              </span>
            )}
          </div>
        );
      })}
    </Field>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="samix-label">{label}</h3>
      {children}
      {hint ? <p className="samix-hint">{hint}</p> : null}
    </section>
  );
}

function Segmented<T extends string | number>({
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
