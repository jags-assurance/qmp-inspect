import { describe, expect, it } from "vitest";
import { isMissingDbObject, isRegisterRowActive, isRegisterRowCounted, isRegisterRowVerified, judgementDate } from "../lifecycle";
import { todayInTimeZone } from "../status";
import { boundCapturedAt, extractOverrideReason, OVERRIDE_PREFIX } from "../server-check";
import { pickRegisterKind } from "../verify";
import { impactedCycleIds } from "../impact";
import { normaliseCertificatePath } from "../paths";
import { parseCsv, parseCsvObjects, toCsv } from "../csv";
import { normaliseImportDate, planRegisterImport } from "../csv-import";

describe("register lifecycle / verification", () => {
  it("treats rows from before the migration (no columns) as verified and active", () => {
    expect(isRegisterRowCounted({})).toBe(true);
  });
  it("does not count unverified rows", () => {
    expect(isRegisterRowVerified({ verified_at: null })).toBe(false);
    expect(isRegisterRowCounted({ verified_at: null })).toBe(false);
    expect(isRegisterRowCounted({ verified_at: "2026-01-01T00:00:00Z" })).toBe(true);
  });
  it("does not count superseded / retired / withdrawn rows", () => {
    for (const s of ["superseded", "retired", "withdrawn"]) {
      expect(isRegisterRowActive({ lifecycle_status: s })).toBe(false);
      expect(isRegisterRowCounted({ verified_at: "x", lifecycle_status: s })).toBe(false);
    }
  });
  it("judges a retired row on its last-used date", () => {
    const today = new Date("2026-11-03T00:00:00Z");
    expect(judgementDate({ lifecycle_status: "retired" }, "2026-05-01", today).toISOString().slice(0, 10)).toBe("2026-05-01");
    expect(judgementDate({ lifecycle_status: "active" }, "2026-05-01", today)).toBe(today);
  });
  it("recognises missing-object error codes", () => {
    expect(isMissingDbObject({ code: "42703" })).toBe(true);
    expect(isMissingDbObject({ code: "PGRST204" })).toBe(true);
    expect(isMissingDbObject({ code: "23505" })).toBe(false);
    expect(isMissingDbObject(null)).toBe(false);
  });
});

describe("todayInTimeZone", () => {
  it("flips at the site's midnight, not UTC midnight", () => {
    const now = new Date("2026-11-03T22:30:00Z"); // 02:30 on 4 Nov in Dubai, 14:30 on 3 Nov in LA
    expect(todayInTimeZone("Asia/Dubai", now).toISOString().slice(0, 10)).toBe("2026-11-04");
    expect(todayInTimeZone("America/Los_Angeles", now).toISOString().slice(0, 10)).toBe("2026-11-03");
    expect(todayInTimeZone(null, now).toISOString().slice(0, 10)).toBe("2026-11-03");
    expect(todayInTimeZone("Not/AZone", now).toISOString().slice(0, 10)).toBe("2026-11-03");
  });
});

describe("server-side soft-stop helpers", () => {
  const now = new Date("2026-11-03T12:00:00Z");
  it("bounds the client-supplied capture time", () => {
    expect(boundCapturedAt("2026-11-01T08:00:00Z", now).toISOString()).toBe("2026-11-01T08:00:00.000Z");
    expect(boundCapturedAt("2027-01-01T00:00:00Z", now)).toBe(now); // future
    expect(boundCapturedAt("2025-01-01T00:00:00Z", now)).toBe(now); // too old
    expect(boundCapturedAt("garbage", now)).toBe(now);
    expect(boundCapturedAt(null, now)).toBe(now);
  });
  it("reads the override reason from the field, else the legacy comment prefix", () => {
    expect(extractOverrideReason("Used spare gauge", "")).toBe("Used spare gauge");
    expect(extractOverrideReason("", `${OVERRIDE_PREFIX}calibration pending\nTorque ok`)).toBe("calibration pending");
    expect(extractOverrideReason("", "plain comment")).toBe("");
  });
});

describe("pickRegisterKind", () => {
  it("prefers the explicit requirement over the prose heuristic", () => {
    expect(pickRegisterKind("weld procedure", null, ["calibration"])).toBe("calibration");
    expect(pickRegisterKind("calibrated gauge", null, ["material", "welder"])).toBe("welder");
    expect(pickRegisterKind("anything", null, ["personnel"])).toBeNull();
  });
  it("falls back to keywords", () => {
    expect(pickRegisterKind("Use calibrated torque wrench", null)).toBe("calibration");
    expect(pickRegisterKind(null, "Weld visual check")).toBe("welder");
    expect(pickRegisterKind(null, "Approved material submittal")).toBe("material");
    expect(pickRegisterKind(null, "Check level")).toBeNull();
  });
});

describe("calibration impact window", () => {
  const cycles = [
    { id: "c3", supersedes_id: "c2", as_found_result: null },
    { id: "c2", supersedes_id: "c1", as_found_result: "not_recorded" },
    { id: "c1", supersedes_id: null, as_found_result: "in_tolerance" },
  ];
  it("stops at the previous cycle when it was recorded in tolerance", () => {
    expect(impactedCycleIds("c2", cycles)).toEqual(["c2"]);
  });
  it("extends back through cycles whose as-found result is unknown", () => {
    expect(impactedCycleIds("c3", cycles)).toEqual(["c3", "c2"]);
  });
  it("handles an unknown id and cycles", () => {
    expect(impactedCycleIds("zzz", cycles)).toEqual(["zzz"]);
    expect(impactedCycleIds("a", [{ id: "a", supersedes_id: "a", as_found_result: null }])).toEqual(["a"]);
  });
});

describe("certificate path validation", () => {
  const p = "11111111-1111-1111-1111-111111111111";
  it("accepts a clean path under the project's registers folder", () => {
    expect(normaliseCertificatePath(p, `${p}/registers/calibration/123-cert.pdf`)).toBe(`${p}/registers/calibration/123-cert.pdf`);
  });
  it("rejects traversal, other projects and odd characters", () => {
    expect(normaliseCertificatePath(p, `${p}/registers/../../other/registers/x/y.pdf`)).toBeNull();
    expect(normaliseCertificatePath(p, `other/registers/calibration/x.pdf`)).toBeNull();
    expect(normaliseCertificatePath(p, `${p}/registers//x.pdf`)).toBeNull();
    expect(normaliseCertificatePath(p, `${p}/registers/calibration`)).toBeNull();
    expect(normaliseCertificatePath(p, `${p}/registers/calibration/a\\b.pdf`)).toBeNull();
    expect(normaliseCertificatePath(p, "")).toBeNull();
  });
});

describe("csv", () => {
  it("round-trips quotes, commas and newlines", () => {
    const text = toCsv([["a", 'b "q", c', "line1\nline2"]]);
    expect(parseCsv(text)).toEqual([["a", 'b "q", c', "line1\nline2"]]);
  });
  it("neutralises formula injection on export", () => {
    expect(toCsv([["=SUM(A1)"]])).toContain("'=SUM(A1)");
    expect(toCsv([["-5"]])).toBe("-5\r\n");
  });
  it("detects tab-separated pastes and skips blank lines", () => {
    expect(parseCsv("a\tb\n\n1\t2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("maps rows to normalised headers", () => {
    const { records } = parseCsvObjects("Cert Number,Due Date\nC-1,2026-12-01\n");
    expect(records[0]).toEqual({ cert_number: "C-1", due_date: "2026-12-01" });
  });
});

describe("register csv import plan", () => {
  it("accepts valid calibration rows and computes status", () => {
    const plan = planRegisterImport("calibration", "instrument_name,cert_number,cal_date,due_date\nGauge 1,C-1,01/06/2026,2099-01-01\n");
    expect(plan.errors).toEqual([]);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]).toMatchObject({ instrument_name: "Gauge 1", cal_date: "2026-06-01", status: "valid" });
  });
  it("reports every bad line and missing columns", () => {
    expect(planRegisterImport("calibration", "instrument_name\nx\n").errors[0]).toMatch(/Missing required column/);
    const plan = planRegisterImport("welder", "welder_identifier,qualified_wps,expiry_date\nW1,WPS-1,notadate\n,WPS-2,2099-01-01\n");
    expect(plan.rows).toHaveLength(0);
    expect(plan.errors).toHaveLength(2);
  });
  it("skips duplicates, including repeats in the file, and never releases a material", () => {
    const plan = planRegisterImport(
      "material",
      "material_description,approval_status,heat_number\nPlate,A,H1\nPlate,A,H1\nPipe,B,H9\n",
      { existingKeys: new Set(["h9|pipe"]) }
    );
    expect(plan.rows).toHaveLength(1);
    expect(plan.duplicates).toBe(2);
    expect(plan.rows[0].receipt_status).toBe("received_pending_inspection");
  });
  it("resolves personnel party names", () => {
    const plan = planRegisterImport("personnel", "party_name,certification_type,expiry_date\nAcme,AWS CWI,2099-01-01\nNobody,AWS CWI,2099-01-01\n", {
      partyIdByName: new Map([["acme", "p1"]]),
    });
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].project_party_id).toBe("p1");
    expect(plan.errors).toHaveLength(1);
  });
  it("validates dates", () => {
    expect(normaliseImportDate("31/02/2026")).toBeNull();
    expect(normaliseImportDate("2026-02-28")).toBe("2026-02-28");
    expect(normaliseImportDate("")).toBe("");
  });
});
