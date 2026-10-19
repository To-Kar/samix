import { useCallback, useEffect, useState } from 'react';
import type { ApiClient, Note } from '../lib/api';
import { useI18n } from '../i18n/I18nProvider';

const MAX_CHARS = 500;

// The reader's visible memory: only the reader writes here, and everything the
// agents may read is on this list.
export function Notes({ api }: { api: ApiClient }) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();

  const load = useCallback(async () => {
    try {
      setNotes(await api.listNotes());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    const note = text.trim();
    if (!note) return;
    setError(null);
    try {
      await api.addNote(note);
      setText('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      await api.deleteNote(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-2 text-xs">
      <p className="text-ink-soft">
        {t.notes.intro}
      </p>
      <ul className="flex flex-col gap-1">
        {(notes ?? []).map((n) => (
          <li key={n.id} className="flex items-baseline gap-2">
            <span className="flex-1">• {n.text}</span>
            <button className="hover:text-danger" aria-label={t.notes.deleteLabel(n.text)} onClick={() => void remove(n.id)}>
              ✕
            </button>
          </li>
        ))}
        {notes?.length === 0 ? <li className="text-ink-soft">{t.notes.none}</li> : null}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          className="flex-1 border border-rule bg-transparent px-2 py-1"
          value={text}
          maxLength={MAX_CHARS}
          placeholder={t.notes.placeholder}
          aria-label={t.notes.placeholder}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="uppercase tracking-wider hover:underline disabled:opacity-30" disabled={!text.trim()}>
          {t.notes.add}
        </button>
      </form>
      {error ? (
        <p className="text-danger" role="alert">
          {t.status.error} {error}
        </p>
      ) : null}
    </div>
  );
}
