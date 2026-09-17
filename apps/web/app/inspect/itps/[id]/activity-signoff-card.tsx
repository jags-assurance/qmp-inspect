import { Badge } from "@/components/ui/badge";
import { InterventionSelect } from "@/components/domain/intervention-select";
import { SignoffCell } from "@/components/domain/signoff-cell";
import type { SignoffStatus } from "@/lib/signoff/db-types";
import type { InterventionLevel } from "@jags/shared-types";
import { cn } from "@/lib/cn";

interface PartySignoffCell {
  party: { id: string; name: string; user_id: string | null };
  intervention: InterventionLevel | null;
  signoff: { id: string; status: SignoffStatus; notified_at: string | null } | null;
  /** Whether the CURRENT user may sign off for this specific party — see canSignOffForParty in lib/signoff/actions.ts. */
  canSignOff: boolean;
}

// Hold is the only level that ever blocks progress outright (R66-R81) — a thicker, tinted border
// makes that meaningfully more prominent than Witness/Review/Surveillance, whose chips stay neutral.
// A party with no intervention set at all gets a quieter dashed outline so it reads as "not
// applicable" rather than "missing data".
function chipToneClass(intervention: InterventionLevel | null): string {
  if (intervention === "H") return "border-burgundy/40 bg-burgundy/5";
  if (intervention) return "border-border bg-off-white/60";
  return "border-dashed border-border/70 bg-transparent";
}

/**
 * One activity's H/W/R/S sign-off progress, rendered as a horizontal chain of per-party chips
 * (party name -> intervention level -> sign-off status/actions) instead of a row of dense table
 * cells. Replaces the previous <tr> of InterventionSelect+SignoffCell pairs on the ITP detail page;
 * every action and business rule those two components enforce is unchanged — this only changes the
 * surrounding layout, which is what lets it wrap naturally at phone width instead of requiring
 * horizontal table scroll.
 */
export function ActivitySignoffCard({
  itpId,
  itemId,
  itemNumber,
  activity,
  acceptanceCriteria,
  evidenceLabel,
  disciplineCode,
  partyCells,
  canEditContent,
  isJagsStaff,
  noticeHours,
}: {
  itpId: string;
  itemId: string;
  itemNumber: string;
  activity: string;
  acceptanceCriteria: string | null;
  evidenceLabel: string;
  disciplineCode: string | null;
  partyCells: PartySignoffCell[];
  canEditContent: boolean;
  isJagsStaff: boolean;
  noticeHours: Record<"H" | "W", number>;
}) {
  return (
    <div className="border-b border-border p-4 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-ink">
            <span className="doc-id mr-1.5 text-muted">{itemNumber}</span>
            {activity}
          </p>
          {acceptanceCriteria && <p className="mt-0.5 text-xs text-muted">{acceptanceCriteria}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral">{evidenceLabel}</Badge>
          {disciplineCode && <Badge tone="neutral">{disciplineCode}</Badge>}
        </div>
      </div>

      {partyCells.length > 0 && (
        <ol
          className="mt-3 flex flex-wrap items-stretch gap-x-1.5 gap-y-2"
          aria-label={`Sign-off chain for activity ${itemNumber}`}
        >
          {partyCells.map(({ party, intervention, signoff, canSignOff }, i) => (
            <li key={party.id} className="flex items-center gap-1.5">
              <div
                className={cn(
                  "flex min-w-28 flex-col items-center gap-1 rounded-lg border px-2.5 py-2 text-center",
                  chipToneClass(intervention)
                )}
              >
                <span className="max-w-28 truncate text-[10px] font-medium uppercase tracking-wide text-muted" title={party.name}>
                  {party.name}
                </span>
                <InterventionSelect
                  itpId={itpId}
                  itpItemId={itemId}
                  projectPartyId={party.id}
                  value={intervention}
                  editable={canEditContent}
                />
                {intervention && signoff && (
                  <SignoffCell
                    progressId={signoff.id}
                    intervention={intervention}
                    status={signoff.status}
                    notifiedAt={signoff.notified_at}
                    noticeHours={noticeHours[intervention as "H" | "W"] ?? null}
                    canSignOff={canSignOff}
                    isJagsStaff={isJagsStaff}
                  />
                )}
              </div>
              {i < partyCells.length - 1 && (
                <span aria-hidden="true" className="hidden text-sm text-muted/40 sm:inline">
                  &rarr;
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
