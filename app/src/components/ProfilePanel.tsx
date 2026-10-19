import { useCallback, useEffect, useState } from 'react';
import type { AgentSummary, ApiClient, ReaderProfile } from '../lib/api';
import { useI18n } from '../i18n/I18nProvider';

interface Props {
  api: ApiClient;
  agent: AgentSummary;
  onChanged: () => void;
}

const btn =
  'rounded border border-line px-3 py-1 text-xs hover:bg-ink/5 disabled:opacity-40';

export function ProfilePanel({ api, agent, onChanged }: Props) {
  const [profile, setProfile] = useState<ReaderProfile | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();
  const p = t.profile;

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
        <p className="text-xs text-ink-soft">–</p>
      ) : (
        <ul className="list-disc pl-5 text-xs space-y-0.5">
          {items.map((e, i) => (
            <li key={i}>
              {e.title}
              {e.topic ? <span className="text-ink-soft"> ({e.topic})</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-ink-soft">
        {p.intro}
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
        {p.personalize}
      </label>

      {profile === undefined ? <p className="text-xs text-ink-soft">{p.loading}</p> : null}
      {profile === null ? <p className="text-xs text-ink-soft">{p.none}</p> : null}
      {profile ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {list(p.liked, profile.liked)}
          {list(p.disliked, profile.disliked)}
        </div>
      ) : null}
      {profile?.interests?.length ? (
        <div>
          <p className="text-xs font-semibold mb-1">{p.yourNotes}</p>
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
            if (!window.confirm(p.confirmReset)) return;
            api
              .clearVotes(agent.slug)
              .then(() => {
                setProfile(null);
                onChanged();
              })
              .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
          }}
        >
          {p.reset}
        </button>
      ) : null}
      {error ? (
        <p className="text-xs text-danger font-mono" role="alert">
          {t.status.error} {error}
        </p>
      ) : null}
    </div>
  );
}
