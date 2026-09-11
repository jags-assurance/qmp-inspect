const BUCKETS = ["0-7 days", "8-14 days", "15-30 days", "30+ days"] as const;

/** Buckets a list of "days open" counts into the same four ranges the register mockups use. */
export function bucketAge(daysOpenList: number[]): number[] {
  const counts = [0, 0, 0, 0];
  for (const days of daysOpenList) {
    if (days <= 7) counts[0]++;
    else if (days <= 14) counts[1]++;
    else if (days <= 30) counts[2]++;
    else counts[3]++;
  }
  return counts;
}

/** Small bar chart of open items by age bucket — real data (days since created_at), no library. */
export function AgingChart({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts);

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-sm font-medium text-ink">Aging profile</p>
      <div className="mt-4 flex items-end gap-4" style={{ height: 96 }}>
        {BUCKETS.map((label, i) => (
          <div key={label} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-xs font-medium text-ink">{counts[i]}</span>
            <div
              className="w-full max-w-10 rounded-t bg-gold"
              style={{ height: `${Math.max(4, (counts[i] / max) * 72)}px` }}
              aria-hidden
            />
            <span className="mt-1 text-center text-[10px] text-muted">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
