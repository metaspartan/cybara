export function DatasetUsageStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10px] uppercase text-[var(--text-muted)]">{label}</p>
      <p className="mt-0.5 truncate text-[12px] font-medium tabular-nums text-[var(--text-primary)]">
        {value}
      </p>
    </div>
  );
}
