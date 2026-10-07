// Regression tests for the fix in lib/checklists/actions.ts (completeInspectionCore): `.some()` over
// an empty set is vacuously false, so a checklist with zero items used to silently "complete" as
// overall_result='pass' despite recording nothing at all. See completion-logic.ts's doc comment.
//
// completeInspectionCore itself calls createSupabaseServerClient(), which depends on next/headers'
// cookies() and only works inside a real Next.js request, so it isn't directly unit-testable without
// mocking (this app's convention, per packages/rls-tests, is to test against a real DB rather than
// mock one) — these tests instead cover the pure validation/scoring logic pulled out of it.
import { describe, expect, it } from "vitest";
import { validateChecklistItemsAnswered, computeOverallResult } from "../completion-logic";
import type { ChecklistResponseResult } from "../db-types";

describe("validateChecklistItemsAnswered", () => {
  it("rejects completing a checklist with zero items (the exact regression this session fixed)", () => {
    const error = validateChecklistItemsAnswered(new Set(), new Map());
    expect(error).toBe("This checklist has no items yet — add at least one before it can be completed.");
  });

  it("rejects when at least one item has no response yet", () => {
    const itemIds = new Set(["item-1", "item-2"]);
    const responseByItem = new Map<string, ChecklistResponseResult>([["item-1", "yes"]]);
    const error = validateChecklistItemsAnswered(itemIds, responseByItem);
    expect(error).toBe("Every checklist item needs a Yes / No / N-A response before you can complete the inspection.");
  });

  it("allows completion once every item has a response", () => {
    const itemIds = new Set(["item-1", "item-2"]);
    const responseByItem = new Map<string, ChecklistResponseResult>([
      ["item-1", "yes"],
      ["item-2", "na"],
    ]);
    expect(validateChecklistItemsAnswered(itemIds, responseByItem)).toBeNull();
  });
});

describe("computeOverallResult", () => {
  it("fails if any response is 'no', regardless of other responses", () => {
    expect(computeOverallResult(["yes", "no", "na"])).toBe("fail");
    expect(computeOverallResult(["no"])).toBe("fail");
  });

  it("is 'partial' when there's an 'na' but no 'no'", () => {
    expect(computeOverallResult(["yes", "na"])).toBe("partial");
    expect(computeOverallResult(["na"])).toBe("partial");
  });

  it("is a clean 'pass' when every response is 'yes'", () => {
    expect(computeOverallResult(["yes", "yes", "yes"])).toBe("pass");
  });
});

import { validateCompletionFieldsClient } from "../completion-logic";

describe("validateCompletionFieldsClient (S4-05)", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";
  it("requires a usable signature", () => {
    expect(validateCompletionFieldsClient({ signature: "" })).toMatch(/signature is required/);
    expect(validateCompletionFieldsClient({ signature: "not-a-data-url" })).toMatch(/PNG or JPEG/);
    expect(validateCompletionFieldsClient({ signature: png })).toBeNull();
  });
  it("a witness signature needs a witness name", () => {
    expect(validateCompletionFieldsClient({ signature: png, witnessSignature: png })).toMatch(/witness's name/);
    expect(validateCompletionFieldsClient({ signature: png, witnessSignature: png, witnessName: "A. Witness" })).toBeNull();
    expect(validateCompletionFieldsClient({ signature: png, witnessSignature: "bad", witnessName: "A" })).toMatch(/witness signature/);
  });
});
