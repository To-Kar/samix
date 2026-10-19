import { useCallback, useEffect, useState } from 'react';
import type { ApiClient, Note } from '../lib/api';

const MAX_CHARS = 500;

// The reader's visible memory: only the reader writes here, and everything the
// agents may read is on this list.
export function Notes({ api }: { api: ApiClient }) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

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
    const t = text.trim();
    if (!t) return;
    setError(null);
    try {
      await api.addNote(t);
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
      <p className="text-ink-soft dark:text-ink-soft-dark">
        Was du hier einträgst, kann die Auskunft lesen, um Suchen an deine Interessen anzupassen (dann steht „read_notes“
        unter „Wie kam das zustande?“), und Ressorts mit eingeschalteter Personalisierung nutzen es beim Ranking (siehe „Dein
        Profil“ des Ressorts). Nur dann geht es an das Modell. Notizen sind keine Quellen.
      </p>
      <ul className="flex flex-col gap-1">
        {(notes ?? []).map((n) => (
          <li key={n.id} className="flex items-baseline gap-2">
            <span className="flex-1">• {n.text}</span>
            <button className="hover:text-red-700" aria-label={`Notiz „${n.text}“ löschen`} onClick={() => void remove(n.id)}>
              ✕
            </button>
          </li>
        ))}
        {notes?.length === 0 ? <li className="text-ink-soft dark:text-ink-soft-dark">Noch keine Notizen.</li> : null}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          className="flex-1 border border-rule dark:border-rule-dark bg-transparent px-2 py-1"
          value={text}
          maxLength={MAX_CHARS}
          placeholder="z. B. Ich verfolge Rust und offene Sprachmodelle"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="uppercase tracking-wider hover:underline disabled:opacity-30" disabled={!text.trim()}>
          Merken
        </button>
      </form>
      {error ? <p className="text-red-700 dark:text-red-400">{error}</p> : null}
    </div>
  );
}
