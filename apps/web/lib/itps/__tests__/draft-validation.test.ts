import { describe, expect, it } from "vitest";
import type { ItpDraftItem, ItpDraftResult } from "@/lib/ai/provider";
import { computeItemReviewFlags, isNearDuplicate, validateItpDraft } from "../draft-validation";

const ctx = { levelCodes: ["H", "W", "R", "S", "X"], partyIds: ["p1", "p2"], disciplineCodes: ["ELE", "CIV"] };

function item(over: Partial<ItpDraftItem> = {}): ItpDraftItem {
  return {
    itemNumber: "1.1",
    activity: "Verify cable insulation resistance",
    referenceSpec: "25045-E-049 Rev 00, 2.5.1",
    acceptanceCriteria: ">= 1 MOhm at 500 V",
    method: "Megger test",
    frequency: "Each circuit",
    evidenceType: 2,
    disciplineCode: "ELE",
    suggestedInterventions: [{ projectPartyId: "p1", intervention: "W", reason: "Witness test" }],
    ...over,
  };
}
const draftOf = (...items: ItpDraftItem[]): ItpDraftResult => ({
  suggestedTitle: "T",
  suggestedApplicableStandard: null,
  sections: [{ sectionNumber: 1, title: "Testing", items }],
});

describe("computeItemReviewFlags", () => {
  it("passes a complete activity", () => {
    expect(computeItemReviewFlags(item())).toEqual([]);
  });
  it("flags missing criteria and reference", () => {
    expect(computeItemReviewFlags(item({ acceptanceCriteria: "", referenceSpec: "" }))).toEqual([
      "missing_acceptance_criteria",
      "missing_reference",
    ]);
  });
  it("flags a reference without any clause number", () => {
    expect(computeItemReviewFlags(item({ referenceSpec: "Electrical spec" }))).toEqual(["reference_without_clause"]);
  });
  it("flags unconfirmed project-specific values", () => {
    const f = computeItemReviewFlags(item({ acceptanceCriteria: "Per IEC 60364 - project-specific value not yet confirmed" }));
    expect(f).toEqual(["unconfirmed_value"]);
    expect(computeItemReviewFlags(item({ acceptanceCriteria: "Value TBC" }))).toEqual(["unconfirmed_value"]);
  });
});

describe("validateItpDraft", () => {
  it("drops unknown level codes and parties, keeps org custom codes (case-insensitive)", () => {
    const r = validateItpDraft(
      draftOf(
        item({
          suggestedInterventions: [
            { projectPartyId: "p1", intervention: "Z" as never, reason: "bad level" },
            { projectPartyId: "ghost", intervention: "H", reason: "bad party" },
            { projectPartyId: "p2", intervention: "x" as never, reason: "custom" },
          ],
        })
      ),
      ctx
    );
    expect(r.draft.sections[0].items[0].suggestedInterventions).toEqual([
      { projectPartyId: "p2", intervention: "X", reason: "custom" },
    ]);
    expect(r.summary.droppedUnknownLevels).toBe(1);
    expect(r.summary.droppedUnknownParties).toBe(1);
    expect(r.notices.length).toBe(2);
  });

  it("drops everything when the org has no level types, and de-dupes per party", () => {
    const r = validateItpDraft(draftOf(item()), { ...ctx, levelCodes: [] });
    expect(r.draft.sections[0].items[0].suggestedInterventions).toEqual([]);
    const r2 = validateItpDraft(
      draftOf(
        item({
          suggestedInterventions: [
            { projectPartyId: "p1", intervention: "H", reason: "a" },
            { projectPartyId: "p1", intervention: "W", reason: "b" },
          ],
        })
      ),
      ctx
    );
    expect(r2.draft.sections[0].items[0].suggestedInterventions).toHaveLength(1);
    expect(r2.draft.sections[0].items[0].suggestedInterventions[0].intervention).toBe("H");
  });

  it("clears unknown discipline codes", () => {
    const r = validateItpDraft(draftOf(item({ disciplineCode: "MECH" })), ctx);
    expect(r.draft.sections[0].items[0].disciplineCode).toBeNull();
    expect(r.summary.clearedUnknownDisciplines).toBe(1);
  });

  it("trims and limits lengths and strips markup", () => {
    const r = validateItpDraft(
      draftOf(item({ activity: "  <script>x</script>Check " + "a".repeat(2000), acceptanceCriteria: "b".repeat(5000) })),
      ctx
    );
    const it = r.draft.sections[0].items[0];
    expect(it.activity.length).toBeLessThanOrEqual(600);
    expect(it.activity).not.toContain("<script>");
    expect(it.acceptanceCriteria.length).toBe(1200);
  });

  it("merges near-duplicate activities in a section and keeps the first", () => {
    const r = validateItpDraft(
      draftOf(
        item({ itemNumber: "1.1", suggestedInterventions: [{ projectPartyId: "p1", intervention: "W", reason: "" }] }),
        item({
          itemNumber: "1.2",
          activity: "Verify cable insulation resistance.",
          suggestedInterventions: [{ projectPartyId: "p2", intervention: "R", reason: "" }],
        }),
        item({ itemNumber: "1.3", activity: "Inspect earthing continuity", referenceSpec: "25045-E-049 Rev 00, 2.6" })
      ),
      ctx
    );
    const items = r.draft.sections[0].items;
    expect(items.map((i) => i.itemNumber)).toEqual(["1.1", "1.3"]);
    expect(items[0].suggestedInterventions.map((i) => i.projectPartyId).sort()).toEqual(["p1", "p2"]);
    expect(r.summary.mergedDuplicates).toBe(1);
  });

  it("does not merge similar activities that cite different clauses", () => {
    const a = item({ referenceSpec: "Spec 2.1" });
    const b = item({ referenceSpec: "Spec 4.7" });
    expect(isNearDuplicate(a, b, false)).toBe(false);
    expect(isNearDuplicate(a, b, true)).toBe(false);
  });

  it("makes item numbers unique and non-empty", () => {
    const r = validateItpDraft(
      draftOf(
        item({ itemNumber: "1.1", activity: "Check A one" }),
        item({ itemNumber: "1.1", activity: "Check B two different", referenceSpec: "Spec 9.9" }),
        item({ itemNumber: "", activity: "Check C three other thing", referenceSpec: "Spec 8.8" })
      ),
      ctx
    );
    const nums = r.draft.sections[0].items.map((i) => i.itemNumber);
    expect(new Set(nums).size).toBe(3);
    expect(nums.every(Boolean)).toBe(true);
    expect(r.draft.sections[0].sectionNumber).toBe(1);
  });

  it("drops empty activities and counts needs-review", () => {
    const r = validateItpDraft(
      draftOf(
        item({ activity: " " }),
        item(),
        item({ itemNumber: "1.2", activity: "Another distinct check", acceptanceCriteria: "", referenceSpec: "" })
      ),
      ctx
    );
    expect(r.summary.droppedEmptyActivities).toBe(1);
    expect(r.summary.totalActivities).toBe(2);
    expect(r.summary.needsReviewActivities).toBe(1);
  });

  it("tolerates malformed input without throwing", () => {
    const r = validateItpDraft({ sections: [{ items: null }, null] } as never, ctx);
    expect(r.summary.totalActivities).toBe(0);
    expect(validateItpDraft(null as never, ctx).draft.sections).toEqual([]);
  });
});
