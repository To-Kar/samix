import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { contrast, normalizeHex } from '../theme/color';
import { themeText } from '../theme/registry';
import { resolveTheme, type ResolvedTheme } from '../theme/resolve';
import { useTheme } from '../theme/ThemeProvider';
import { FONT_SCALES } from '../theme/types';
import { Field, Segmented } from './controls';

// Quick picks; any other colour goes through the same contrast gate.
const ACCENT_PRESETS = ['#8a2c1a', '#7a4a12', '#5d5a14', '#2f5d3a', '#1f5f6b', '#1d5bb8', '#5b3f8c', '#8a2a5c'];

const ratio = (r: number, locale: string) => r.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function Appearance() {
  const { themes, settings, update, reset, resolved } = useTheme();
  const { t, locale } = useI18n();
  const a = t.appearance;
  const name = (theme: (typeof themes)[number]) => themeText(theme, locale).name;
  const selected = resolved.selected;
  const darkOnly = !selected.modes.light;
  const partnerId = settings.lightPartners[selected.id] ?? selected.lightPartner;
  const partner = themes.find((th) => th.id === partnerId);

  return (
    <div className="flex flex-col gap-6 text-sm">
      <Field label={a.theme}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {themes.map((th) => {
            const swatch = th.modes.light ?? th.modes.dark!;
            return (
              <button
                key={th.id}
                aria-pressed={th.id === selected.id}
                onClick={() => update({ themeId: th.id })}
                title={themeText(th, locale).stance}
                className="samix-button text-left py-2"
              >
                <span className="flex gap-1 mb-1" aria-hidden="true">
                  {(['paper', 'ink', 'accent'] as const).map((k) => (
                    <i key={k} className="w-4 h-4 border border-line" style={{ background: swatch[k] }} />
                  ))}
                </span>
                {name(th)}
              </button>
            );
          })}
        </div>
        <p className="samix-hint">{themeText(selected, locale).stance}</p>
      </Field>

      <Field label={a.mode}>
        <Segmented
          value={settings.mode}
          options={[
            ['light', a.modeLight],
            ['dark', a.modeDark],
            ['system', a.modeSystem],
          ]}
          onChange={(mode) => update({ mode })}
        />
        {darkOnly ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="samix-hint">{a.noLightMode(name(selected))}</span>
            <select
              className="samix-input w-auto"
              value={partner?.id ?? ''}
              onChange={(e) => update({ lightPartners: { ...settings.lightPartners, [selected.id]: e.target.value } })}
              aria-label={a.lightPartnerLabel(name(selected))}
            >
              {themes
                .filter((th) => th.modes.light)
                .map((th) => (
                  <option key={th.id} value={th.id}>
                    {name(th)} {a.light}
                  </option>
                ))}
            </select>
          </div>
        ) : null}
        {resolved.theme.id !== selected.id ? (
          <p className="samix-note">
            <b>{t.status.notice}</b> {a.partnerActive(`${name(resolved.theme)} ${a[resolved.mode]}`, name(selected))}
          </p>
        ) : null}
      </Field>

      <Field label={a.fontSize}>
        <Segmented
          value={settings.fontScale}
          options={FONT_SCALES.map((s, i) => [i, `${Math.round(s * 100)} %`])}
          onChange={(fontScale) => update({ fontScale })}
        />
      </Field>

      <Field label={a.bodyFont} hint={a.bodyFontHint}>
        <Segmented
          value={settings.bodyFont}
          options={[
            ['theme', a.bodyFontTheme],
            ['serif', a.bodyFontSerif],
            ['sans', a.bodyFontSans],
            ['readable', a.bodyFontReadable],
          ]}
          onChange={(bodyFont) => update({ bodyFont })}
        />
      </Field>

      <Field label={a.measure}>
        <Segmented
          value={settings.measure}
          options={[
            ['narrow', a.measureNarrow],
            ['medium', a.measureMedium],
            ['wide', a.measureWide],
          ]}
          onChange={(measure) => update({ measure })}
        />
      </Field>

      <Field label={a.density}>
        <Segmented
          value={settings.density}
          options={[
            ['compact', a.densityCompact],
            ['normal', a.densityNormal],
            ['airy', a.densityAiry],
          ]}
          onChange={(density) => update({ density })}
        />
      </Field>

      <AccentField />

      <Field label={a.paperTone} hint={a.paperToneHint}>
        <input
          type="range"
          min={-3}
          max={3}
          step={1}
          value={settings.paperTone}
          onChange={(e) => update({ paperTone: Number(e.target.value) })}
          className="w-full accent-accent"
          aria-label={a.paperTone}
        />
        <div className="flex justify-between samix-hint" aria-hidden="true">
          <span>{a.warmer}</span>
          <span>{a.theme}</span>
          <span>{a.cooler}</span>
        </div>
      </Field>

      <div>
        <button className="samix-button" onClick={reset}>
          {a.reset}
        </button>
      </div>
    </div>
  );
}

function AccentField() {
  const { themes, settings, update, systemDark } = useTheme();
  const { t, locale, dateLocale } = useI18n();
  const a = t.appearance;
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
    <Field label={a.accent}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="samix-button"
          aria-pressed={picked === null}
          onClick={() => {
            setDraft('');
            update({ accent: null });
          }}
        >
          {a.accentTheme}
        </button>
        {ACCENT_PRESETS.map((c) => (
          <button
            key={c}
            aria-pressed={picked === c}
            aria-label={a.accentPreset(c)}
            onClick={() => commit(c)}
            className="w-7 h-7 rounded-full border border-line aria-pressed:outline aria-pressed:outline-2 aria-pressed:outline-ink aria-pressed:outline-offset-2"
            style={{ background: c }}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="samix-hint">{a.accentOwn}</span>
        <input
          type="color"
          value={picked ?? '#000000'}
          onChange={(e) => commit(e.target.value)}
          className="w-9 h-8 rounded-theme border border-line bg-paper-raised"
          aria-label={a.accentPick}
        />
        <input
          className="samix-input w-32 font-mono"
          value={draft}
          placeholder="#rrggbb"
          onChange={(e) => commit(e.target.value)}
          aria-label={a.accentHex}
          aria-invalid={draft !== '' && normalizeHex(draft) === null}
        />
      </div>
      {previews.map((r) => {
        const fix = r.corrections.find((c) => c.token === 'accent');
        return (
          <div key={r.mode} className="flex items-center gap-2">
            <i className="w-4 h-4 border border-line shrink-0" style={{ background: r.palette.accent }} aria-hidden="true" />
            <span className="w-28 shrink-0">
              {themeText(r.theme, locale).name} {a[r.mode]}
            </span>
            {fix ? (
              <span>
                <b>{a.accentAdjusted}</b>
                {a.accentAdjustedTo(fix.to, ratio(fix.after, dateLocale), ratio(fix.before, dateLocale))}
              </span>
            ) : (
              <span>
                <b>{a.accentUnchanged}</b> — {ratio(contrast(r.palette.accent, r.palette.paper), dateLocale)} : 1
              </span>
            )}
          </div>
        );
      })}
    </Field>
  );
}
