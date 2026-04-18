import { useMutation, useQuery } from '@tanstack/react-query';
import type { ApiClient, RunResult } from '../lib/api';

interface Props {
  api: ApiClient;
  onRunComplete: (result: RunResult) => void;
}

export function AgentList({ api, onRunComplete }: Props) {
  const agentsQuery = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.listAgents(),
  });

  const runMutation = useMutation({
    mutationFn: (slug: string) => api.runAgent(slug),
    onSuccess: (result) => onRunComplete(result),
  });

  if (agentsQuery.isLoading) {
    return <div className="text-sm text-neutral-500">Loading agents…</div>;
  }
  if (agentsQuery.isError) {
    return (
      <div className="text-sm text-red-600">
        Failed to load agents: {String(agentsQuery.error)}
      </div>
    );
  }
  const agents = agentsQuery.data ?? [];

  if (agents.length === 0) {
    return (
      <div className="text-sm text-neutral-500">
        No agents registered yet. Add one under <code>agents/</code> and restart
        the core.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {agents.map((a) => {
        const isPending = runMutation.isPending && runMutation.variables === a.slug;
        return (
          <div
            key={a.id}
            className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 flex items-center justify-between"
          >
            <div>
              <div className="font-medium">{a.slug}</div>
              <div className="text-xs text-neutral-500">
                {a.type} · {a.enabled ? 'enabled' : 'disabled'}
              </div>
            </div>
            <button
              type="button"
              disabled={isPending}
              onClick={() => runMutation.mutate(a.slug)}
              className="rounded-md bg-neutral-900 text-white text-sm px-3 py-1.5 hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
            >
              {isPending ? 'Running…' : 'Run'}
            </button>
          </div>
        );
      })}
      {runMutation.isError ? (
        <div className="text-sm text-red-600">
          Run failed: {String(runMutation.error)}
        </div>
      ) : null}
    </div>
  );
}
