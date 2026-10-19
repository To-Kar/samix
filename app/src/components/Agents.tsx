import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AgentSummary, ApiClient } from '../lib/api';
import { describeCron } from '../lib/cron';
import { RUN_STATUS } from '../lib/explain';
import { formatDateTime, formatUsd } from '../lib/format';
import { AgentModel } from './AgentModel';
import { NewAgentForm } from './NewAgentForm';
import { ProfilePanel } from './ProfilePanel';
import { RunHistory } from './RunHistory';
import { ScheduleEditor, type ScheduleValue } from './ScheduleEditor';
import { Sources } from './Sources';

// Ressorts = proactive agents. One page to see them, switch them on and off,
// create new ones and edit how each one works.

interface Props {
  api: ApiClient;
  /** Called after something changed that the front page should reload. */
  onChanged: () => void;
}

const btn =
  'rounded border border-line px-3 py-1 text-xs hover:bg-ink/5 disabled:opacity-40';

export function Agents({ api, onChanged }: Props) {
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listAgents();
      setAgents(list.filter((a) => a.type === 'proactive'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh, version]);

  const changed = () => {
    setVersion((v) => v + 1);
    onChanged();
  };

  const toggle = async (a: AgentSummary) => {
    try {
      await api.setAgentEnabled(a.slug, !a.enabled);
      changed();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (creating) {
    return (
      <NewAgentForm
        api={api}
        onCancel={() => setCreating(false)}
        onCreated={(slug) => {
          setCreating(false);
          setSelected(slug);
          changed();
        }}
      />
    );
  }

  const current = agents?.find((a) => a.slug === selected) ?? null;

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-soft">
          Jedes Ressort hat eigene Quellen, einen eigenen Zeitplan und sein eigenes Tageslimit.
        </p>
        <button className={btn} onClick={() => setCreating(true)}>
          + Neues Ressort
        </button>
      </div>

      {error ? <p className="text-xs text-danger font-mono">{error}</p> : null}
      {!agents ? <p className="text-sm text-ink-soft">Lädt …</p> : null}

      <ul className="flex flex-col divide-y divide-rule border-y border-rule">
        {agents?.map((a) => (
          <li key={a.slug} className={`py-3 flex flex-col gap-1 ${a.enabled ? '' : 'opacity-60'}`}>
            <div className="flex items-baseline gap-3">
              <button className="font-head font-bold text-lg text-left hover:underline" onClick={() => setSelected(selected === a.slug ? null : a.slug)}>
                {a.title}
              </button>
              <span className="text-xs text-ink-soft">{a.schedule ? describeCron(a.schedule.cron) : 'nur manuell'}</span>
              <label className="ml-auto flex items-center gap-2 text-xs">
                <input type="checkbox" checked={a.enabled} onChange={() => void toggle(a)} />
                aktiv
              </label>
            </div>
            {a.description ? <p className="text-xs text-ink-soft">{a.description}</p> : null}
            <p className="text-xs text-ink-soft">
              {a.model ?? 'kein Modell'}
              {a.lastRun
                ? ` · letzter Lauf ${formatDateTime(a.lastRun.startedAt)}: ${RUN_STATUS[a.lastRun.status]?.label ?? a.lastRun.status} (${formatUsd(a.lastRun.costUsd)})`
                : ' · noch kein Lauf'}
            </p>

            {current?.slug === a.slug ? (
              <AgentDetail api={api} agent={a} onChanged={changed} version={version} />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-soft border-b border-rule pb-1">
        {title}
      </h4>
      {children}
    </section>
  );
}

function AgentDetail({ api, agent, onChanged, version }: { api: ApiClient; agent: AgentSummary; onChanged: () => void; version: number }) {
  const [schedule, setSchedule] = useState<ScheduleValue | null>(
    agent.schedule ? { cron: agent.schedule.cron, timezone: agent.schedule.timezone } : null
  );
  const [message, setMessage] = useState<string | null>(null);
  const [title, setTitle] = useState(agent.title);
  const [titleMessage, setTitleMessage] = useState<string | null>(null);
  const [topic, setTopic] = useState(agent.topic ?? '');
  const [topicMessage, setTopicMessage] = useState<string | null>(null);
  const [removeMessage, setRemoveMessage] = useState<string | null>(null);

  const saveTitle = async () => {
    setTitleMessage(null);
    try {
      await api.renameAgent(agent.slug, title);
      setTitleMessage('Umbenannt.');
      onChanged();
    } catch (e) {
      setTitleMessage(`Speichern fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const saveTopic = async () => {
    setTopicMessage(null);
    try {
      await api.setAgentTopic(agent.slug, topic);
      setTopicMessage('Gespeichert – gilt ab dem nächsten Lauf (und für die Websuche).');
      onChanged();
    } catch (e) {
      setTopicMessage(`Speichern fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const remove = async () => {
    if (
      !window.confirm(
        `Ressort „${agent.title}“ entfernen?\n\nEs verschwindet aus der Zeitung und läuft nicht mehr. Die Dateien werden nur zur Seite gelegt (Ordner „.removed“ im Agenten-Ordner), bereits geholte Artikel und der Verlauf bleiben in der Datenbank.`
      )
    ) {
      return;
    }
    setRemoveMessage(null);
    try {
      await api.removeAgent(agent.slug);
      onChanged();
    } catch (e) {
      setRemoveMessage(`Entfernen fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const saveSchedule = async () => {
    setMessage(null);
    try {
      await api.putSchedule(agent.slug, schedule);
      setMessage('Zeitplan gespeichert.');
      onChanged();
    } catch (e) {
      setMessage(`Speichern fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="mt-4 mb-2 flex flex-col gap-6 pl-4 border-l-2 border-rule">
      <Section title="Name">
        <div className="flex items-center gap-3">
          <input
            className="rounded border border-line bg-paper-raised px-2 py-1 text-sm w-64"
            value={title}
            maxLength={60}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Name des Ressorts"
          />
          <button className={btn} onClick={() => void saveTitle()} disabled={!title.trim() || title.trim() === agent.title}>
            Umbenennen
          </button>
          {titleMessage ? <span className="text-xs text-ink-soft">{titleMessage}</span> : null}
        </div>
      </Section>
      {agent.topic !== null ? (
        <Section title="Thema">
          <div className="flex flex-col gap-2">
            <textarea
              className="rounded border border-line bg-paper-raised px-2 py-1 text-sm w-full max-w-xl"
              rows={2}
              maxLength={400}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              aria-label="Thema des Ressorts"
            />
            <div className="flex items-center gap-3">
              <button className={btn} onClick={() => void saveTopic()} disabled={!topic.trim() || topic.trim() === agent.topic}>
                Thema speichern
              </button>
              {topicMessage ? <span className="text-xs text-ink-soft">{topicMessage}</span> : null}
            </div>
            <p className="text-xs text-ink-soft">Das Modell wählt aus den abgerufenen Beiträgen die zu diesem Thema passenden aus; die Websuche sucht danach.</p>
          </div>
        </Section>
      ) : null}
      <Section title="Zeitplan">
        <ScheduleEditor value={schedule} onChange={setSchedule} />
        <div className="flex items-center gap-3">
          <button className={btn} onClick={() => void saveSchedule()}>
            Zeitplan speichern
          </button>
          {message ? <span className="text-xs text-ink-soft">{message}</span> : null}
        </div>
        <p className="text-xs text-ink-soft">
          Verpasste Läufe (Rechner aus oder im Ruhezustand) werden nachgeholt, sobald Samix wieder läuft.
        </p>
      </Section>
      <Section title="Quellen">
        <Sources api={api} slug={agent.slug} />
      </Section>
      <Section title="Modell">
        <AgentModel api={api} slug={agent.slug} version={version} />
      </Section>
      <Section title="Dein Profil">
        <ProfilePanel api={api} agent={agent} onChanged={onChanged} />
      </Section>
      <Section title="Läufe">
        <RunHistory api={api} slug={agent.slug} version={version} />
      </Section>
      <Section title="Entfernen">
        <div className="flex items-center gap-3">
          <button className={`${btn} text-danger`} onClick={() => void remove()}>
            Ressort entfernen
          </button>
          {removeMessage ? <span className="text-xs text-danger">{removeMessage}</span> : null}
        </div>
        <p className="text-xs text-ink-soft">
          Nichts wird gelöscht: die Dateien kommen in den Ordner „.removed“, Artikel und Verlauf bleiben in der Datenbank.
        </p>
      </Section>
    </div>
  );
}
