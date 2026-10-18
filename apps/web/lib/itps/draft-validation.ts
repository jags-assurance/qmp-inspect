// Pure, offline validation + normalisation of an AI-generated ITP draft. No network, no database:
// everything the caller knows about the organisation (intervention level codes, project party ids,
// discipline codes) is passed in. Used by generateItpDraftAction before the draft reaches the review
// UI, and by the review UI itself (computeItemReviewFlags) so the "needs review" marker clears live
// as the reviewer fixes an activity.

import { sanitizeAiLine, sanitizeAiText } from "@/lib/ai/sanitize";
import type { ItpDraftItem, ItpDraftResult } from "@/lib/ai/provider";

export interface DraftValidationContext {
  /** This organisation's intervention_level_types codes (H/W/R/S plus any custom ones). */
  levelCodes: string[];
  /** Ids of the active parties on the project. */
  partyIds: string[];
  /** Active master discipline codes. */
  disciplineCodes: string[];
}

export type ReviewFlag =
  | "missing_acceptance_criteria"
  | "unconfirmed_value"
  | "missing_reference"
  | "reference_without_clause";

export const REVIEW_FLAG_LABELS: Record<ReviewFlag, string> = {
  missing_acceptance_criteria: "No acceptance criteria",
  unconfirmed_value: "Acceptance value not confirmed in the documents",
  missing_reference: "No spec reference",
  reference_without_clause: "Reference has no clause number",
};

export interface DraftValidationSummary {
  totalActivities: number;
  needsReviewActivities: number;
  droppedUnknownLevels: number;
  droppedUnknownParties: number;
  clearedUnknownDisciplines: number;
  droppedEmptyActivities: number;
  mergedDuplicates: number;
  renumbered: number;
}

export interface ValidatedDraft {
  draft: ItpDraftResult;
  summary: DraftValidationSummary;
  /** Plain-language notices for the reviewer; empty when nothing was changed. */
  notices: string[];
}

const MAX_SECTIONS = 12;
const MAX_ITEMS_PER_SECTION = 40;
const MAX_INTERVENTIONS_PER_ITEM = 50;

const UNCONFIRMED_PATTERN =
  /\b(not (yet )?(been )?(confirmed|stated|specified|defined)|to be (confirmed|determined|agreed)|tbc|tbd|project-specific value not)\b/i;

/** Flags that need a human decision. Pure, so the UI can recompute after every edit. */
export function computeItemReviewFlags(
  item: Pick<ItpDraftItem, "acceptanceCriteria" | "referenceSpec">
): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  const criteria = (item.acceptanceCriteria ?? "").trim();
  const reference = (item.referenceSpec ?? "").trim();
  if (!criteria) flags.push("missing_acceptance_criteria");
  else if (UNCONFIRMED_PATTERN.test(criteria)) flags.push("unconfirmed_value");
  if (!reference) flags.push("missing_reference");
  else if (!/\d/.test(reference)) flags.push("reference_without_clause");
  return flags;
}

function normaliseText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(s: string): Set<string> {
  return new Set(normaliseText(s).split(" ").filter((t) => t.length > 1));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** True when two activities are the same check restated (same section: high text similarity and
 *  compatible reference; different sections: near-exact text AND the same non-empty reference). */
export function isNearDuplicate(
  a: Pick<ItpDraftItem, "activity" | "referenceSpec">,
  b: Pick<ItpDraftItem, "activity" | "referenceSpec">,
  sameSection: boolean
): boolean {
  const refA = normaliseText(a.referenceSpec);
  const refB = normaliseText(b.referenceSpec);
  const sim = jaccard(tokenSet(a.activity), tokenSet(b.activity));
  if (sameSection) {
    const refsCompatible = !refA || !refB || refA === refB;
    return refsCompatible && sim >= 0.85;
  }
  return !!refA && refA === refB && sim >= 0.95;
}

/**
 * Rebuilds every field with strict shape/length limits, drops intervention suggestions that point
 * at an unknown party or a level code this organisation doesn't have, clears unknown discipline
 * codes, merges near-duplicate activities, and makes section/item numbering unique. Never throws on
 * malformed input.
 */
export function validateItpDraft(raw: ItpDraftResult, ctx: DraftValidationContext): ValidatedDraft {
  const levelByUpper = new Map(ctx.levelCodes.map((c) => [c.toUpperCase(), c]));
  const partyIds = new Set(ctx.partyIds);
  const disciplineCodes = new Set(ctx.disciplineCodes);
  const summary: DraftValidationSummary = {
    totalActivities: 0,
    needsReviewActivities: 0,
    droppedUnknownLevels: 0,
    droppedUnknownParties: 0,
    clearedUnknownDisciplines: 0,
    droppedEmptyActivities: 0,
    mergedDuplicates: 0,
    renumbered: 0,
  };

  const rawSections = Array.isArray(raw?.sections) ? raw.sections.slice(0, MAX_SECTIONS) : [];
  const kept: { sectionIdx: number; item: ItpDraftItem }[] = [];

  const sections = rawSections.map((s, si) => {
    const rawItems = Array.isArray(s?.items) ? s.items.slice(0, MAX_ITEMS_PER_SECTION) : [];
    const items: ItpDraftItem[] = [];
    for (const i of rawItems) {
      const activity = sanitizeAiText(i?.activity, 600);
      if (activity.length < 3) {
        summary.droppedEmptyActivities++;
        continue;
      }

      const seenParties = new Set<string>();
      const interventions: ItpDraftItem["suggestedInterventions"] = [];
      const rawInterventions = Array.isArray(i?.suggestedInterventions)
        ? i.suggestedInterventions.slice(0, MAX_INTERVENTIONS_PER_ITEM)
        : [];
      for (const iv of rawInterventions) {
        if (!iv || typeof iv.projectPartyId !== "string" || typeof iv.intervention !== "string") continue;
        if (!partyIds.has(iv.projectPartyId)) {
          summary.droppedUnknownParties++;
          continue;
        }
        const code = levelByUpper.get(iv.intervention.trim().toUpperCase());
        if (!code) {
          summary.droppedUnknownLevels++;
          continue;
        }
        if (seenParties.has(iv.projectPartyId)) continue;
        seenParties.add(iv.projectPartyId);
        interventions.push({
          projectPartyId: iv.projectPartyId,
          intervention: code as ItpDraftItem["suggestedInterventions"][number]["intervention"],
          reason: sanitizeAiLine(iv.reason, 300),
        });
      }

      let disciplineCode: string | null = null;
      if (typeof i?.disciplineCode === "string" && i.disciplineCode.trim()) {
        const dc = sanitizeAiLine(i.disciplineCode, 20);
        if (disciplineCodes.has(dc)) disciplineCode = dc;
        else summary.clearedUnknownDisciplines++;
      }

      const item: ItpDraftItem = {
        itemNumber: sanitizeAiLine(i?.itemNumber, 30),
        activity,
        referenceSpec: sanitizeAiLine(i?.referenceSpec, 300),
        acceptanceCriteria: sanitizeAiText(i?.acceptanceCriteria, 1200),
        method: sanitizeAiText(i?.method, 400),
        frequency: sanitizeAiLine(i?.frequency, 200),
        evidenceType: ([1, 2, 3] as const).includes(Number(i?.evidenceType) as 1 | 2 | 3)
          ? (Number(i.evidenceType) as 1 | 2 | 3)
          : 1,
        disciplineCode,
        suggestedInterventions: interventions,
      };

      // De-duplicate against everything kept so far (same section first, then cross-section).
      const dup = kept.find((k) => isNearDuplicate(k.item, item, k.sectionIdx === si));
      if (dup) {
        summary.mergedDuplicates++;
        // Keep the first occurrence; carry over any party sign-off it didn't have.
        for (const iv of item.suggestedInterventions) {
          if (!dup.item.suggestedInterventions.some((x) => x.projectPartyId === iv.projectPartyId)) {
            dup.item.suggestedInterventions.push(iv);
          }
        }
        for (const field of ["referenceSpec", "acceptanceCriteria", "method", "frequency"] as const) {
          if (!dup.item[field] && item[field]) dup.item[field] = item[field];
        }
        continue;
      }
      kept.push({ sectionIdx: si, item });
      items.push(item);
    }

    // Unique, non-empty item numbers within the section.
    const used = new Set<string>();
    let counter = 0;
    for (const item of items) {
      let candidate = item.itemNumber;
      if (!candidate || used.has(candidate)) {
        do {
          counter++;
          candidate = `${si + 1}.${counter}`;
        } while (used.has(candidate));
        summary.renumbered++;
      }
      item.itemNumber = candidate;
      used.add(candidate);
    }

    return {
      sectionNumber: si + 1,
      title: sanitizeAiLine(s?.title, 200) || "Untitled section",
      items,
    };
  });

  for (const s of sections) {
    for (const item of s.items) {
      summary.totalActivities++;
      if (computeItemReviewFlags(item).length > 0) summary.needsReviewActivities++;
    }
  }

  const notices: string[] = [];
  if (summary.droppedUnknownLevels > 0)
    notices.push(
      `${summary.droppedUnknownLevels} suggested sign-off level(s) were removed because this organisation has no such level code.`
    );
  if (summary.droppedUnknownParties > 0)
    notices.push(`${summary.droppedUnknownParties} suggested sign-off(s) were removed because the party is not on this project.`);
  if (summary.mergedDuplicates > 0)
    notices.push(`${summary.mergedDuplicates} near-duplicate activit${summary.mergedDuplicates === 1 ? "y was" : "ies were"} merged.`);
  if (summary.droppedEmptyActivities > 0)
    notices.push(`${summary.droppedEmptyActivities} empty activit${summary.droppedEmptyActivities === 1 ? "y was" : "ies were"} dropped.`);
  if (summary.clearedUnknownDisciplines > 0)
    notices.push(`${summary.clearedUnknownDisciplines} unrecognised discipline code(s) were cleared.`);

  return {
    draft: {
      suggestedTitle: raw?.suggestedTitle ? sanitizeAiLine(raw.suggestedTitle, 200) || null : null,
      suggestedApplicableStandard: raw?.suggestedApplicableStandard
        ? sanitizeAiLine(raw.suggestedApplicableStandard, 200) || null
        : null,
      sections,
    },
    summary,
    notices,
  };
}
