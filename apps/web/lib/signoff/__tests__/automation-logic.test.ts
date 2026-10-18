import { describe, expect, it } from "vitest";
import {
  canAutoProceedLevel,
  isNoticePeriodElapsed,
  parseAutomationFlags,
  resolveNoticeHours,
  selectRowsToAutoNotify,
  selectRowsToAutoProceed,
  type AutomationRow,
  type LevelInfo,
} from "../automation-logic";

const LEVELS: LevelInfo[] = [
  { code: "CIR", label: "Client Internal Review", sort_order: 0, is_blocking: true },
  { code: "H", label: "Hold", sort_order: 1, is_blocking: true },
  { code: "W", label: "Witness", sort_order: 2, is_blocking: false },
  { code: "R", label: "Review", sort_order: 3, is_blocking: false },
  { code: "S", label: "Surveillance", sort_order: 4, is_blocking: false },
];

let n = 0;
function row(intervention: string, status: AutomationRow["status"], extra: Partial<AutomationRow> = {}): AutomationRow {
  n += 1;
  return {
    id: `r${n}`,
    itp_item_id: "item1",
    project_party_id: `party-${intervention}`,
    intervention,
    status,
    notified_at: status === "notified" ? "2026-01-01T00:00:00Z" : null,
    ...extra,
  };
}

const NOW = new Date("2026-01-10T00:00:00Z"); // 9 days after the default notified_at
const hours = (h: number) => () => h;

describe("parseAutomationFlags", () => {
  it("defaults to off for null, missing columns and non-true values", () => {
    expect(parseAutomationFlags(null)).toEqual({ autoNotify: false, autoProceed: false });
    expect(parseAutomationFlags({})).toEqual({ autoNotify: false, autoProceed: false });
    expect(parseAutomationFlags({ auto_notify_signoffs: "true", auto_proceed_after_notice: 1 })).toEqual({
      autoNotify: false,
      autoProceed: false,
    });
  });
  it("reads each switch independently", () => {
    expect(parseAutomationFlags({ auto_notify_signoffs: true })).toEqual({ autoNotify: true, autoProceed: false });
    expect(parseAutomationFlags({ auto_proceed_after_notice: true })).toEqual({ autoNotify: false, autoProceed: true });
  });
});

describe("selectRowsToAutoNotify", () => {
  it("notifies pending rows once the ITP is approved or client accepted, not before", () => {
    const rows = [row("W", "pending")];
    for (const status of ["draft", "under_review", "superseded", null, undefined]) {
      expect(selectRowsToAutoNotify({ itpStatus: status, rows, levels: LEVELS, strictMode: false })).toEqual([]);
    }
    for (const status of ["approved", "client_accepted"]) {
      expect(selectRowsToAutoNotify({ itpStatus: status, rows, levels: LEVELS, strictMode: false })).toHaveLength(1);
    }
  });

  it("only picks pending rows (never re-notifies notified or cleared ones)", () => {
    const rows = [row("W", "notified"), row("S", "signed_off"), row("H", "proceeded_no_response"), row("R", "pending")];
    const picked = selectRowsToAutoNotify({ itpStatus: "approved", rows, levels: LEVELS, strictMode: false });
    expect(picked.map((r) => r.intervention)).toEqual(["R"]);
  });

  it("holds back a blocking level until the lower blocking level has cleared", () => {
    const rows = [row("CIR", "pending"), row("H", "pending")];
    const first = selectRowsToAutoNotify({ itpStatus: "approved", rows, levels: LEVELS, strictMode: false });
    expect(first.map((r) => r.intervention)).toEqual(["CIR"]);

    const cleared = [row("CIR", "signed_off"), row("H", "pending")];
    const second = selectRowsToAutoNotify({ itpStatus: "approved", rows: cleared, levels: LEVELS, strictMode: false });
    expect(second.map((r) => r.intervention)).toEqual(["H"]);
  });

  it("treats proceeded_no_response as clearing the lower level", () => {
    const rows = [row("CIR", "proceeded_no_response"), row("H", "pending")];
    expect(selectRowsToAutoNotify({ itpStatus: "approved", rows, levels: LEVELS, strictMode: false }).map((r) => r.intervention)).toEqual(["H"]);
  });

  it("flexible mode does not sequence non-blocking levels; strict mode does", () => {
    const rows = [row("H", "pending"), row("W", "pending"), row("R", "pending")];
    const flexible = selectRowsToAutoNotify({ itpStatus: "approved", rows, levels: LEVELS, strictMode: false });
    expect(flexible.map((r) => r.intervention).sort()).toEqual(["H", "R", "W"]);
    const strict = selectRowsToAutoNotify({ itpStatus: "approved", rows, levels: LEVELS, strictMode: true });
    expect(strict.map((r) => r.intervention)).toEqual(["H"]);
  });

  it("skips rows the party returned (rejected) and deactivated parties", () => {
    const rejected = row("W", "pending", { rejected_at: "2026-01-02T00:00:00Z" });
    const inactive = row("S", "pending");
    const ok = row("R", "pending");
    const picked = selectRowsToAutoNotify({
      itpStatus: "approved",
      rows: [rejected, inactive, ok],
      levels: LEVELS,
      strictMode: false,
      inactivePartyIds: new Set([inactive.project_party_id]),
    });
    expect(picked.map((r) => r.id)).toEqual([ok.id]);
  });

  it("sequences each activity separately", () => {
    const rows = [
      row("CIR", "pending", { itp_item_id: "a" }),
      row("H", "pending", { itp_item_id: "a" }),
      row("H", "pending", { itp_item_id: "b" }),
    ];
    const picked = selectRowsToAutoNotify({ itpStatus: "approved", rows, levels: LEVELS, strictMode: false });
    expect(picked.map((r) => `${r.itp_item_id}:${r.intervention}`).sort()).toEqual(["a:CIR", "b:H"]);
  });
});

describe("canAutoProceedLevel", () => {
  it("allows only Witness and Surveillance, and only while the org keeps them non-blocking", () => {
    expect(canAutoProceedLevel("W", { is_blocking: false })).toBe(true);
    expect(canAutoProceedLevel("S", { is_blocking: false })).toBe(true);
    expect(canAutoProceedLevel("W", { is_blocking: true })).toBe(false);
    expect(canAutoProceedLevel("W", undefined)).toBe(false);
  });
  it("never allows Hold or Review, even if misconfigured as non-blocking", () => {
    expect(canAutoProceedLevel("H", { is_blocking: false })).toBe(false);
    expect(canAutoProceedLevel("R", { is_blocking: false })).toBe(false);
    expect(canAutoProceedLevel("CIR", { is_blocking: false })).toBe(false);
  });
});

describe("resolveNoticeHours / isNoticePeriodElapsed", () => {
  it("follows item override, project config, org default, then built-in", () => {
    expect(resolveNoticeHours({ itemOverride: 5, projectConfigHours: 10, levelDefaultHours: 20, code: "W" })).toBe(5);
    expect(resolveNoticeHours({ itemOverride: null, projectConfigHours: 10, levelDefaultHours: 20, code: "W" })).toBe(10);
    expect(resolveNoticeHours({ itemOverride: null, projectConfigHours: null, levelDefaultHours: 20, code: "W" })).toBe(20);
    expect(resolveNoticeHours({ itemOverride: null, projectConfigHours: null, levelDefaultHours: null, code: "W" })).toBe(24);
    expect(resolveNoticeHours({ itemOverride: null, projectConfigHours: null, levelDefaultHours: null, code: "H" })).toBe(48);
    expect(resolveNoticeHours({ itemOverride: undefined, projectConfigHours: undefined, levelDefaultHours: undefined, code: "S" })).toBe(24);
  });
  it("elapses exactly at the end of the notice period and never without a notified_at", () => {
    const at = "2026-01-01T00:00:00Z";
    expect(isNoticePeriodElapsed(at, 24, new Date("2026-01-01T23:59:59Z"))).toBe(false);
    expect(isNoticePeriodElapsed(at, 24, new Date("2026-01-02T00:00:00Z"))).toBe(true);
    expect(isNoticePeriodElapsed(null, 24, NOW)).toBe(false);
    expect(isNoticePeriodElapsed("not a date", 24, NOW)).toBe(false);
  });
});

describe("selectRowsToAutoProceed", () => {
  const base = { itpStatus: "approved", levels: LEVELS, strictMode: false, now: NOW, noticeHoursFor: hours(24) };

  it("proceeds a notified Witness and Surveillance row past the notice period", () => {
    const rows = [row("W", "notified"), row("S", "notified")];
    const out = selectRowsToAutoProceed({ ...base, rows });
    expect(out.map((o) => o.row.intervention).sort()).toEqual(["S", "W"]);
    expect(out[0].noticeHours).toBe(24);
  });

  it("NEVER proceeds a Hold or a Review, however overdue", () => {
    const rows = [row("H", "notified"), row("R", "notified"), row("CIR", "notified")];
    expect(selectRowsToAutoProceed({ ...base, noticeHoursFor: hours(1), rows })).toEqual([]);
  });

  it("does not proceed before the notice period ends", () => {
    const rows = [row("W", "notified")];
    expect(selectRowsToAutoProceed({ ...base, noticeHoursFor: hours(24 * 30), rows })).toEqual([]);
  });

  it("ignores pending (never notified), signed off and already-proceeded rows", () => {
    const rows = [row("W", "pending"), row("S", "signed_off"), row("W", "proceeded_no_response", { itp_item_id: "item2" })];
    expect(selectRowsToAutoProceed({ ...base, rows })).toEqual([]);
  });

  it("does nothing unless the ITP is approved or client accepted", () => {
    const rows = [row("W", "notified")];
    expect(selectRowsToAutoProceed({ ...base, itpStatus: "under_review", rows })).toEqual([]);
    expect(selectRowsToAutoProceed({ ...base, itpStatus: "client_accepted", rows })).toHaveLength(1);
  });

  it("does not proceed a level whose lower level is still uncleared (strict sequencing)", () => {
    const rows = [row("H", "pending"), row("W", "notified")];
    expect(selectRowsToAutoProceed({ ...base, strictMode: true, rows })).toEqual([]);
    expect(selectRowsToAutoProceed({ ...base, strictMode: false, rows })).toHaveLength(1);
  });

  it("does not proceed a Witness the org reconfigured as blocking", () => {
    const levels = LEVELS.map((l) => (l.code === "W" ? { ...l, is_blocking: true } : l));
    expect(selectRowsToAutoProceed({ ...base, levels, rows: [row("W", "notified")] })).toEqual([]);
  });

  it("only ever decides on notified rows, so its output can never be a sign-off", () => {
    const rows = [row("W", "notified")];
    for (const { row: r } of selectRowsToAutoProceed({ ...base, rows })) expect(r.status).toBe("notified");
  });
});
