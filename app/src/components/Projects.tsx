import { useCallback, useEffect, useState } from 'react';
import type { ApiClient, Project } from '../lib/api';
import { folderName, inTauri, pickFolder } from '../lib/native';

// Folders released for the read-only project assistant. Releasing is an
// explicit act: nothing is readable until the box is ticked, and un-ticking or
// removing takes effect at once. Nothing in the folder is ever changed.
export function Projects({ api, onChanged }: { api: ApiClient; onChanged?: (released: number) => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [allow, setAllow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.listProjects();
      setProjects(list);
      onChanged?.(list.filter((p) => p.allowModelAccess).length);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api, onChanged]);

  useEffect(() => {
    void load();
  }, [load]);

  const guard = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const add = () =>
    guard(async () => {
      await api.addProject({ name: name.trim(), path: path.trim(), allowModelAccess: allow });
      setName('');
      setPath('');
      setAllow(false);
    });

  const choose = async () => {
    setError(null);
    try {
      const picked = await pickFolder();
      if (!picked) return;
      setPath(picked);
      setName((n) => n.trim() || folderName(picked));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const input = 'border border-rule bg-transparent px-2 py-1';

  return (
    <div className="flex flex-col gap-3 text-xs">
      <p className="text-ink-soft">
        Die Auskunft „Frag dein Projekt“ darf Textdateien dieser Ordner lesen (nur lesen, nichts wird verändert). Schlüssel,
        <code> .env</code>-Dateien, <code>.git</code> und <code>node_modules</code> sind ausgeschlossen. Mit dem Haken
        gehen gelesene Dateiausschnitte an den Modellanbieter; ohne Haken liest sie nichts. Das ist eine Heuristik: prüfe
        selbst, ob der Ordner Geheimnisse in anderen Dateien enthält.
      </p>
      <ul className="flex flex-col gap-2">
        {(projects ?? []).map((p) => (
          <li key={p.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-semibold">{p.name}</span>
            <span className="font-mono text-ink-soft break-all">{p.path}</span>
            {!p.exists ? <span className="text-danger">Ordner nicht gefunden</span> : null}
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={p.allowModelAccess}
                onChange={(e) => void guard(() => api.setProjectAccess(p.id, e.target.checked))}
              />
              an Modell senden erlaubt
            </label>
            <button
              className="hover:text-danger"
              aria-label={`Freigabe von „${p.name}“ entfernen`}
              onClick={() => void guard(() => api.deleteProject(p.id))}
            >
              Freigabe entfernen
            </button>
          </li>
        ))}
        {projects?.length === 0 ? <li className="text-ink-soft">Noch kein Ordner freigegeben.</li> : null}
      </ul>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <div className="flex gap-2">
          <input className={`${input} w-40`} placeholder="Name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          <input
            className={`${input} flex-1 font-mono`}
            placeholder="Absoluter Pfad, z. B. /Users/du/Projekte/mein-projekt"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
          {inTauri() ? (
            <button type="button" className="uppercase tracking-wider hover:underline" onClick={() => void choose()}>
              Ordner wählen …
            </button>
          ) : null}
        </div>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={allow} onChange={(e) => setAllow(e.target.checked)} />
          Gelesene Dateiausschnitte dürfen an das Modell gesendet werden
        </label>
        <button
          type="submit"
          className="self-start uppercase tracking-wider hover:underline disabled:opacity-30"
          disabled={!name.trim() || !path.trim()}
        >
          Ordner freigeben
        </button>
      </form>
      {error ? <p className="text-danger">{error}</p> : null}
    </div>
  );
}
