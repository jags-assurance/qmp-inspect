import { describe, expect, it } from "vitest";
// The selection rules behind e2e/scripts/cleanup-e2e-data.mjs: what the write-suite cleanup may delete.
import { E2E_PREFIX, planCleanup } from "../../../e2e/scripts/cleanup-select.mjs";

const org = (id: string, name: string) => ({ id, name });
const project = (id: string, name: string, project_number: string, organization_id: string) => ({ id, name, project_number, organization_id });

const e2eOrg = org("o-e2e", "E2E-2610081030ab Org");
const e2eP1 = project("p-1", "E2E-2610081030ab Main project", "E2E-2610081030ab-P1", "o-e2e");
const e2eP2 = project("p-2", "E2E-2610081030ab Handover project", "E2E-2610081030ab-P2", "o-e2e");
const realOrg = org("o-real", "Meridian Industries");
const realProject = project("p-real", "Meridian Refinery", "MER-2026-001", "o-real");

describe("planCleanup", () => {
  it("removes an E2E- organisation and its E2E- projects", () => {
    const plan = planCleanup({ organizations: [e2eOrg, realOrg], projects: [e2eP1, e2eP2, realProject] });
    expect(plan.organizations.map((o) => o.id)).toEqual(["o-e2e"]);
    expect(plan.projects.map((p) => p.id)).toEqual(["p-1", "p-2"]);
    expect(plan.skipped).toEqual([]);
  });

  it("never selects anything that is not E2E- prefixed, however it is listed", () => {
    const plan = planCleanup({ organizations: [realOrg, org("o-lower", "e2e-lowercase org")], projects: [realProject, project("p-lower", "e2e-lowercase", "e2e-1", "o-lower")] });
    expect(plan.organizations).toEqual([]);
    expect(plan.projects).toEqual([]);
  });

  it("leaves a project named E2E-... under a real client organisation alone, and says why", () => {
    const sneaky = project("p-sneaky", "E2E-looks-like-a-test", "E2E-1", "o-real");
    const plan = planCleanup({ organizations: [realOrg], projects: [sneaky, realProject] });
    expect(plan.projects).toEqual([]);
    expect(plan.organizations).toEqual([]);
    expect(plan.skipped).toEqual([expect.objectContaining({ kind: "project", id: "p-sneaky", reason: expect.stringContaining("not an E2E- organisation") })]);
  });

  it("needs BOTH the project name and its number to start with E2E-", () => {
    const halfNamed = [project("p-a", "E2E-only-the-name", "MER-1", "o-e2e"), project("p-b", "Real name", "E2E-only-the-number", "o-e2e")];
    const plan = planCleanup({ organizations: [e2eOrg], projects: halfNamed });
    expect(plan.projects).toEqual([]);
    // ... and the organisation that holds them is kept, because they block it.
    expect(plan.organizations).toEqual([]);
    expect(plan.skipped.filter((s) => s.kind === "project")).toHaveLength(2);
    expect(plan.skipped.find((s) => s.kind === "organization")?.reason).toContain("not removable");
  });

  it("keeps an E2E- organisation that also holds a real project (deleting it would take that project too)", () => {
    const real = project("p-mixed", "Customer pilot", "CUS-1", "o-e2e");
    const plan = planCleanup({ organizations: [e2eOrg], projects: [e2eP1, real] });
    expect(plan.projects.map((p) => p.id)).toEqual(["p-1"]);
    expect(plan.organizations).toEqual([]);
    expect(plan.skipped.map((s) => s.id).sort()).toEqual(["o-e2e", "p-mixed"]);
  });

  it("removes an empty E2E- organisation", () => {
    expect(planCleanup({ organizations: [e2eOrg], projects: [] }).organizations).toEqual([e2eOrg]);
  });

  describe("limited to one run tag", () => {
    const other = org("o-other", "E2E-2610090900zz Org");
    const otherProject = project("p-other", "E2E-2610090900zz Main project", "E2E-2610090900zz-P1", "o-other");

    it("selects only that run's records", () => {
      const plan = planCleanup({ organizations: [e2eOrg, other], projects: [e2eP1, e2eP2, otherProject], runTag: "E2E-2610081030ab" });
      expect(plan.organizations.map((o) => o.id)).toEqual(["o-e2e"]);
      expect(plan.projects.map((p) => p.id)).toEqual(["p-1", "p-2"]);
      // Another run's organisation is reported as left alone; its projects are simply not this run's business.
      expect(plan.skipped).toEqual([expect.objectContaining({ kind: "organization", id: "o-other", reason: expect.stringContaining("run tag") })]);
    });

    it("rejects a run tag that does not start with E2E-", () => {
      expect(() => planCleanup({ organizations: [], projects: [], runTag: "Meridian" })).toThrow(E2E_PREFIX);
    });
  });
});
