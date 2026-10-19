import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AgentSummary, ApiClient } from '../lib/api';
import { describeCron } from '../lib/cron';
import { runStatus } from '../lib/explain';
import { useFormat, useI18n } from '../i18n/I18nProvider';
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
  const { t } = useI18n();
  const f = useFormat();
  const a_ = t.agents;

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
          {a_.intro}
        </p>
        <button className={btn} onClick={() => setCreating(true)}>
          {a_.create}
        </button>
      </div>

      {error ? (
        <p className="text-xs text-danger font-mono" role="alert">
          {t.status.error} {error}
        </p>
      ) : null}
      {!agents ? <p className="text-sm text-ink-soft">{a_.loading}</p> : null}

      <ul className="flex flex-col divide-y divide-rule border-y border-rule">
        {agents?.map((a) => (
          <li key={a.slug} className={`py-3 flex flex-col gap-1 ${a.enabled ? '' : 'opacity-60'}`}>
            <div className="flex items-baseline gap-3">
              <button className="font-head font-bold text-lg text-left hover:underline" onClick={() => setSelected(selected === a.slug ? null : a.slug)}>
                {a.title}
              </button>
              <span className="text-xs text-ink-soft">{a.schedule ? describeCron(t, a.schedule.cron) : a_.manualOnly}</span>
              <label className="ml-auto flex items-center gap-2 text-xs">
                <input type="checkbox" checked={a.enabled} onChange={() => void toggle(a)} />
                {a_.active}
              </label>
            </div>
            {a.description ? <p className="text-xs text-ink-soft">{a.description}</p> : null}
            <p className="text-xs text-ink-soft">
              {a.model ?? a_.noModel}
              {a.lastRun
                ? a_.lastRun(f.dateTime(a.lastRun.startedAt), runStatus(t, a.lastRun.status)?.label ?? a.lastRun.status, f.usd(a.lastRun.costUsd))
                : a_.noRun}
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
  const { t } = useI18n();
  const a_ = t.agents;
  const failed = (e: unknown) => a_.saveFailed(e instanceof Error ? e.message : String(e));

  const saveTitle = async () => {
    setTitleMessage(null);
    try {
      await api.renameAgent(agent.slug, title);
      setTitleMessage(a_.renamed);
      onChanged();
    } catch (e) {
      setTitleMessage(failed(e));
    }
  };

  const saveTopic = async () => {
    setTopicMessage(null);
    try {
      await api.setAgentTopic(agent.slug, topic);
      setTopicMessage(a_.topicSaved);
      onChanged();
    } catch (e) {
      setTopicMessage(failed(e));
    }
  };

  const remove = async () => {
    if (!window.confirm(a_.confirmRemove(agent.title))) return;
    setRemoveMessage(null);
    try {
      await api.removeAgent(agent.slug);
      onChanged();
    } catch (e) {
      setRemoveMessage(a_.removeFailed(e instanceof Error ? e.message : String(e)));
    }
  };

  const saveSchedule = async () => {
    setMessage(null);
    try {
      await api.putSchedule(agent.slug, schedule);
      setMessage(a_.scheduleSaved);
      onChanged();
    } catch (e) {
      setMessage(failed(e));
    }
  };

  return (
    <div className="mt-4 mb-2 flex flex-col gap-6 pl-4 border-l-2 border-rule">
      <Section title={a_.name}>
        <div className="flex items-center gap-3">
          <input
            className="rounded border border-line bg-paper-raised px-2 py-1 text-sm w-64"
            value={title}
            maxLength={60}
            onChange={(e) => setTitle(e.target.value)}
            aria-label={a_.nameLabel}
          />
          <button className={btn} onClick={() => void saveTitle()} disabled={!title.trim() || title.trim() === agent.title}>
            {a_.rename}
          </button>
          {titleMessage ? <span className="text-xs text-ink-soft">{titleMessage}</span> : null}
        </div>
      </Section>
      {agent.topic !== null ? (
        <Section title={a_.topic}>
          <div className="flex flex-col gap-2">
            <textarea
              className="rounded border border-line bg-paper-raised px-2 py-1 text-sm w-full max-w-xl"
              rows={2}
              maxLength={400}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              aria-label={a_.topicLabel}
            />
            <div className="flex items-center gap-3">
              <button className={btn} onClick={() => void saveTopic()} disabled={!topic.trim() || topic.trim() === agent.topic}>
                {a_.saveTopic}
              </button>
              {topicMessage ? <span className="text-xs text-ink-soft">{topicMessage}</span> : null}
            </div>
            <p className="text-xs text-ink-soft">{a_.topicHint}</p>
          </div>
        </Section>
      ) : null}
      <Section title={a_.schedule}>
        <ScheduleEditor value={schedule} onChange={setSchedule} />
        <div className="flex items-center gap-3">
          <button className={btn} onClick={() => void saveSchedule()}>
            {a_.saveSchedule}
          </button>
          {message ? <span className="text-xs text-ink-soft">{message}</span> : null}
        </div>
        <p className="text-xs text-ink-soft">
          {a_.catchUp}
        </p>
      </Section>
      <Section title={a_.sources}>
        <Sources api={api} slug={agent.slug} />
      </Section>
      <Section title={a_.model}>
        <AgentModel api={api} slug={agent.slug} version={version} />
      </Section>
      <Section title={a_.profile}>
        <ProfilePanel api={api} agent={agent} onChanged={onChanged} />
      </Section>
      <Section title={a_.runs}>
        <RunHistory api={api} slug={agent.slug} version={version} />
      </Section>
      <Section title={a_.remove}>
        <div className="flex items-center gap-3">
          <button className={`${btn} text-danger`} onClick={() => void remove()}>
            {a_.removeRessort}
          </button>
          {removeMessage ? <span className="text-xs text-danger">{removeMessage}</span> : null}
        </div>
        <p className="text-xs text-ink-soft">
          {a_.removeHint}
        </p>
      </Section>
    </div>
  );
}
