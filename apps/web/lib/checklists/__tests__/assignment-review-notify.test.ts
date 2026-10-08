import { describe, expect, it } from "vitest";
import { canAssignActivity, filterAssignedToMe, isValidAssignee, parseAssignedFilter } from "../assignment-logic";
import { AI_DRAFT_START_BLOCK_MESSAGE, canStartFromTemplate, describeGeneration, templateReviewState } from "../ai-review-logic";
import { assignmentNotification, dedupeRecipients, inspectionPassRecipients, inspectionStartRecipients } from "../inspection-notify-logic";

describe("assignment rules", () => {
  it("lets staff, client team leads and party contacts assign; nobody else", () => {
    expect(canAssignActivity({ isStaff: true, isClientTeamLead: false, isExecutingPartyContact: false })).toBe(true);
    expect(canAssignActivity({ isStaff: false, isClientTeamLead: true, isExecutingPartyContact: false })).toBe(true);
    expect(canAssignActivity({ isStaff: false, isClientTeamLead: false, isExecutingPartyContact: true })).toBe(true);
    expect(canAssignActivity({ isStaff: false, isClientTeamLead: false, isExecutingPartyContact: false })).toBe(false);
  });
  it("accepts only staff or executing-party members as assignee", () => {
    expect(isValidAssignee({ assigneeIsStaff: true, assigneeIsExecutingPartyMember: false })).toBe(true);
    expect(isValidAssignee({ assigneeIsStaff: false, assigneeIsExecutingPartyMember: true })).toBe(true);
    expect(isValidAssignee({ assigneeIsStaff: false, assigneeIsExecutingPartyMember: false })).toBe(false);
  });
  it("filters rows assigned to me and parses the filter", () => {
    const rows = [{ assignedToUserId: "a" }, { assignedToUserId: "b" }, { assignedToUserId: null }];
    expect(filterAssignedToMe(rows, "a")).toEqual([{ assignedToUserId: "a" }]);
    expect(parseAssignedFilter("me")).toBe("me");
    expect(parseAssignedFilter("x")).toBe("");
    expect(parseAssignedFilter(undefined)).toBe("");
  });
});

describe("AI checklist review state", () => {
  it("treats unconfirmed AI templates as drafts that cannot start", () => {
    expect(templateReviewState({ ai_generated: true, ai_confirmed_at: null })).toBe("draft");
    expect(canStartFromTemplate({ ai_generated: true, ai_confirmed_at: null })).toBe(false);
    expect(AI_DRAFT_START_BLOCK_MESSAGE).toMatch(/confirm/i);
  });
  it("lets confirmed and human-built templates start", () => {
    expect(templateReviewState({ ai_generated: true, ai_confirmed_at: "2026-11-14" })).toBe("confirmed");
    expect(canStartFromTemplate({ ai_generated: true, ai_confirmed_at: "2026-11-14" })).toBe(true);
    expect(templateReviewState({ ai_generated: false })).toBe("not_ai");
    expect(canStartFromTemplate({})).toBe(true);
  });
  it("describes failures honestly without claiming a placeholder", () => {
    const ok = describeGeneration({ drafted: 3, failed: 0, reason: null });
    expect(ok.tone).toBe("ok");
    const bad = describeGeneration({ drafted: 1, failed: 2, reason: "AI is not enabled" });
    expect(bad.tone).toBe("warning");
    expect(bad.message).toContain("2 activity");
    expect(bad.message).toContain("AI is not enabled");
    expect(bad.message).toMatch(/blank checklist/i);
  });
});

describe("notification recipients", () => {
  it("dedupes and excludes the actor", () => {
    expect(dedupeRecipients(["a", "b", "a", null, undefined, "c"], "b")).toEqual(["a", "c"]);
  });
  it("start: responsible person plus project staff, minus the starter", () => {
    expect(inspectionStartRecipients({ responsiblePersonId: "r", projectStaffIds: ["s1", "r", "me"], actorId: "me" })).toEqual(["r", "s1"]);
    expect(inspectionStartRecipients({ responsiblePersonId: null, projectStaffIds: [], actorId: "me" })).toEqual([]);
  });
  it("pass: assignee wins, else the responsible people", () => {
    expect(inspectionPassRecipients({ assignedToUserId: "x", responsibleUserIds: ["p", "q"], actorId: "me" })).toEqual(["x"]);
    expect(inspectionPassRecipients({ assignedToUserId: null, responsibleUserIds: ["p", "me", "p", "q"], actorId: "me" })).toEqual(["p", "q"]);
    expect(inspectionPassRecipients({ assignedToUserId: "me", responsibleUserIds: ["p"], actorId: "me" })).toEqual([]);
  });
  it("builds the assignment notification", () => {
    expect(assignmentNotification("Weld check", "Sam").body).toBe("Weld check - assigned by Sam");
    expect(assignmentNotification("Weld check", null).body).toBe("Weld check");
  });
});
