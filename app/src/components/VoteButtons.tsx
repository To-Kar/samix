import { useI18n } from '../i18n/I18nProvider';

interface Props {
  vote: number | null;
  onVote: (value: -1 | 0 | 1) => void;
}

// 👍 / 👎 toggles: pressing the active one clears the vote.
export function VoteButtons({ vote, onVote }: Props) {
  const base = 'px-1.5 py-0.5 rounded text-sm leading-none transition-opacity';
  const on = 'bg-ink/10';
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-1" role="group" aria-label={t.vote.label}>
      <button
        type="button"
        aria-pressed={vote === 1}
        title={t.vote.more}
        aria-label={t.vote.more}
        onClick={() => onVote(vote === 1 ? 0 : 1)}
        className={`${base} ${vote === 1 ? on : 'opacity-50 hover:opacity-100'}`}
      >
        👍
      </button>
      <button
        type="button"
        aria-pressed={vote === -1}
        title={t.vote.less}
        aria-label={t.vote.less}
        onClick={() => onVote(vote === -1 ? 0 : -1)}
        className={`${base} ${vote === -1 ? on : 'opacity-50 hover:opacity-100'}`}
      >
        👎
      </button>
    </span>
  );
}
