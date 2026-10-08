import { describe, expect, it } from "vitest";
import {
  evidenceRequirementHint,
  hasMandatoryNa,
  isCountableEvidenceDoc,
  itemsMissingEvidence,
  mandatoryNaWithoutComment,
  validateSignatureDataUrl,
} from "../evidence-rules";
import { evaluateSignoffAuthority } from "@/lib/signoff/on-behalf";

describe("validateSignatureDataUrl", () => {
  it("accepts png/jpeg data urls and rejects others", () => {
    expect(validateSignatureDataUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(validateSignatureDataUrl("data:image/jpeg;base64,AAAA==")).toBeNull();
    expect(validateSignatureDataUrl("data:image/svg+xml;base64,AAAA")).not.toBeNull();
    expect(validateSignatureDataUrl("hello")).not.toBeNull();
    expect(validateSignatureDataUrl("data:image/png;base64," + "A".repeat(800_000))).not.toBeNull();
  });
});

describe("isCountableEvidenceDoc", () => {
  const base = { checklist_item_id: null, uploaded_by: "u1", folder_key: "checklists_forms" };
  it("counts approved, own for_review in checklists_forms; never rejected", () => {
    expect(isCountableEvidenceDoc({ ...base, status: "approved" }, "u2")).toBe(true);
    expect(isCountableEvidenceDoc({ ...base, status: "for_review" }, "u1")).toBe(true);
    expect(isCountableEvidenceDoc({ ...base, status: "for_review" }, "u2")).toBe(false);
    expect(isCountableEvidenceDoc({ ...base, status: "for_review", folder_key: "other" }, "u1")).toBe(false);
    expect(isCountableEvidenceDoc({ ...base, status: "rejected" }, "u1")).toBe(false);
  });
});

describe("item evidence rules", () => {
  const items = [
    { id: "a", item_number: "1", is_mandatory: true },
    { id: "b", item_number: "2", is_mandatory: false },
  ];
  it("flags mandatory N/A without comment", () => {
    expect(mandatoryNaWithoutComment(items, [{ checklist_item_id: "a", result: "na", comment: "short" }])).toEqual(["1"]);
    expect(mandatoryNaWithoutComment(items, [{ checklist_item_id: "a", result: "na", comment: "long enough reason" }])).toEqual([]);
    expect(hasMandatoryNa(items, [{ checklist_item_id: "a", result: "na", comment: null }])).toBe(true);
  });
  it("requires evidence for no and mandatory items", () => {
    const responses = [
      { checklist_item_id: "a", result: "yes" as const, comment: null },
      { checklist_item_id: "b", result: "no" as const, comment: "x" },
    ];
    expect(itemsMissingEvidence(items, responses, new Set(), new Set())).toEqual(["1", "2"]);
    expect(itemsMissingEvidence(items, responses, new Set(["a"]), new Set(["b"]))).toEqual([]);
  });
});

describe("evaluateSignoffAuthority", () => {
  it("lets the linked party sign for themselves", () => {
    expect(evaluateSignoffAuthority({ isJagsStaff: false, isAdminOrTeamLead: false, isLinkedActiveParty: true, reason: "" })).toMatchObject({ allowed: true, onBehalf: false });
  });
  it("requires admin/lead and a reason for on-behalf", () => {
    expect(evaluateSignoffAuthority({ isJagsStaff: true, isAdminOrTeamLead: false, isLinkedActiveParty: false, reason: "long enough reason" }).allowed).toBe(false);
    expect(evaluateSignoffAuthority({ isJagsStaff: true, isAdminOrTeamLead: true, isLinkedActiveParty: false, reason: "short" }).allowed).toBe(false);
    expect(evaluateSignoffAuthority({ isJagsStaff: true, isAdminOrTeamLead: true, isLinkedActiveParty: false, reason: "party unavailable on site" })).toMatchObject({ allowed: true, onBehalf: true });
    expect(evaluateSignoffAuthority({ isJagsStaff: false, isAdminOrTeamLead: false, isLinkedActiveParty: false, reason: "x".repeat(20) }).allowed).toBe(false);
  });
});


describe("evidenceRequirementHint", () => {
  it("requires evidence for a mandatory pass or any fail, none for optional pass", () => {
    expect(evidenceRequirementHint(true, "yes", false)?.met).toBe(false);
    expect(evidenceRequirementHint(true, "yes", true)?.met).toBe(true);
    expect(evidenceRequirementHint(false, "no", false)?.met).toBe(false);
    expect(evidenceRequirementHint(false, "yes", false)).toBeNull();
    expect(evidenceRequirementHint(true, null, false)).toBeNull();
  });
  it("warns about N/A on a mandatory item only", () => {
    expect(evidenceRequirementHint(true, "na", false)?.text).toMatch(/N\/A/);
    expect(evidenceRequirementHint(false, "na", false)).toBeNull();
  });
});
