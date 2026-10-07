import { describe, expect, it } from "vitest";
import { acknowledgeErrorMessage, clientRecipientIds, issueErrorMessage, rejectErrorMessage } from "../helpers";

describe("clientRecipientIds", () => {
  const project = { id: "p1", organizationId: "o1" };
  it("keeps only client-role users reaching the project, de-duplicated, minus excluded", () => {
    const ids = clientRecipientIds(
      [
        { user_id: "a", role: "client", scope_type: "organization", organization_id: "o1" },
        { user_id: "a", role: "client", scope_type: "project", project_id: "p1" },
        { user_id: "b", role: "main_contractor", scope_type: "organization", organization_id: "o1" },
        { user_id: "c", role: "client", scope_type: "organization", organization_id: "o2" },
        { user_id: "d", role: "client", scope_type: "project", project_id: "p9" },
        { user_id: "e", role: "client", scope_type: "organization", organization_id: "o1" },
      ],
      project,
      ["e"]
    );
    expect(ids).toEqual(["a"]);
  });
});

describe("error messages", () => {
  it("distinguishes acknowledge errors", () => {
    expect(acknowledgeErrorMessage("Already acknowledged")).toMatch(/already been acknowledged/);
    expect(acknowledgeErrorMessage("Only client role may acknowledge")).toMatch(/client organisation/);
    expect(acknowledgeErrorMessage("No package present")).toMatch(/package/);
    expect(acknowledgeErrorMessage("name too long")).toMatch(/name/i);
    expect(acknowledgeErrorMessage(null)).toMatch(/Could not record/);
  });
  it("distinguishes issue errors", () => {
    expect(issueErrorMessage("23505", "")).toMatch(/already exists/);
    expect(issueErrorMessage(null, "open punch items")).toMatch(/punch/);
    expect(issueErrorMessage(null, "status must be compiled")).toMatch(/compiled/);
    expect(issueErrorMessage(null, "Only admin staff or a holder of issue_handover can issue a conditional handover")).toMatch(/issue_handover/);
  });
  it("distinguishes reject / reopen errors and the new acknowledge refusals (S7-18)", () => {
    expect(rejectErrorMessage("Already rejected")).toMatch(/already been rejected/);
    expect(rejectErrorMessage("Already acknowledged")).toMatch(/can no longer be rejected/);
    expect(rejectErrorMessage("Only the client organisation can reject a handover certificate")).toMatch(/client organisation/);
    expect(rejectErrorMessage("A rejection reason of at least 10 characters is required")).toMatch(/reason/);
    expect(rejectErrorMessage("Only admin staff can reopen a rejected handover certificate")).toMatch(/JAGS Admin/);
    expect(rejectErrorMessage(null)).toMatch(/Could not record/);
    expect(acknowledgeErrorMessage("This certificate was rejected and can no longer be acknowledged")).toMatch(/rejected/);
    expect(acknowledgeErrorMessage("This certificate was superseded by a later revision")).toMatch(/superseded/);
  });
});
