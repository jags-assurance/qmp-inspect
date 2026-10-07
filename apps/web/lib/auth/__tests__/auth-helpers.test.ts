import { describe, expect, it } from "vitest";
import { safeNextPath } from "../safe-redirect";
import { checkPasswordPolicy } from "../password-policy";
import { decideProxyAccess } from "../proxy-decision";
import { evaluateSession, readSessionLimitConfig, signStamp, verifyStamp } from "../session-limits";
import { isThrottled, THROTTLE_LIMITS, attemptKey } from "../throttle-pure";
import { loginNotice } from "../login-notices";

describe("safeNextPath", () => {
  it("keeps same-site paths with query strings", () => {
    expect(safeNextPath("/inspect/ncrs?panel=1&status=open")).toBe("/inspect/ncrs?panel=1&status=open");
  });
  it.each(["@evil.example", "//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "/%2fevil", "", "/login", "/a\nb"])(
    "rejects %j",
    (v) => expect(safeNextPath(v)).toBe("/")
  );
  it("uses the fallback and caps length", () => {
    expect(safeNextPath(null, "/reset-password")).toBe("/reset-password");
    expect(safeNextPath("/" + "a".repeat(600))).toBe("/");
  });
});

describe("password policy", () => {
  it("rejects short, common, trivial and email-derived passwords", () => {
    expect(checkPasswordPolicy("short1").ok).toBe(false);
    expect(checkPasswordPolicy("Password123!").ok).toBe(false);
    expect(checkPasswordPolicy("aaaaaaaaaaaa").ok).toBe(false);
    expect(checkPasswordPolicy("1234567890").ok).toBe(false);
    expect(checkPasswordPolicy("janedoe-secret-1", { email: "janedoe@acme.com" }).ok).toBe(false);
  });
  it("accepts a reasonable passphrase", () => {
    expect(checkPasswordPolicy("correct horse battery staple").ok).toBe(true);
  });
});

describe("session limits and proxy decision", () => {
  const config = { inactivityMs: 1000, absoluteMs: 10_000 };
  it("evaluates idle and expired", () => {
    expect(evaluateSession({ now: 5000, lastSeen: 4500, lastSignInAt: 0, config })).toBe("ok");
    expect(evaluateSession({ now: 5000, lastSeen: 1000, lastSignInAt: 0, config })).toBe("idle");
    expect(evaluateSession({ now: 20_000, lastSeen: 19_900, lastSignInAt: 0, config })).toBe("expired");
    expect(evaluateSession({ now: 5000, lastSeen: null, lastSignInAt: null, config })).toBe("ok");
  });
  it("reads env config", () => {
    const c = readSessionLimitConfig({ SESSION_INACTIVITY_HOURS: "2", SESSION_MAX_HOURS: "24" });
    expect(c.inactivityMs).toBe(2 * 3_600_000);
    expect(c.absoluteMs).toBe(24 * 3_600_000);
    expect(readSessionLimitConfig({}).absoluteMs).toBe(168 * 3_600_000);
  });
  it("signs and verifies stamps, binding them to the user", async () => {
    const token = await signStamp("secret", "u1", 123);
    expect(await verifyStamp("secret", "u1", token)).toBe(123);
    expect(await verifyStamp("secret", "u2", token)).toBeNull();
    expect(await verifyStamp("other", "u1", token)).toBeNull();
    expect(await verifyStamp("secret", "u1", token.slice(0, -2) + "00")).toBeNull();
    expect(await verifyStamp("secret", "u1", undefined)).toBeNull();
  });
  it("decides sign-out reasons and passes the forced-change claim through", () => {
    const base = { now: 5000, lastSeen: 4900, lastSignInAt: 0, limits: config, deactivated: false, mustChangePasswordClaim: null };
    expect(decideProxyAccess(base)).toEqual({ action: "continue", mustChangePassword: null });
    expect(decideProxyAccess({ ...base, mustChangePasswordClaim: true })).toEqual({ action: "continue", mustChangePassword: true });
    expect(decideProxyAccess({ ...base, deactivated: true })).toEqual({ action: "sign_out", reason: "deactivated" });
    expect(decideProxyAccess({ ...base, lastSeen: 1 })).toEqual({ action: "sign_out", reason: "session_idle" });
    expect(decideProxyAccess({ ...base, now: 50_000, lastSeen: 49_900 })).toEqual({ action: "sign_out", reason: "session_expired" });
    expect(
      decideProxyAccess({ ...base, mustChangePasswordClaim: true, tempPasswordExpiresAt: new Date(1000).toISOString() })
    ).toEqual({ action: "sign_out", reason: "temp_password_expired" });
  });
});

describe("throttle", () => {
  it("blocks at the per-email or per-ip limit", () => {
    const l = THROTTLE_LIMITS.signin;
    expect(isThrottled({ email: l.perEmail - 1, ip: 0 }, l)).toBe(false);
    expect(isThrottled({ email: l.perEmail, ip: 0 }, l)).toBe(true);
    expect(isThrottled({ email: 0, ip: l.perIp }, l)).toBe(true);
  });
  it("hashes keys case-insensitively without exposing the email", () => {
    expect(attemptKey("email", "A@b.com")).toBe(attemptKey("email", " a@B.com "));
    expect(attemptKey("email", "a@b.com")).not.toContain("a@b.com");
  });
});

describe("login notices", () => {
  it("maps known codes only", () => {
    expect(loginNotice("deactivated")).toMatch(/deactivated/);
    expect(loginNotice("__proto__")).toBeNull();
    expect(loginNotice(undefined)).toBeNull();
  });
});
