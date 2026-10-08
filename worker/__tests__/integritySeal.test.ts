import { describe, expect, it, vi } from "vitest";
import { recordRenderedPdfHash, sealFooterSpan, sha256Hex, shortSeal } from "../src/jobs/integritySeal";

describe("sha256Hex", () => {
  it("matches the known digest of 'abc'", () => {
    expect(sha256Hex(Buffer.from("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("changes when one byte changes", () => {
    expect(sha256Hex(Buffer.from("abc"))).not.toBe(sha256Hex(Buffer.from("abd")));
  });
});

describe("shortSeal / sealFooterSpan", () => {
  it("groups the first 16 hex characters", () => {
    expect(shortSeal("ba7816bf8f01cfea414140de5dae2223")).toBe("BA78-16BF-8F01-CFEA");
  });
  it("is empty for a missing or invalid hash", () => {
    expect(shortSeal(null)).toBe("");
    expect(shortSeal("xyz")).toBe("");
    expect(sealFooterSpan(undefined)).toBe("");
  });
  it("renders a footer span", () => {
    expect(sealFooterSpan("ba7816bf8f01cfea414140de5dae2223")).toBe("<span>Content seal BA78-16BF-8F01-CFEA</span>");
  });
});

describe("recordRenderedPdfHash", () => {
  it("stores the hash of the bytes through the RPC and returns it", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const sha = await recordRenderedPdfHash({ rpc } as never, "irn", "id-1", Buffer.from("abc"));
    expect(sha).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(rpc).toHaveBeenCalledWith("record_rendered_pdf_sha256", { p_kind: "irn", p_id: "id-1", p_sha256: sha });
  });
  it("never throws when the function is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const rpc = vi.fn().mockResolvedValue({ error: { message: "function does not exist" } });
    await expect(recordRenderedPdfHash({ rpc } as never, "certificate", "id-2", Buffer.from("x"))).resolves.toHaveLength(64);
    const rejecting = vi.fn().mockRejectedValue(new Error("network"));
    await expect(recordRenderedPdfHash({ rpc: rejecting } as never, "certificate", "id-2", Buffer.from("x"))).resolves.toHaveLength(64);
    warn.mockRestore();
  });
});
