import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { redactText, scrubEvent, scrubUrl, dropBreadcrumb } from "../src/observability/scrub";

const body = (file: string) => {
  const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  // Drop the leading comment header (up to the first blank line); the logic below it must be identical.
  return text.slice(text.indexOf("\n\n") + 2);
};

describe("worker Sentry scrubbing (E-08)", () => {
  it("is an exact copy of the web implementation (drift guard)", () => {
    const web = path.resolve(__dirname, "../../apps/web/lib/observability/scrub.ts");
    const worker = path.resolve(__dirname, "../src/observability/scrub.ts");
    expect(body(worker)).toBe(body(web));
  });

  it("scrubs emails, tokens, urls and request context", () => {
    expect(redactText("render failed for jane@acme.com")).toBe("render failed for [email]");
    expect(redactText("GET https://x/y?token=abc123 Bearer abcdefghijklmnop")).toBe("GET https://x/y?token=[redacted] Bearer [token]");
    expect(scrubUrl("https://app/verify/irn/Abcdefgh1234?x=1")).toBe("https://app/verify/irn/[token]");
    const e = scrubEvent({ message: "x@y.io", user: { id: "1" }, extra: { a: 1 }, request: { url: "https://a/b?c=d", headers: {} }, breadcrumbs: [{}] });
    expect(e.message).toBe("[email]");
    expect(e.user).toBeUndefined();
    expect(e.extra).toBeUndefined();
    expect(e.request?.url).toBe("https://a/b");
    expect(e.breadcrumbs).toEqual([]);
    expect(dropBreadcrumb()).toBeNull();
  });
});
