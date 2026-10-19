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
      <div className="border-b border-danger bg-danger-paper text-danger px-4 py-2 text-sm font-medium" role="alert">
        Samix Core disconnected. Is `pnpm dev:core` still running?
      </div>
    );
  }

  if (isSuccess && data) {
    return (
      <div className="border-b border-rule text-ink-soft px-4 py-1.5 text-sm">
        Core connected · v{data.version} · uptime {Math.floor(data.uptime)}s
      </div>
    );
  }

  return (
    <div className="border-b border-rule text-ink-soft px-4 py-1.5 text-sm">
      Connecting to core…
    </div>
  );
}
