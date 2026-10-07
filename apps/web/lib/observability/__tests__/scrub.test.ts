import { describe, expect, it } from "vitest";
import { redactText, scrubEvent } from "../scrub";

describe("scrub", () => {
  it("redacts emails, bearer tokens and JWTs", () => {
    expect(redactText("failed for jane.doe@acme.com")).toBe("failed for [email]");
    expect(redactText("Authorization: Bearer abcdefghijklmnop")).toContain("Bearer [token]");
    expect(redactText("tok eyJhbGciOiJI.eyJzdWIiOiIx.sig")).toContain("[jwt]");
  });
  it("drops user, cookies, headers and query strings", () => {
    const e = scrubEvent({
      message: "x@y.io broke",
      user: { email: "x@y.io" },
      request: { cookies: { a: "b" }, headers: { cookie: "c" }, url: "https://a/b?token=1" },
      exception: { values: [{ value: "bad for q@w.com" }] },
    });
    expect(e.user).toBeUndefined();
    expect(e.request?.cookies).toBeUndefined();
    expect(e.request?.url).toBe("https://a/b");
    expect(e.message).toBe("[email] broke");
    expect(e.exception?.values?.[0].value).toBe("bad for [email]");
  });
});
