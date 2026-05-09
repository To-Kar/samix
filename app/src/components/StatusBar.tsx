interface Props {
  articleCount: number;
  totalCost: number;
}

export function StatusBar({ articleCount, totalCost }: Props) {
  return (
    <div className="h-6 px-4 flex items-center gap-3 text-[11px] text-samix-text-muted border-t border-samix-border bg-samix-surface shrink-0">
      <span>Newspaper &middot; {articleCount} article{articleCount === 1 ? '' : 's'}</span>
      {totalCost > 0 && <span>&middot; ${totalCost.toFixed(5)}</span>}
    </div>
  );
}
