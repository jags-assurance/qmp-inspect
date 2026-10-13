import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isPasswordPwned } from "../pwned-password";

const sha = (p: string) => createHash("sha1").update(p).digest("hex").toUpperCase();
const mockFetch = (impl: () => Promise<unknown>) => vi.stubGlobal("fetch", vi.fn(impl));
const ok = (body: string) => () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });

afterEach(() => vi.unstubAllGlobals());

describe("isPasswordPwned", () => {
  it("returns true when the suffix is listed", async () => {
    const h = sha("hunter2hunter2");
    mockFetch(ok(`AAAAA:3\r\n${h.slice(5)}:42\r\nBBBBB:1`));
    expect(await isPasswordPwned("hunter2hunter2")).toBe(true);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${h.slice(0, 5)}`);
    expect(init.headers["Add-Padding"]).toBe("true");
  });
  it("returns false when the suffix is not listed", async () => {
    mockFetch(ok("AAAAA:3\r\nBBBBB:1"));
    expect(await isPasswordPwned("some-unique-passphrase-x9")).toBe(false);
  });
  it("ignores padding entries with count 0", async () => {
    const h = sha("padded-password-1");
    mockFetch(ok(`${h.slice(5)}:0\r\nCCCCC:2`));
    expect(await isPasswordPwned("padded-password-1")).toBe(false);
  });
  it("fails open on network error / timeout", async () => {
    mockFetch(() => Promise.reject(new DOMException("timeout", "TimeoutError")));
    expect(await isPasswordPwned("whatever123")).toBe(false);
  });
  it("fails open on a non-200 response", async () => {
    mockFetch(() => Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve("") }));
    expect(await isPasswordPwned("whatever123")).toBe(false);
  });
});
