import { useRef, useState } from 'react';
import type { ApiClient, QueryResult } from '../lib/api';

const CODING_ASSISTANT_SLUG = 'coding-assistant';

interface QueryProps {
  api: ApiClient;
}

interface HistoryEntry {
  question: string;
  result: QueryResult;
}

export function Query({ api }: QueryProps) {
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const send = async () => {
    const trimmed = message.trim();
    if (!trimmed || pending) return;

    setPending(true);
    setError(null);
    try {
      const result = await api.queryAgent(CODING_ASSISTANT_SLUG, trimmed);
      setHistory((prev) => [...prev, { question: trimmed, result }]);
      setMessage('');
      textareaRef.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask the coding assistant… (⌘↵ or Ctrl+↵ to send)"
          disabled={pending}
          rows={4}
          className="w-full rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-neutral-500 disabled:opacity-50"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => void send()}
            disabled={pending || !message.trim()}
            className="rounded border border-neutral-300 dark:border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40"
          >
            {pending ? 'Thinking…' : 'Send'}
          </button>
          {history.length > 0 ? (
            <button
              onClick={() => setHistory([])}
              disabled={pending}
              className="rounded border border-neutral-300 dark:border-neutral-700 px-3 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40"
            >
              Clear
            </button>
          ) : null}
          <span className="ml-auto text-xs text-neutral-400">⌘↵ to send</span>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-800 dark:text-red-200 font-mono">
          {error}
        </div>
      ) : null}

      {history.length > 0 ? (
        <div className="flex flex-col gap-6">
          {[...history].reverse().map((entry, i) => (
            <QueryEntry key={history.length - 1 - i} entry={entry} />
          ))}
        </div>
      ) : (
        <div className="text-sm text-neutral-400 italic">
          Ask a question about your code. Workspace files matching the manifest configuration are injected as context.
        </div>
      )}
    </div>
  );
}

function QueryEntry({ entry }: { entry: HistoryEntry }) {
  const { question, result } = entry;
  const elapsed =
    result.completedAt && result.startedAt
      ? ((new Date(result.completedAt).getTime() - new Date(result.startedAt).getTime()) / 1000).toFixed(1)
      : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 px-3 py-2 text-sm font-mono text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap">
        {question}
      </div>

      {result.status === 'failed' ? (
        <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-800 dark:text-red-200 font-mono">
          {result.error ?? 'Unknown error'}
        </div>
      ) : (
        <pre className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 text-sm leading-relaxed overflow-x-auto whitespace-pre-wrap font-mono">
          {result.content}
        </pre>
      )}

      <div className="flex items-center gap-3 text-xs text-neutral-400">
        <span>{result.tokensInput + result.tokensOutput} tokens</span>
        <span>${result.costUsd.toFixed(5)}</span>
        {elapsed ? <span>{elapsed}s</span> : null}
      </div>
    </div>
  );
}
