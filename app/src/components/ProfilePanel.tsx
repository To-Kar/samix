import { useCallback, useEffect, useState } from 'react';
import type { AgentSummary, ApiClient, ReaderProfile } from '../lib/api';

interface Props {
  api: ApiClient;
  agent: AgentSummary;
  onChanged: () => void;
}

const btn =
  'rounded border border-neutral-300 dark:border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40';

export function ProfilePanel({ api, agent, onChanged }: Props) {
  const [profile, setProfile] = useState<ReaderProfile | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProfile((await api.getProfile(agent.slug)).profile);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api, agent.slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const list = (title: string, items: ReaderProfile['liked']) => (
    <div>
      <p className="text-xs font-semibold mb-1">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-neutral-400">–</p>
      ) : (
        <ul className="list-disc pl-5 text-xs space-y-0.5">
          {items.map((e, i) => (
            <li key={i}>
              {e.title}
              {e.topic ? <span className="text-neutral-400"> ({e.topic})</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-neutral-500">
        Mit 👍 und 👎 an den Artikeln und mit deinen Notizen (Einrichtung → Daten) sagst du Samix, was dich interessiert.
        Ist die Personalisierung an, geht beim nächsten Lauf genau die Liste unten (die letzten Titel, höchstens 10 je
        Seite, und bis zu 20 Notizen) an das Modell – nur um die Wichtigkeit zu gewichten. Sonst wird nichts über dich
        gesendet. Bewertungen und Notizen bleiben auf diesem Rechner.
      </p>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={agent.personalize}
          onChange={(e) => {
            api
              .setPersonalize(agent.slug, e.target.checked)
              .then(onChanged)
              .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
          }}
        />
        Bewertungen und Notizen beim Ranking berücksichtigen
      </label>

      {profile === undefined ? <p className="text-xs text-neutral-400">Lädt …</p> : null}
      {profile === null ? <p className="text-xs text-neutral-400">Noch keine Bewertungen und Notizen.</p> : null}
      {profile ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {list('👍 Gefällt', profile.liked)}
          {list('👎 Gefällt nicht', profile.disliked)}
        </div>
      ) : null}
      {profile?.interests?.length ? (
        <div>
          <p className="text-xs font-semibold mb-1">📝 Deine Notizen</p>
          <ul className="list-disc pl-5 text-xs space-y-0.5">
            {profile.interests.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {profile && profile.liked.length + profile.disliked.length > 0 ? (
        <button
          className={`${btn} self-start`}
          onClick={() => {
            if (!window.confirm('Alle Bewertungen für dieses Ressort löschen?')) return;
            api
              .clearVotes(agent.slug)
              .then(() => {
                setProfile(null);
                onChanged();
              })
              .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
          }}
        >
          Bewertungen zurücksetzen
        </button>
      ) : null}
      {error ? <p className="text-xs text-red-600 dark:text-red-400 font-mono">{error}</p> : null}
    </div>
  );
}
