import { useCallback, useEffect, useState } from 'react';
import type { ApiClient, Project } from '../lib/api';
import { folderName, inTauri, pickFolder } from '../lib/native';
import { useI18n } from '../i18n/I18nProvider';

// Folders released for the read-only project assistant. Releasing is an
// explicit act: nothing is readable until the box is ticked, and un-ticking or
// removing takes effect at once. Nothing in the folder is ever changed.
export function Projects({ api, onChanged }: { api: ApiClient; onChanged?: (released: number) => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [allow, setAllow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();
  const p_ = t.projects;

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
      const picked = await pickFolder(t.native.pickProjectFolder);
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
        {p_.intro.before}
        <code>.env</code>
        {p_.intro.env}
        <code>.git</code>
        {p_.intro.and}
        <code>node_modules</code>
        {p_.intro.after}
      </p>
      <ul className="flex flex-col gap-2">
        {(projects ?? []).map((p) => (
          <li key={p.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-semibold">{p.name}</span>
            <span className="font-mono text-ink-soft break-all">{p.path}</span>
            {!p.exists ? <span className="text-danger">{p_.notFound}</span> : null}
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={p.allowModelAccess}
                onChange={(e) => void guard(() => api.setProjectAccess(p.id, e.target.checked))}
              />
              {p_.allowed}
            </label>
            <button
              className="hover:text-danger"
              aria-label={p_.removeLabel(p.name)}
              onClick={() => void guard(() => api.deleteProject(p.id))}
            >
              {p_.remove}
            </button>
          </li>
        ))}
        {projects?.length === 0 ? <li className="text-ink-soft">{p_.none}</li> : null}
      </ul>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <div className="flex gap-2">
          <input className={`${input} w-40`} placeholder={p_.name} aria-label={p_.name} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          <input
            className={`${input} flex-1 font-mono`}
            placeholder={p_.pathPlaceholder}
            aria-label={p_.pathPlaceholder}
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
          {inTauri() ? (
            <button type="button" className="uppercase tracking-wider hover:underline" onClick={() => void choose()}>
              {p_.choose}
            </button>
          ) : null}
        </div>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={allow} onChange={(e) => setAllow(e.target.checked)} />
          {p_.allow}
        </label>
        <button
          type="submit"
          className="self-start uppercase tracking-wider hover:underline disabled:opacity-30"
          disabled={!name.trim() || !path.trim()}
        >
          {p_.release}
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
