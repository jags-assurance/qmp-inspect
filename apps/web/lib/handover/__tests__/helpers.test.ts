import { describe, expect, it } from "vitest";
import {
  ACK_EVIDENCE_MAX_BYTES,
  acknowledgeErrorMessage,
  buildAckEvidencePath,
  clientRecipientIds,
  isAckSignatureRequired,
  isValidAckEvidencePath,
  issueErrorMessage,
  rejectErrorMessage,
  validateAckEvidenceFile,
} from "../helpers";

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

describe("acknowledgement signature and evidence (S7-18)", () => {
  const book = "11111111-2222-3333-4444-555555555555";

  it("requires a signature only for the client's own acknowledgement once the columns exist", () => {
    expect(isAckSignatureRequired({ signatureEnabled: true, onBehalf: false })).toBe(true);
    expect(isAckSignatureRequired({ signatureEnabled: true, onBehalf: true })).toBe(false);
    expect(isAckSignatureRequired({ signatureEnabled: false, onBehalf: false })).toBe(false);
  });

  it("validates the chosen evidence file", () => {
    expect(validateAckEvidenceFile({ name: "letter.pdf", size: 1000 })).toBeNull();
    expect(validateAckEvidenceFile({ name: "mail.EML", size: 1000 })).toBeNull();
    expect(validateAckEvidenceFile({ name: "letter.pdf", size: 0 })).toMatch(/empty/);
    expect(validateAckEvidenceFile({ name: "letter.pdf", size: ACK_EVIDENCE_MAX_BYTES + 1 })).toMatch(/smaller/);
    expect(validateAckEvidenceFile({ name: "run.exe", size: 10 })).toMatch(/Attach a PDF/);
    expect(validateAckEvidenceFile({ name: "noextension", size: 10 })).toMatch(/Attach a PDF/);
  });

  it("builds a safe path under the book's handover-ack folder", () => {
    const path = buildAckEvidencePath(book, "../Signed letter (final).pdf", 1700000000000);
    expect(path).toBe(`handover-ack/${book}/1700000000000-_Signed_letter__final_.pdf`);
    expect(isValidAckEvidencePath(path, book)).toBe(true);
  });

  it("rejects evidence paths from another book, traversal, or the bare folder", () => {
    expect(isValidAckEvidencePath(`handover-ack/${book}/a.pdf`, book)).toBe(true);
    expect(isValidAckEvidencePath(`handover-ack/other/a.pdf`, book)).toBe(false);
    expect(isValidAckEvidencePath(`handover-ack/${book}/../x.pdf`, book)).toBe(false);
    expect(isValidAckEvidencePath(`handover-ack/${book}/`, book)).toBe(false);
    expect(isValidAckEvidencePath(`handover/${book}/a.pdf`, book)).toBe(false);
  });

  it("maps signature and evidence database errors to clear messages", () => {
    expect(acknowledgeErrorMessage("The signature must be a PNG or JPEG image drawn on the signature pad")).toMatch(/signature/i);
    expect(acknowledgeErrorMessage("The evidence file was not found in storage (or is empty); upload it again")).toMatch(/supporting file/);
  });
});
