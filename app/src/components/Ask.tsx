import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentSummary,
  AnswerCitation,
  ApiClient,
  ConversationMessage,
  ConversationSummary,
  Proposal,
  TraceStep,
} from '../lib/api';
import { splitAnswer } from '../lib/answer';
import { explainAsk, explainFailure, needsSetup } from '../lib/explain';
import { formatShortDate, formatUsd, hostnameOf } from '../lib/format';

// What the reader sees instead of the agent's name.
const ROUTE_LABEL: Record<string, string> = {
  'frag-die-zeitung': 'Antwort aus deinen Artikeln',
  'projekt-assistent': 'Antwort aus deinem Projekt',
};

// Questions go to the orchestrator; the Q&A agent answers behind it.
export const ORCHESTRATOR = 'orchestrator';
export const QA_AGENT = 'frag-die-zeitung';

interface AskProps {
  api: ApiClient;
  /** Opens the Reader on a cited article; `order` = the cited articles. */
  onOpenSource: (id: string, order: string[]) => void;
  /** Opens the Einrichtung page (keys, models, projects, notes). */
  onOpenSetup: () => void;
}

const smallBtn = 'text-xs uppercase tracking-wider hover:underline disabled:opacity-30 disabled:no-underline';

export function Ask({ api, onOpenSource, onOpenSetup }: AskProps) {
  const [agents, setAgents] = useState<AgentSummary[] | undefined>(undefined);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setupError, setSetupError] = useState(false);
  const [released, setReleased] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    setConversations(await api.listConversations());
  }, [api]);

  const loadAgent = useCallback(async () => {
    const [list, projects] = await Promise.all([api.listAgents(), api.listProjects().catch(() => [])]);
    setAgents(list);
    setReleased(projects.filter((p) => p.allowModelAccess).length);
  }, [api]);

  useEffect(() => {
    Promise.all([loadAgent(), loadList()]).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [loadAgent, loadList]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, pending]);

  const open = async (id: string) => {
    setError(null);
    try {
      const c = await api.getConversation(id);
      setCurrentId(c.id);
      setMessages(c.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const fresh = () => {
    setCurrentId(null);
    setMessages([]);
    setError(null);
  };

  const remove = async (id: string) => {
    if (!window.confirm('Dieses Gespräch löschen? Die Artikel bleiben erhalten.')) return;
    try {
      await api.deleteConversation(id);
      if (id === currentId) fresh();
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const send = async () => {
    const q = question.trim();
    if (!q || pending) return;
    setError(null);
    setPending(q);
    setQuestion('');
    try {
      const r = await api.ask(q, currentId ?? undefined);
      if (r.conversationId) {
        const c = await api.getConversation(r.conversationId);
        setCurrentId(c.id);
        setMessages(c.messages);
        await loadList();
      } else {
        // Refused before a conversation existed (busy, disabled, wrong model).
        setQuestion(q);
        setError(explainAsk(r.error));
        setSetupError(needsSetup(r.error));
      }
    } catch (e) {
      setQuestion(q);
      setError(e instanceof Error ? e.message : String(e));
      setSetupError(false);
    } finally {
      setPending(null);
    }
  };

  // The entry point: the orchestrator if installed and on, else the Q&A agent directly.
  const orch = agents?.find((a) => a.slug === ORCHESTRATOR && a.enabled);
  const qa = agents?.find((a) => a.slug === QA_AGENT);
  const entry = orch ?? qa;
  const titleOf = (slug?: string) => agents?.find((a) => a.slug === slug)?.title ?? slug ?? '';
  const off = agents !== undefined && (!entry || !entry.enabled);
  const models = [...new Set([orch?.model, qa?.model].filter(Boolean))] as string[];

  return (
    <div className="grid gap-8 md:grid-cols-[14rem_1fr]">
      <aside className="flex flex-col gap-3 text-sm">
        <button className={`${smallBtn} text-left font-bold`} onClick={fresh}>
          + Neue Frage
        </button>
        <ul className="flex flex-col gap-1">
          {conversations.map((c) => (
            <li key={c.id} className="group flex items-baseline gap-1">
              <button
                className={`flex-1 text-left truncate hover:underline ${c.id === currentId ? 'font-semibold' : 'text-ink-soft dark:text-ink-soft-dark'}`}
                title={c.title}
                onClick={() => void open(c.id)}
              >
                {c.title}
              </button>
              <button
                className="text-xs text-ink-soft dark:text-ink-soft-dark opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-red-700"
                aria-label={`Gespräch „${c.title}“ löschen`}
                onClick={() => void remove(c.id)}
              >
                ✕
              </button>
            </li>
          ))}
          {conversations.length === 0 ? (
            <li className="text-xs text-ink-soft dark:text-ink-soft-dark">Noch keine Gespräche.</li>
          ) : null}
        </ul>
      </aside>

      <section className="min-w-0 max-w-[68ch] flex flex-col gap-6">
        <header>
          <h2 className="font-serif font-bold text-3xl leading-tight">Fragen</h2>
          <p className="text-sm text-ink-soft dark:text-ink-soft-dark mt-1">
            Antworten kommen nur aus deinen Artikeln{released > 0 ? ` und ${released} freigegebenen Projekt${released === 1 ? '' : 'en'}` : ''} und nennen ihre Quellen.
          </p>
          <p className="text-xs text-ink-soft dark:text-ink-soft-dark mt-1">
            {models.length
              ? `Deine Frage und gefundene Auszüge gehen an ${models.map((m) => `„${m}“`).join(' und ')}. `
              : ''}
            <button className="underline hover:no-underline" onClick={onOpenSetup}>
              Modell, Projekte und Notizen in der Einrichtung ändern
            </button>
          </p>
        </header>

        {off ? (
          <p className="border border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm" role="status">
            {!entry ? 'Die Auskunft ist in dieser Installation nicht vorhanden.' : explainAsk('agent_disabled')}
          </p>
        ) : null}

        <div className="flex flex-col gap-6" aria-live="polite">
          {messages.map((m) => (m.role === 'user' ? <Question key={m.id} text={m.content} /> : (
            <Answer key={m.id} message={m} onOpenSource={onOpenSource} titleOf={titleOf} api={api} onOpenSetup={onOpenSetup} />
          )))}
          {pending ? (
            <>
              <Question text={pending} />
              <p className="text-sm text-ink-soft dark:text-ink-soft-dark" role="status">
                Die Zeitung wird durchsucht …
              </p>
            </>
          ) : null}
        </div>

        {error ? (
          <div className="border border-red-400 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-800 dark:text-red-200 flex flex-wrap items-center gap-3" role="alert">
            <span>{error}</span>
            {setupError ? (
              <button className="uppercase tracking-wider text-xs font-bold hover:underline" onClick={onOpenSetup}>
                Einrichtung öffnen
              </button>
            ) : null}
          </div>
        ) : null}

        <form
          className="flex flex-col gap-2 sticky bottom-0 bg-paper dark:bg-paper-dark pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            className="w-full resize-none border border-rule dark:border-rule-dark bg-transparent p-2 text-sm"
            rows={2}
            maxLength={2000}
            placeholder="Was möchtest du wissen? z. B. „Was gab es zuletzt zu KI-Chips?“"
            value={question}
            disabled={!!pending || !!off}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-soft dark:text-ink-soft-dark">Enter sendet, Umschalt+Enter = neue Zeile</span>
            <button type="submit" className={`${smallBtn} font-bold`} disabled={!question.trim() || !!pending || !!off}>
              Fragen
            </button>
          </div>
        </form>

        <div ref={endRef} />
      </section>
    </div>
  );
}

function Question({ text }: { text: string }) {
  return (
    <p className="self-end max-w-[85%] border border-rule dark:border-rule-dark px-3 py-2 text-sm whitespace-pre-wrap">
      {text}
    </p>
  );
}

function Answer({
  message,
  onOpenSource,
  titleOf,
  api,
  onOpenSetup,
}: {
  message: ConversationMessage;
  onOpenSource: AskProps['onOpenSource'];
  titleOf: (slug?: string) => string;
  api: ApiClient;
  onOpenSetup: () => void;
}) {
  const refs = new Set(message.citations.map((c) => c.number));
  // Only articles open in the reader; project files are shown by path.
  const order = message.citations.filter((c) => c.kind !== 'file').map((c) => c.articleId);
  const open = (c: AnswerCitation) => onOpenSource(c.articleId, order);

  if (message.status !== 'ok') {
    return (
      <div className="border border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm" role="status">
        <p>{explainAsk(message.error)}</p>
        {needsSetup(message.error) ? (
          <button className="mt-2 uppercase tracking-wider text-xs font-bold hover:underline" onClick={onOpenSetup}>
            Einrichtung öffnen
          </button>
        ) : null}
        <Trace message={message} />
      </div>
    );
  }

  return (
    <article className="flex flex-col gap-3">
      {message.route?.kind === 'delegate' ? (
        <p className="text-xs uppercase tracking-wider text-ink-soft dark:text-ink-soft-dark">
          {ROUTE_LABEL[message.route.agent ?? ''] ?? `Weitergeleitet an: ${titleOf(message.route.agent)}`}
        </p>
      ) : null}
      <p className="font-serif text-lg leading-relaxed whitespace-pre-wrap">
        {splitAnswer(message.content, refs).map((p, i) =>
          'text' in p ? (
            <span key={i}>{p.text}</span>
          ) : (
            <button
              key={i}
              className="align-super text-[0.7em] font-bold px-0.5 hover:underline"
              aria-label={`Quelle ${p.ref} öffnen`}
              onClick={() => {
                const c = message.citations.find((x) => x.number === p.ref);
                if (c && c.kind !== 'file') open(c);
              }}
            >
              [{p.ref}]
            </button>
          )
        )}
      </p>
      {message.citations.length > 0 ? (
        <ol className="flex flex-col gap-1 border-t border-rule dark:border-rule-dark pt-2 text-sm">
          {message.citations.map((c) => (
            <li key={c.articleId} className="flex gap-2">
              <span className="font-bold">[{c.number}]</span>
              <span>
                {c.kind === 'file' ? (
                  <>
                    <span className="font-mono font-semibold">{c.title}</span>
                    <span className="text-ink-soft dark:text-ink-soft-dark"> · Projekt {c.sourceName}</span>
                  </>
                ) : (
                  <>
                    <button className="text-left font-semibold hover:underline" onClick={() => open(c)}>
                      {c.title}
                    </button>
                    <span className="text-ink-soft dark:text-ink-soft-dark">
                      {' · '}
                      {[c.sourceName ?? hostnameOf(c.url), formatShortDate(c.publishedAt)].filter(Boolean).join(' · ')}
                    </span>
                  </>
                )}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {(message.proposals ?? []).map((p) => (
        <ProposalButton key={p.ressort} proposal={p} api={api} />
      ))}
      <Trace message={message} />
    </article>
  );
}

function describeStep(s: TraceStep): string {
  const input = s.input && typeof s.input === 'object' ? Object.entries(s.input as Record<string, unknown>) : [];
  const args = input.map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ');
  return `${s.tool}${args ? ` (${args})` : ''} → ${s.isError ? 'Fehler' : `${s.resultCount} Ergebnis${s.resultCount === 1 ? '' : 'se'}`} · ${s.ms} ms`;
}

function Trace({ message }: { message: ConversationMessage }) {
  const steps = message.trace ?? [];
  return (
    <details className="text-xs text-ink-soft dark:text-ink-soft-dark">
      <summary className="cursor-pointer">Wie kam das zustande?</summary>
      <div className="mt-1 flex flex-col gap-1">
        <p>
          {message.model ?? 'kein Modell'}
          {message.costUsd != null ? ` · ${formatUsd(message.costUsd)}` : ''}
        </p>
        {steps.length === 0 ? <p>Keine Werkzeugaufrufe.</p> : null}
        <ol className="list-decimal pl-5">
          {steps.map((s, i) => (
            <li key={i} className="font-mono">
              {describeStep(s)}
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}

// A Ressort refresh costs money, so it only runs after this click.
function ProposalButton({ proposal, api }: { proposal: Proposal; api: ApiClient }) {
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'running' } | { kind: 'done'; text: string }>({ kind: 'idle' });
  const run = async () => {
    setState({ kind: 'running' });
    try {
      const r = await api.runAgent(proposal.ressort);
      const n = r.articleIds?.length ?? 0;
      setState({
        kind: 'done',
        text:
          r.status === 'success'
            ? `Fertig: ${n} neue Artikel (${formatUsd(r.costUsd)}). Du findest sie in der Zeitung.`
            : `${r.status === 'partial' ? 'Teilweise' : 'Fehlgeschlagen'}: ${explainFailure(r.error)}`,
      });
    } catch (e) {
      setState({ kind: 'done', text: `Fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}` });
    }
  };
  return (
    <div className="flex items-center gap-3 text-sm">
      <button
        className="border border-ink dark:border-ink-dark px-3 py-1 text-xs uppercase tracking-wider hover:underline disabled:opacity-40"
        disabled={state.kind !== 'idle'}
        onClick={() => void run()}
      >
        {state.kind === 'running' ? 'Läuft …' : `Neue Artikel für „${proposal.title}“ holen`}
      </button>
      {state.kind === 'done' ? <span role="status">{state.text}</span> : null}
    </div>
  );
}
