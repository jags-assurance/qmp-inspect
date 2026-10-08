import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestCtx, testCtx } from "@/lib/test-utils/mock-supabase";
import { API_RATE_LIMITS, checkRateLimit, resetRateLimits } from "@/lib/api/rate-limit";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
const checklist = vi.hoisted(() => ({
  saveChecklistResponseAction: vi.fn(),
  completeInspectionCore: vi.fn(),
  startInspectionAction: vi.fn(),
  linkInspectionEvidenceDocumentAction: vi.fn(),
}));
vi.mock("@/lib/checklists/actions", () => checklist);
vi.mock("@/lib/ncrs/actions", () => ({ createNcrAction: vi.fn(), addNcrPhotoAction: vi.fn() }));
vi.mock("@/lib/standalone/actions", () => ({ addMeasurementAction: vi.fn(), addPhotoAction: vi.fn(), addSignatureAction: vi.fn() }));
vi.mock("@/lib/checklists/photo-validation", () => ({ validateOfflinePhoto: vi.fn(async () => ({ error: null })), MAX_PHOTO_BYTES: 25 * 1024 * 1024 }));

import { POST } from "@/app/api/offline-sync/route";

const URL_ = "https://app.example.com/api/offline-sync";

function req(headers: Record<string, string> = {}, fields: Record<string, string> = { kind: "checklist_response" }): Request {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return new Request(URL_, {
    method: "POST",
    headers: { "x-idempotency-key": "key-1", "sec-fetch-site": "same-origin", ...headers },
    body,
  });
}

describe("POST /api/offline-sync", () => {
  beforeEach(() => {
    resetRateLimits();
    const mock = resetTestCtx(null);
    mock.setUser({ id: "user-1" });
    Object.values(checklist).forEach((f) => f.mockReset());
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  describe("origin check (E-10): 403 with originRejected, before the session is touched", () => {
    const expectRejected = async (res: Response) => {
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ ok: false, originRejected: true, error: expect.any(String) });
      expect(checklist.saveChecklistResponseAction).not.toHaveBeenCalled();
    };

    it("rejects a request without the idempotency header", async () => {
      const r = new Request(URL_, { method: "POST", headers: { "sec-fetch-site": "same-origin" }, body: new FormData() });
      await expectRejected(await POST(r));
    });

    it("rejects Sec-Fetch-Site: cross-site and same-site", async () => {
      await expectRejected(await POST(req({ "sec-fetch-site": "cross-site" })));
      await expectRejected(await POST(req({ "sec-fetch-site": "same-site" })));
    });

    it("rejects a foreign Origin when Sec-Fetch-Site is absent", async () => {
      await expectRejected(await POST(req({ "sec-fetch-site": "", origin: "https://evil.example", "x-forwarded-host": "app.example.com" })));
    });

    it("rejects the opaque 'null' origin", async () => {
      await expectRejected(await POST(req({ "sec-fetch-site": "", origin: "null", "x-forwarded-host": "app.example.com" })));
    });

    it("does not even look up the signed-in user when the origin is refused", async () => {
      const spy = vi.spyOn(testCtx.mock.client.auth, "getUser");
      await POST(req({ "sec-fetch-site": "cross-site" }));
      expect(spy).not.toHaveBeenCalled();
    });

    it("accepts a matching Origin (forwarded host) and a same-origin fetch", async () => {
      checklist.saveChecklistResponseAction.mockResolvedValue({ error: null, updatedAt: "t" });
      const viaOrigin = await POST(req({ "sec-fetch-site": "", origin: "https://app.example.com", "x-forwarded-host": "app.example.com" }));
      expect(viaOrigin.status).toBe(200);
      const sameOrigin = await POST(req());
      expect(sameOrigin.status).toBe(200);
    });
  });

  it("returns 401 when nobody is signed in", async () => {
    testCtx.mock.setUser(null);
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false });
    expect(checklist.saveChecklistResponseAction).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After once the user's offline-sync budget is spent", async () => {
    for (let i = 0; i < API_RATE_LIMITS.offlineSync.limit; i++) checkRateLimit("offlineSync", "user-1", API_RATE_LIMITS.offlineSync);
    const res = await POST(req());
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(checklist.saveChecklistResponseAction).not.toHaveBeenCalled();
  });

  it("budgets per user: another user is unaffected", async () => {
    for (let i = 0; i < API_RATE_LIMITS.offlineSync.limit; i++) checkRateLimit("offlineSync", "someone-else", API_RATE_LIMITS.offlineSync);
    checklist.saveChecklistResponseAction.mockResolvedValue({ error: null });
    expect((await POST(req())).status).toBe(200);
  });

  it("refuses to replay an item queued by a different user (409 wrongUser)", async () => {
    const res = await POST(req({ "x-queued-user": "user-2" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, wrongUser: true });
    expect(checklist.saveChecklistResponseAction).not.toHaveBeenCalled();
  });

  it("replays an item queued by the same user", async () => {
    checklist.saveChecklistResponseAction.mockResolvedValue({ error: null, updatedAt: "2026-01-01" });
    const res = await POST(req({ "x-queued-user": "user-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, updatedAt: "2026-01-01" });
  });

  it("answers 422 for a validation failure and 400 for an unknown kind", async () => {
    checklist.saveChecklistResponseAction.mockResolvedValue({ error: "Invalid response value." });
    expect((await POST(req())).status).toBe(422);
    expect((await POST(req({}, { kind: "launch_missiles" }))).status).toBe(400);
  });

  it("answers 500 (retry) when an action throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    checklist.saveChecklistResponseAction.mockRejectedValue(new Error("boom"));
    const res = await POST(req());
    expect(res.status).toBe(500);
  });
});
