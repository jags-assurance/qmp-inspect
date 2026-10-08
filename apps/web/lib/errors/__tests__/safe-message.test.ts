import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { safeDbMessage, safeStorageUploadMessage } from "../safe-message";

describe("safe error messages (P14)", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => spy.mockRestore());

  it("passes through an application-raised (P0001) message", () => {
    expect(safeDbMessage({ code: "P0001", message: "ITP must be approved before it can be accepted" }, "fallback")).toBe(
      "ITP must be approved before it can be accepted"
    );
  });

  it("hides raw database text and logs it instead", () => {
    const raw = 'duplicate key value violates unique constraint "itps_pkey" on relation public.itps';
    const msg = safeDbMessage({ code: "23505", message: raw }, "Could not accept this ITP.", "accept_itp");
    expect(msg).toBe("Could not accept this ITP.");
    expect(msg).not.toMatch(/constraint|public\./);
    expect(spy).toHaveBeenCalledWith("[accept_itp]", "23505", raw);
  });

  it("does not echo an over-long P0001 payload", () => {
    expect(safeDbMessage({ code: "P0001", message: "x".repeat(400) }, "fallback")).toBe("fallback");
  });

  it("classifies storage errors without echoing them", () => {
    const rls = safeStorageUploadMessage({ message: 'new row violates row-level security policy for table "objects"', statusCode: "403" });
    expect(rls).toBe("You don't have permission to upload this file here.");
    expect(rls).not.toMatch(/row-level|objects/);
    expect(safeStorageUploadMessage({ message: "The object exceeded the maximum allowed size", statusCode: "413" })).toMatch(/larger than the storage limit/);
    expect(safeStorageUploadMessage({ message: "Failed to fetch" })).toMatch(/connection/);
    const other = safeStorageUploadMessage({ message: 'relation "storage.objects" does not exist' });
    expect(other).toBe("Upload failed. Please try again.");
  });
});
