import { describe, expect, it } from "vitest";
import { dropBreadcrumb, redactText, scrubEvent, scrubUrl } from "../scrub";

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

  it("redacts credential-looking key=value pairs in text", () => {
    expect(redactText("GET /storage/v1/object/sign/x?token=abc123def&download=1 failed")).toBe(
      "GET /storage/v1/object/sign/x?token=[redacted]&download=1 failed"
    );
    expect(redactText("auth failed: access_token=ey123 password=hunter2 ok")).toBe("auth failed: access_token=[redacted] password=[redacted] ok");
    expect(redactText("apikey=SECRETVALUE")).toBe("apikey=[redacted]");
  });
  it("leaves ordinary key=value text alone", () => {
    expect(redactText("status=500 code=ENOENT retries=3")).toBe("status=500 code=ENOENT retries=3");
  });
  it("masks Supabase auth cookies", () => {
    expect(redactText("cookie: sb-abcd1234-auth-token.0=base64payload; other=1")).toBe("cookie: [auth-cookie]; other=1");
  });
  it("masks the token segment of public verification links", () => {
    expect(scrubUrl("https://app.example.com/verify/ncr/Abc123_def-456XYZ?x=1#frag")).toBe("https://app.example.com/verify/ncr/[token]");
    expect(scrubUrl("https://app.example.com/inspect/ncrs")).toBe("https://app.example.com/inspect/ncrs");
  });

  it("scrubs transaction names, stack-frame variables, spans, contexts and server name", () => {
    const e = scrubEvent({
      transaction: "GET /verify/irn/Zxcvbnm12345?x=1",
      server_name: "box-42",
      contexts: { request: { url: "x" }, runtime: { name: "node" } },
      exception: { values: [{ value: "v", stacktrace: { frames: [{ vars: { email: "a@b.co" } }, {}] } }] },
      spans: [
        { description: "fetch https://x/y?token=abc to a@b.co", data: { "http.url": "https://x/y?token=abc", note: "mail a@b.co" } },
      ],
    });
    expect(e.transaction).toBe("GET /verify/irn/[token]");
    expect(e.server_name).toBeUndefined();
    expect(e.contexts?.request).toBeUndefined();
    expect(e.contexts?.runtime).toEqual({ name: "node" });
    expect(e.exception?.values?.[0].stacktrace?.frames?.[0].vars).toBeUndefined();
    expect(e.spans?.[0].description).toBe("fetch https://x/y?token=[redacted] to [email]");
    expect(e.spans?.[0].data?.["http.url"]).toBe("https://x/y");
    expect(e.spans?.[0].data?.note).toBe("mail [email]");
  });

  it("empties breadcrumbs and drops new ones", () => {
    expect(scrubEvent({ breadcrumbs: [{ message: "console: a@b.co" }] }).breadcrumbs).toEqual([]);
    expect(dropBreadcrumb()).toBeNull();
  });
});
