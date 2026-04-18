import type { RunResult } from '../lib/api';

interface Props {
  result: RunResult;
}

export function RunResultCard({ result }: Props) {
  const isSuccess = result.status === 'success';

  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">{result.agentSlug}</div>
          <div className="text-xs text-neutral-500 font-mono">{result.runId}</div>
        </div>
        <span
          className={
            'text-xs font-medium px-2 py-0.5 rounded ' +
            (isSuccess
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
              : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200')
          }
        >
          {result.status}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs text-neutral-500">
        <div>
          <div className="text-neutral-400">tokens in</div>
          <div className="text-neutral-900 dark:text-neutral-100 font-mono">
            {result.tokensInput}
          </div>
        </div>
        <div>
          <div className="text-neutral-400">tokens out</div>
          <div className="text-neutral-900 dark:text-neutral-100 font-mono">
            {result.tokensOutput}
          </div>
        </div>
        <div>
          <div className="text-neutral-400">cost (USD)</div>
          <div className="text-neutral-900 dark:text-neutral-100 font-mono">
            {result.costUsd.toFixed(4)}
          </div>
        </div>
      </div>

      {result.error ? (
        <div className="text-sm text-red-600 font-mono">{result.error}</div>
      ) : null}

      {result.output?.content ? (
        <pre className="whitespace-pre-wrap rounded bg-neutral-50 dark:bg-neutral-900 p-3 text-sm font-mono">
          {result.output.content}
        </pre>
      ) : null}
    </div>
  );
}
