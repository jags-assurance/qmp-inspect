import { describe, expect, it } from "vitest";
import { EXTERNAL_WIDGET_ORDER, resolveDashboardRole } from "../widgets";

describe("resolveDashboardRole", () => {
  it("maps party types to roles", () => {
    expect(resolveDashboardRole("client", false)).toBe("client");
    expect(resolveDashboardRole("main_contractor", false)).toBe("main_contractor");
    expect(resolveDashboardRole("subcontractor", false)).toBe("subcontractor");
    expect(resolveDashboardRole("tpi_lab", false)).toBe("tpi");
    expect(resolveDashboardRole("vendor", false)).toBe("other");
    expect(resolveDashboardRole(null, false)).toBe("other");
  });

  it("a self-/client-managed org's login is a client org admin whatever its party type", () => {
    expect(resolveDashboardRole("client", true)).toBe("client_org_admin");
    expect(resolveDashboardRole(null, true)).toBe("client_org_admin");
  });
});

describe("EXTERNAL_WIDGET_ORDER", () => {
  it("leads each role with what they act on daily", () => {
    expect(EXTERNAL_WIDGET_ORDER.client[0]).toBe("acceptance");
    expect(EXTERNAL_WIDGET_ORDER.client_org_admin[0]).toBe("orgHealth");
    expect(EXTERNAL_WIDGET_ORDER.main_contractor[0]).toBe("review");
    expect(EXTERNAL_WIDGET_ORDER.subcontractor[0]).toBe("signoffs");
  });

  it("puts reference widgets last and never repeats a widget", () => {
    for (const order of Object.values(EXTERNAL_WIDGET_ORDER)) {
      expect(order.slice(-2)).toEqual(["stats", "projects"]);
      expect(new Set(order).size).toBe(order.length);
    }
  });
});
