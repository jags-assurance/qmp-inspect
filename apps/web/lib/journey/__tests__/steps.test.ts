import { describe, expect, it } from "vitest";
import { buildJourney, journeyPhases, journeyProgress, type JourneyFacts } from "../steps";

const empty: JourneyFacts = {
  organisationId: null, projectId: null, hasNumbering: false, teamCount: 0, projectCount: 0, partyCount: 0,
  vaultDocCount: 0, registerCount: 0, itpTotal: 0, itpApproved: 0, firstApprovedItpId: null, inspectionCount: 0, inspectionsPassed: 0, checklistTotal: 0, partiesWithoutLogin: 0, signoffTotal: 0, signoffOutstanding: 0,
  openNcrCount: 0, openPunchCount: 0, irnCount: 0, dataBookStatus: "none", handoverIssued: false,
  handoverAcknowledged: false, projectCompleted: false, pendingSignoffs: 0, firstSignoffHref: null, itpDraft: 0, itpAwaitingClient: 0,
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

  it("opens the waiting activity directly", () => {
    const steps = buildJourney({ ...empty, projectCount: 1, itpApproved: 1, pendingSignoffs: 1, firstSignoffHref: "/inspect/itps/x?item=y" }, "contractor");
    expect(steps.find((s) => s.key === "signoff-mine")?.href).toBe("/inspect/itps/x?item=y");
  });

  it("does not call inspections or IRNs done until all are covered", () => {
    const f = { ...empty, organisationId: "o1", projectId: "p", checklistTotal: 3, inspectionCount: 1, inspectionsPassed: 1, irnCount: 1 };
    const steps = buildJourney(f);
    expect(steps.find((s) => s.key === "inspect")?.state).not.toBe("done");
    expect(buildJourney({ ...f, inspectionCount: 3, inspectionsPassed: 3, irnCount: 1 }).find((s) => s.key === "irn")?.state).not.toBe("done");
    expect(buildJourney({ ...f, inspectionCount: 3, inspectionsPassed: 3, irnCount: 3 }).find((s) => s.key === "irn")?.state).toBe("done");
  });
  it("needs logins and all sign-offs", () => {
    expect(buildJourney({ ...empty, partyCount: 4, partiesWithoutLogin: 4 }).find((s) => s.key === "parties")?.state).not.toBe("done");
    expect(buildJourney({ ...empty, signoffTotal: 4, signoffOutstanding: 1 }).find((s) => s.key === "signoff")?.state).not.toBe("done");
    expect(buildJourney({ ...empty, signoffTotal: 4, signoffOutstanding: 0 }).find((s) => s.key === "signoff")?.state).toBe("done");
  });
});
