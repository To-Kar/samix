import { useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { downloadText } from '../lib/download';
import { BUILT_IN_THEMES, themeText } from '../theme/registry';
import { MAX_THEME_BYTES, readThemeFile, serializeTheme, themeFromSettings, type ImportResult } from '../theme/share';
import { MAX_USER_THEMES } from '../theme/store';
import { useTheme } from '../theme/ThemeProvider';
import { DEFAULT_SETTINGS, type SamixTheme } from '../theme/types';
import { Field } from './controls';

type Status = { tone: 'note' | 'error'; text: ReactNode } | null;

/** Save the current adjustments as an own theme, export, import, delete. */
export function ThemeShare() {
  const { themes, isOwn, saveTheme, removeTheme, settings, update, resolved } = useTheme();
  const { t, locale, dateLocale } = useI18n();
  const s = t.share;
  const selected = resolved.selected;
  const selectedName = themeText(selected, locale).name;

  const [name, setName] = useState('');
  const [paste, setPaste] = useState('');
  const [status, setStatus] = useState<Status>(null);
  const [pending, setPending] = useState<Extract<ImportResult, { kind: 'needs-fix' }> | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const ratio = (r: number) => r.toLocaleString(dateLocale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const builtInIds = BUILT_IN_THEMES.map((th) => th.id);
  const ownIds = themes.filter((th) => isOwn(th.id)).map((th) => th.id);

  // Adopt a theme and drop the adjustments it now carries itself.
  const adopt = (theme: SamixTheme) => {
    if (!saveTheme(theme)) {
      setStatus({ tone: 'error', text: s.limit(MAX_USER_THEMES) });
      return false;
    }
    update({ themeId: theme.id });
    return true;
  };

  const saveOwn = () => {
    const theme = themeFromSettings(selected, settings, name.trim() || s.namePlaceholder, themes.map((th) => th.id));
    if (!adopt(theme)) return;
    const { accent, paperTone, bodyFont, measure, density } = DEFAULT_SETTINGS;
    update({ accent, paperTone, bodyFont, measure, density });
    setName('');
    setStatus({ tone: 'note', text: s.saved(theme.name) });
  };

  const importText = (text: string) => {
    setPending(null);
    const result = readThemeFile(text, builtInIds, ownIds);
    switch (result.kind) {
      case 'invalid':
        setStatus({
          tone: 'error',
          text: (
            <>
              {result.reason === 'too-large' ? s.tooLarge(MAX_THEME_BYTES / 1024) : result.reason === 'not-json' ? s.notJson : s.schema}
              {result.details.length > 0 ? (
                <ul className="mt-1 list-disc pl-5 font-mono">
                  {result.details.slice(0, 10).map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ),
        });
        return;
      case 'needs-fix':
        setStatus(null);
        setPending(result);
        return;
      case 'ok':
        if (adopt(result.theme)) {
          setPaste('');
          setStatus({ tone: 'note', text: importedText(result.theme, result.renamedFrom, result.replaces) });
        }
    }
  };

  const importedText = (theme: SamixTheme, renamedFrom?: string, replaces?: string) => (
    <>
      {s.imported(themeText(theme, locale).name)}
      {renamedFrom ? ` ${s.renamed(renamedFrom, theme.id)}` : ''}
      {replaces ? ` ${s.replaced}` : ''}
    </>
  );

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_THEME_BYTES) {
      setStatus({ tone: 'error', text: s.tooLarge(MAX_THEME_BYTES / 1024) });
      return;
    }
    importText(await file.text());
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(serializeTheme(selected));
      setStatus({ tone: 'note', text: s.copied });
    } catch {
      setStatus({ tone: 'error', text: s.copyFailed });
    }
  };

  return (
    <div className="flex flex-col gap-6 text-sm">
      <Field label={s.saveTitle} hint={s.saveHint}>
        <div className="flex flex-wrap gap-2">
          <input
            className="samix-input w-64"
            value={name}
            maxLength={40}
            placeholder={s.namePlaceholder}
            aria-label={s.nameLabel}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="samix-button" onClick={saveOwn}>
            {s.save}
          </button>
        </div>
      </Field>

      <Field label={s.exportTitle} hint={s.exportHint(selectedName)}>
        <div className="flex flex-wrap gap-2">
          <button className="samix-button" onClick={() => downloadText(`${selected.id}.samix-theme.json`, serializeTheme(selected))}>
            {s.download}
          </button>
          <button className="samix-button" onClick={() => void copy()}>
            {s.copy}
          </button>
        </div>
      </Field>

      <Field label={s.importTitle} hint={s.importHint}>
        <div>
          <button className="samix-button" onClick={() => fileInput.current?.click()}>
            {s.chooseFile}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
        <textarea
          className="samix-input font-mono"
          rows={4}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          aria-label={s.pasteLabel}
          placeholder={s.pasteLabel}
        />
        <div>
          <button className="samix-button" disabled={!paste.trim()} onClick={() => importText(paste)}>
            {s.check}
          </button>
        </div>
      </Field>

      {pending ? (
        <div className="samix-warning flex flex-col gap-2" role="status">
          <p>
            <b>{t.status.warning}</b> {s.needsFix}
          </p>
          <ul className="list-disc pl-5 font-mono">
            {pending.corrections.map((c, i) => (
              <li key={i}>
                {s.fixRow(t.appearance[c.mode], c.token, c.from, c.to, ratio(c.before), ratio(c.after))}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button
              className="samix-button"
              onClick={() => {
                if (adopt(pending.fixed)) {
                  setStatus({ tone: 'note', text: importedText(pending.fixed, pending.renamedFrom, pending.replaces) });
                  setPaste('');
                }
                setPending(null);
              }}
            >
              {s.importFixed}
            </button>
            <button className="samix-button" onClick={() => setPending(null)}>
              {s.cancel}
            </button>
          </div>
        </div>
      ) : null}

      {status ? (
        <div className={status.tone === 'error' ? 'samix-error' : 'samix-note'} role={status.tone === 'error' ? 'alert' : 'status'}>
          <b>{status.tone === 'error' ? t.status.error : t.status.notice}</b> {status.text}
        </div>
      ) : null}

      {isOwn(selected.id) ? (
        <Field label={s.removeTitle}>
          <div className="flex gap-2">
            {confirmRemove ? (
              <>
                <button
                  className="samix-button text-danger"
                  onClick={() => {
                    removeTheme(selected.id);
                    setConfirmRemove(false);
                    setStatus({ tone: 'note', text: s.removed(selectedName) });
                  }}
                >
                  {s.confirmRemove}
                </button>
                <button className="samix-button" onClick={() => setConfirmRemove(false)}>
                  {s.cancel}
                </button>
              </>
            ) : (
              <button className="samix-button" onClick={() => setConfirmRemove(true)}>
                {s.remove(selectedName)}
              </button>
            )}
          </div>
        </Field>
      ) : null}
    </div>
  );
}
