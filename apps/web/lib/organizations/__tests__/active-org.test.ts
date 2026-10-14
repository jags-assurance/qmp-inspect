import { describe, expect, it } from "vitest";
import { grantedOrgIds, resolveActiveOrgId } from "../active-org";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const grants = [{ organization_id: null }, { organization_id: A }, { organization_id: B }, { organization_id: A }];

describe("active organisation resolver", () => {
  it("lists distinct granted orgs", () => expect(grantedOrgIds(grants)).toEqual([A, B]));
  it("defaults to the first grant", () => expect(resolveActiveOrgId(grants, undefined)).toBe(A));
  it("honours a cookie for a granted org (case-insensitive)", () => {
    expect(resolveActiveOrgId(grants, B)).toBe(B);
    expect(resolveActiveOrgId(grants, B.toUpperCase())).toBe(B);
  });
  it("ignores a cookie for an org the user has no grant in", () => expect(resolveActiveOrgId(grants, C)).toBe(A));
  it("ignores malformed cookies", () => expect(resolveActiveOrgId(grants, "not-a-uuid")).toBe(A));
  it("returns null with no org grants", () => expect(resolveActiveOrgId([{ organization_id: null }], B)).toBeNull());
});
