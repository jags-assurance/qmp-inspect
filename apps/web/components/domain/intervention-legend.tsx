import { toneClassForLevelIndex } from "@/lib/intervention-levels/types";

export interface InterventionLegendLevel {
  code: string;
  label: string;
  is_blocking: boolean;
}

/**
 * Legend for the H/W/R/S (or custom) intervention levels shown throughout the ITP detail page's
 * per-party grid — driven entirely by this ORGANISATION's own intervention_level_types rows
 * (never a hardcoded H/W/R/S list), so a custom level an admin adds shows up here too, alongside
 * whether it's configured as blocking (Hold-equivalent, R66-R81). Mirrors the wording/content of
 * the legend already rendered in the generated ITP PDF (worker/src/jobs/itpTemplate.ts's
 * renderLegend) so the web page and the PDF read consistently, without reusing any of that
 * server-rendered HTML string code here.
 */
export function InterventionLegend({ levels }: { levels: InterventionLegendLevel[] }) {
  if (levels.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-border bg-off-white/40 px-3 py-2 text-xs">
      <span className="font-medium uppercase tracking-wide text-muted">Intervention levels:</span>
      {levels.map((level, i) => (
        <span key={level.code} className="inline-flex items-center gap-1.5">
          <span
            className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold ${toneClassForLevelIndex(i)}`}
          >
            {level.code}
          </span>
          <span className="text-ink">
            {level.label}
            {level.is_blocking && <span className="text-muted"> (blocking)</span>}
          </span>
        </span>
      ))}
    </div>
  );
}
