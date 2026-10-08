import { describe, it, expect } from "vitest";
import { isLicensedIn, licenseCacheTag, toLicenseMap } from "../license-map";
import { orgChromeTag, wantsLogo } from "../../organizations/chrome-logic";

describe("module licence map (fail open)", () => {
  it("builds a map from rows", () => {
    expect(toLicenseMap([{ module_key: "vault", is_licensed: false }, { module_key: "ncrs", is_licensed: true }])).toEqual({ vault: false, ncrs: true });
    expect(toLicenseMap(null)).toEqual({});
    expect(toLicenseMap(undefined)).toEqual({});
  });
  it("only an explicit false row unlicenses a module", () => {
    const map = toLicenseMap([{ module_key: "vault", is_licensed: false }, { module_key: "ncrs", is_licensed: true }]);
    expect(isLicensedIn(map, "vault")).toBe(false);
    expect(isLicensedIn(map, "ncrs")).toBe(true);
    expect(isLicensedIn(map, "itps")).toBe(true); // no row
  });
  it("a missing map (cache and database both unavailable) reads as licensed", () => {
    expect(isLicensedIn(null, "vault")).toBe(true);
    expect(isLicensedIn(undefined, "vault")).toBe(true);
  });
  it("tags are per organisation", () => {
    expect(licenseCacheTag("org-1")).toBe("module-licenses:org-1");
    expect(licenseCacheTag("org-1")).not.toBe(licenseCacheTag("org-2"));
    expect(orgChromeTag("org-1")).toBe("org-chrome:org-1");
  });
});

describe("wantsLogo", () => {
  it("shows a logo only for a non JAGS-led org that has one", () => {
    expect(wantsLogo({ engagement_mode: "client_led", branding_logo_path: "o/logo.png" })).toBe(true);
    expect(wantsLogo({ engagement_mode: "jags_led", branding_logo_path: "o/logo.png" })).toBe(false);
    expect(wantsLogo({ engagement_mode: "client_led", branding_logo_path: null })).toBe(false);
  });
});
