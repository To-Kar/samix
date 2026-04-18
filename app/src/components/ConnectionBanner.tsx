import { useQuery } from '@tanstack/react-query';
import type { ApiClient } from '../lib/api';

interface Props {
  api: ApiClient;
}

export function ConnectionBanner({ api }: Props) {
  const { isError, isSuccess, data } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.health(),
    refetchInterval: 10_000,
    retry: 0,
  });

  if (isError) {
    return (
      <div className="bg-red-600 text-white px-4 py-2 text-sm font-medium">
        Samix Core disconnected. Is `pnpm dev:core` still running?
      </div>
    );
  }

  if (isSuccess && data) {
    return (
      <div className="bg-emerald-600/10 text-emerald-900 dark:text-emerald-200 px-4 py-1.5 text-xs">
        Core connected · v{data.version} · uptime {Math.floor(data.uptime)}s
      </div>
    );
  }

  return (
    <div className="bg-neutral-200 dark:bg-neutral-800 px-4 py-1.5 text-xs">
      Connecting to core…
    </div>
  );
}
