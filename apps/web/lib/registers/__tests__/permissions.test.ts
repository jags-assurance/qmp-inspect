import { describe, expect, it } from "vitest";
import { canEditRegisterRow } from "../permissions";

const contributor = { canManage: false, canEditOwnUnverified: true };
const staff = { canManage: true, canEditOwnUnverified: true };
const viewer = { canManage: false, canEditOwnUnverified: false };

describe("canEditRegisterRow", () => {
  it("lets a contributor edit their own unverified entry", () => {
    expect(canEditRegisterRow(contributor, "u1", { created_by: "u1", verified_at: null })).toBe(true);
  });
  it("refuses someone else's entry, a verified entry, and legacy rows without an owner", () => {
    expect(canEditRegisterRow(contributor, "u1", { created_by: "u2", verified_at: null })).toBe(false);
    expect(canEditRegisterRow(contributor, "u1", { created_by: "u1", verified_at: "2026-01-01" })).toBe(false);
    expect(canEditRegisterRow(contributor, "u1", { created_by: null, verified_at: null })).toBe(false);
  });
  it("always lets staff, never a plain viewer", () => {
    expect(canEditRegisterRow(staff, "s", { created_by: "u2", verified_at: "2026-01-01" })).toBe(true);
    expect(canEditRegisterRow(viewer, "u1", { created_by: "u1", verified_at: null })).toBe(false);
  });
});
