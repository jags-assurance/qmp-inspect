import { describe, expect, it } from "vitest";
import { buildJourney, journeyPhases, journeyProgress, type JourneyFacts } from "../steps";

const empty: JourneyFacts = {
  organisationId: null, projectId: null, hasNumbering: false, teamCount: 0, projectCount: 0, partyCount: 0,
  vaultDocCount: 0, registerCount: 0, itpTotal: 0, itpApproved: 0, firstApprovedItpId: null, inspectionCount: 0,
  openNcrCount: 0, openPunchCount: 0, irnCount: 0, dataBookStatus: "none", handoverIssued: false,
  handoverAcknowledged: false, projectCompleted: false, pendingSignoffs: 0, itpDraft: 0, itpAwaitingClient: 0,
  inspectionsInProgress: 0, canCreateItp: false,
};

describe("buildJourney", () => {
  it("starts at creating the organisation", () => {
    const steps = buildJourney(empty);
    expect(steps.find((s) => s.state === "next")?.key).toBe("org");
  });
  it("skips optional steps when choosing the next one", () => {
    const steps = buildJourney({ ...empty, organisationId: "o1" });
    expect(steps.find((s) => s.state === "next")?.key).toBe("project");
  });
  it("points at the project's own pages once a project is chosen", () => {
    const steps = buildJourney({ ...empty, organisationId: "o1", projectId: "p1", projectCount: 1 });
    expect(steps.find((s) => s.key === "registers")?.href).toBe("/inspect/projects/p1/registers");
    expect(steps.find((s) => s.key === "parties")?.state).toBe("next");
  });
  it("is not done with problems while any NCR or punch item is open", () => {
    const steps = buildJourney({ ...empty, inspectionCount: 3, openNcrCount: 1 });
    expect(steps.find((s) => s.key === "problems")?.state).not.toBe("done");
  });
  it("counts only required steps in progress", () => {
    const p = journeyProgress(buildJourney({ ...empty, organisationId: "o1" }));
    expect(p.done).toBe(1);
    expect(p.total).toBe(12);
  });

  it("gives each login its own short list", () => {
    const client = buildJourney({ ...empty, projectCount: 1, itpApproved: 2, itpAwaitingClient: 1 }, "client");
    expect(client.find((s) => s.state === "next")?.key).toBe("accept");
    const eng = buildJourney({ ...empty, projectCount: 1, itpApproved: 1, pendingSignoffs: 2 }, "engineer");
    expect(eng.find((s) => s.state === "next")?.key).toBe("signoff-mine");
    expect(journeyPhases(eng)[0]).toBe("Get started");
  });
});
