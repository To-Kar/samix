import { useQuery } from '@tanstack/react-query';
import type { ApiClient } from '../lib/api';
import { useI18n } from '../i18n/I18nProvider';

interface Props {
  api: ApiClient;
}

export function ConnectionBanner({ api }: Props) {
  const { t } = useI18n();
  const { isError, isSuccess, data } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.health(),
    refetchInterval: 10_000,
    retry: 0,
  });

  if (isError) {
    return (
      <div className="border-b border-danger bg-danger-paper text-danger px-4 py-2 text-sm font-medium" role="alert">
        {t.banner.disconnected}
      </div>
    );
  }

  if (isSuccess && data) {
    return (
      <div className="border-b border-rule text-ink-soft px-4 py-1.5 text-sm">
        {t.banner.connected(data.version, Math.floor(data.uptime))}
      </div>
    );
  }

  return (
    <div className="border-b border-rule text-ink-soft px-4 py-1.5 text-sm">
      {t.banner.connecting}
    </div>
  );
}
