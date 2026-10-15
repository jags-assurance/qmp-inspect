import { describe, expect, it } from "vitest";
import {
  VAULT_DEFAULT_UPLOAD_MB,
  VAULT_MAX_UPLOAD_MB,
  effectiveVaultUploadLimitMb,
  parseVaultUploadLimitMb,
  vaultFileTooLargeMessage,
} from "../limits";

describe("vault upload limit", () => {
  it("defaults to 50 MB with a 500 MB ceiling", () => {
    expect(VAULT_DEFAULT_UPLOAD_MB).toBe(50);
    expect(VAULT_MAX_UPLOAD_MB).toBe(500);
  });
  it("accepts whole numbers from 1 to 500", () => {
    expect(parseVaultUploadLimitMb("1")).toEqual({ ok: true, mb: 1 });
    expect(parseVaultUploadLimitMb(" 200 ")).toEqual({ ok: true, mb: 200 });
    expect(parseVaultUploadLimitMb("500")).toEqual({ ok: true, mb: 500 });
  });
  it("rejects zero, too big, decimals and text", () => {
    for (const bad of ["0", "501", "12.5", "abc", "", "-5"]) expect(parseVaultUploadLimitMb(bad).ok).toBe(false);
  });
  it("falls back to the default for a stored value that is unusable", () => {
    expect(effectiveVaultUploadLimitMb(null)).toBe(50);
    expect(effectiveVaultUploadLimitMb(0)).toBe(50);
    expect(effectiveVaultUploadLimitMb(900)).toBe(50);
    expect(effectiveVaultUploadLimitMb(120)).toBe(120);
  });
  it("names the organisation's limit in the too-large message and points at the Admin only when raising is possible", () => {
    expect(vaultFileTooLargeMessage(80 * 1024 * 1024, 50)).toMatch(/50 MB[\s\S]*80 MB[\s\S]*raise the upload limit/);
    expect(vaultFileTooLargeMessage(600 * 1024 * 1024)).not.toMatch(/raise/);
  });
});
