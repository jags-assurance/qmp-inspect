import { beforeEach, describe, expect, it, vi } from "vitest";
import { testCtx } from "../../apps/web/lib/test-utils/mock-supabase";

vi.mock("../src/supabase", async () => ({ supabase: (await import("../../apps/web/lib/test-utils/mock-supabase")).testCtx.mock.client }));

import { aggregateReportPackData } from "../src/jobs/reportPackAggregation";
import { hasPeriodActivity, runProjectPacks, selectProjectsForPacks } from "../src/jobs/projectPackFanout";
import { JobAbortedError } from "../src/jobs/jobAbort";

const mock = testCtx.mock;
const ORG = "11111111-1111-4111-8111-111111111111";
const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const START = "2026-11-02T00:00:00.000Z";
const END = "2026-11-09T00:00:00.000Z";

function seed(opts: { leakOtherProject: boolean }) {
  mock.reset();
  mock.on("organizations", "select", { data: { id: ORG, name: "Acme" } });
  mock.on("projects", "select", (c) => {
    const scoped = c.filters.find((f) => f[0] === "eq" && f[1] === "id");
    const all = [
      { id: P1, project_number: "P-1", name: "Alpha" },
      { id: P2, project_number: "P-2", name: "Beta" },
    ];
    return { data: scoped ? all.filter((p) => p.id === scoped[2]) : all };
  });
  // Rows for BOTH projects, as if the database filter were bypassed or wrong.
  const ncr = (id: string, project_id: string, severity: string) => ({ id, project_id, severity, status: "open", created_at: "2026-11-03T00:00:00Z", closed_at: null });
  const all = (rows: unknown[]) => ({ data: opts.leakOtherProject ? rows : rows.filter((r) => (r as { project_id: string }).project_id === P1) });
  mock.on("itps", "select", all([{ id: "i1", project_id: P1, status: "client_accepted" }, { id: "i2", project_id: P2, status: "draft" }, { id: "i3", project_id: P2, status: "draft" }]));
  mock.on(
    "inspection_records",
    "select",
    all([
      { id: "r1", project_id: P1, itp_item_id: "x1", overall_result: "pass", created_at: "2026-11-03T00:00:00Z" },
      { id: "r2", project_id: P2, itp_item_id: "x2", overall_result: "fail", created_at: "2026-11-03T00:00:00Z" },
      { id: "r3", project_id: P2, itp_item_id: "x3", overall_result: "fail", created_at: "2026-11-04T00:00:00Z" },
    ])
  );
  mock.on("ncrs", "select", all([ncr("n1", P1, "minor_ncr"), ncr("n2", P2, "major_ncr"), ncr("n3", P2, "major_ncr")]));
}

describe("aggregateReportPackData project scope", () => {
  beforeEach(() => seed({ leakOtherProject: true }));

  it("a project pack contains only that project's figures, even if the queries returned other projects' rows", async () => {
    const agg = await aggregateReportPackData(ORG, START, END, P1);
    expect(agg.perProject.map((p) => p.projectId)).toEqual([P1]);
    expect(agg.inspectionsCompleted).toBe(1);
    expect(agg.firstTimePassCounts).toEqual({ firstAttempts: 1, firstTimePasses: 1 });
    expect(agg.firstTimePassRate).toBe(100); // P2's two failed first attempts must not dilute it
    expect(agg.ncrsOpened).toBe(1);
    expect(agg.ncrsBySeverity).toEqual([{ severity: "minor_ncr", opened: 1, closed: 0 }]); // no P2 major NCRs
    expect(agg.itpCompletionCounts).toEqual({ clientAccepted: 1, total: 1 });
    expect(agg.organizationName).toBe("Acme - Alpha");
    expect(JSON.stringify(agg)).not.toContain(P2);
    expect(JSON.stringify(agg)).not.toContain("Beta");
  });

  it("filters every query by the project only", async () => {
    await aggregateReportPackData(ORG, START, END, P1);
    for (const table of ["itps", "inspection_records", "ncrs"]) {
      const call = mock.calls.find((c) => c.table === table)!;
      expect(call.filters).toContainEqual(["in", "project_id", [P1]]);
    }
  });

  it("the organisation-wide pack still covers every project", async () => {
    const agg = await aggregateReportPackData(ORG, START, END, null);
    expect(agg.perProject.map((p) => p.projectId).sort()).toEqual([P1, P2]);
    expect(agg.inspectionsCompleted).toBe(3);
    expect(agg.ncrsOpened).toBe(3);
  });

  it("rejects a project that is not in the organisation", async () => {
    mock.on("projects", "select", { data: [] });
    await expect(aggregateReportPackData(ORG, START, END, P1)).rejects.toThrow(/does not belong/);
  });
});

describe("selectProjectsForPacks / hasPeriodActivity", () => {
  const row = (projectId: string, i = 0, o = 0, c = 0) => ({ projectId, inspectionsCompleted: i, ncrsOpened: o, ncrsClosed: c });
  it("skips projects without period activity and de-duplicates", () => {
    expect(hasPeriodActivity(row("x"))).toBe(false);
    expect(hasPeriodActivity(row("x", 0, 0, 1))).toBe(true);
    const { generate, skipped } = selectProjectsForPacks([row("a", 1), row("b"), row("a", 1), row("c", 0, 2)]);
    expect(generate.map((r) => r.projectId)).toEqual(["a", "c"]);
    expect(skipped.map((r) => r.projectId)).toEqual(["b"]);
  });
});

describe("runProjectPacks", () => {
  const row = (projectId: string, i = 1) => ({ projectId, inspectionsCompleted: i, ncrsOpened: 0, ncrsClosed: 0 });

  it("keeps going when one project fails, and reports it", async () => {
    const done: string[] = [];
    const out = await runProjectPacks([row("a"), row("b"), row("c"), row("empty", 0)], async (r) => {
      if (r.projectId === "b") throw new Error("render exploded");
      done.push(r.projectId);
    });
    expect(done).toEqual(["a", "c"]);
    expect(out.generated).toEqual(["a", "c"]);
    expect(out.failed).toEqual([{ projectId: "b", message: "render exploded" }]);
    expect(out.skippedNoActivity).toEqual(["empty"]);
  });

  it("stops starting new projects once the time budget is spent", async () => {
    let t = 0;
    const out = await runProjectPacks(
      [row("a"), row("b"), row("c")],
      async () => {
        t += 100;
      },
      { now: () => t, deadline: 150 }
    );
    expect(out.generated).toEqual(["a", "b"]);
    expect(out.deferred).toEqual(["c"]);
  });

  it("re-throws a job abort so nothing is published after a timeout", async () => {
    await expect(
      runProjectPacks([row("a"), row("b")], async () => {
        throw new JobAbortedError();
      })
    ).rejects.toBeInstanceOf(JobAbortedError);
  });
});
