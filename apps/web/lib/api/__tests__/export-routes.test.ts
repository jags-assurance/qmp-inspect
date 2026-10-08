import { beforeEach, describe, expect, it, vi } from "vitest";
import { RedirectError, resetTestCtx, sessions, testCtx } from "@/lib/test-utils/mock-supabase";
import { API_RATE_LIMITS, checkRateLimit, resetRateLimits, type RateLimitBucket } from "@/lib/api/rate-limit";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/lib/test-utils/mock-supabase")).sessionModule());
vi.mock("next/navigation", async () => (await import("@/lib/test-utils/mock-supabase")).nextNavigationModule());
vi.mock("@/lib/supabase/service", () => ({ isServiceRoleConfigured: () => true, createSupabaseServiceRoleClient: () => ({}) }));
vi.mock("@/lib/vault/actions", () => ({ uploadVaultDocumentCore: vi.fn() }));

import { GET as registersExport } from "@/app/api/registers/export/route";
import { GET as registersCertificate } from "@/app/api/registers/certificate/route";
import { GET as registersUsageExport } from "@/app/api/registers/usage-export/route";
import { GET as itpsExport } from "@/app/api/itps/export/route";
import { GET as itpExportDocx } from "@/app/api/itps/[id]/export-docx/route";
import { GET as itpExportXlsx } from "@/app/api/itps/[id]/export-xlsx/route";
import { GET as libraryExport } from "@/app/api/checklist-library/[id]/export/route";
import { GET as vaultDownloadAll } from "@/app/api/vault/[projectId]/download-all/route";
import { POST as emailInbound } from "@/app/api/vault/email-inbound/route";

const get = (path: string) => new Request(`https://app.example.com${path}`);
const idParams = { params: Promise.resolve({ id: "id-1" }) };

/** Routes that authenticate through supabase.auth.getUser() and return a JSON 401. */
const apiUserRoutes: { name: string; call: () => Promise<Response> }[] = [
  { name: "registers/export", call: async () => registersExport(get("/api/registers/export?kind=calibration&project_id=p1")) },
  { name: "registers/certificate", call: async () => registersCertificate(get("/api/registers/certificate?kind=calibration&id=e1")) },
  { name: "registers/usage-export", call: async () => registersUsageExport(get("/api/registers/usage-export?kind=calibration&id=e1")) },
  { name: "itps/export", call: async () => itpsExport(get("/api/itps/export")) },
  { name: "itps/[id]/export-docx", call: async () => itpExportDocx(get("/api/itps/id-1/export-docx"), idParams) },
  { name: "itps/[id]/export-xlsx", call: async () => itpExportXlsx(get("/api/itps/id-1/export-xlsx"), idParams) },
];

describe("export routes: unauthenticated -> 401, over budget -> 429", () => {
  beforeEach(() => {
    resetRateLimits();
    resetTestCtx(sessions.external()).setUser({ id: "user-1" });
  });

  it.each(apiUserRoutes)("$name returns 401 without a session and reads no data", async ({ call }) => {
    testCtx.mock.setUser(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(testCtx.mock.calls).toHaveLength(0);
  });

  it.each(apiUserRoutes)("$name returns 429 with Retry-After once the export budget is spent", async ({ call }) => {
    for (let i = 0; i < API_RATE_LIMITS.export.limit; i++) checkRateLimit("export", "user-1", API_RATE_LIMITS.export);
    const res = await call();
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(await res.json()).toMatchObject({ ok: false });
    expect(testCtx.mock.calls).toHaveLength(0);
  });

  it("rate limits are per user, not global", async () => {
    for (let i = 0; i < API_RATE_LIMITS.export.limit; i++) checkRateLimit("export", "someone-else", API_RATE_LIMITS.export);
    const res = await registersExport(get("/api/registers/export?kind=calibration&project_id=p1&template=1"));
    expect(res.status).toBe(200);
  });

  it("registers/export validates its parameters before authenticating (400)", async () => {
    testCtx.mock.setUser(null);
    expect((await registersExport(get("/api/registers/export?kind=nope&project_id=p1"))).status).toBe(400);
  });

  it("registers/certificate hides the existence of a file the caller cannot see (404)", async () => {
    const res = await registersCertificate(get("/api/registers/certificate?kind=calibration&id=e1"));
    expect(res.status).toBe(404);
  });
});

describe("session-based routes", () => {
  beforeEach(() => {
    resetRateLimits();
    resetTestCtx(sessions.external());
  });

  it("checklist-library export redirects an unauthenticated caller to login", async () => {
    testCtx.session = null;
    await expect(libraryExport(get("/x"), idParams)).rejects.toBeInstanceOf(RedirectError);
  });

  it("checklist-library export is 403 for a non-staff user and reads nothing", async () => {
    const res = await libraryExport(get("/x"), idParams);
    expect(res.status).toBe(403);
    expect(testCtx.mock.calls).toHaveLength(0);
  });

  it("checklist-library export is 429 when over budget, ahead of any permission work", async () => {
    for (let i = 0; i < API_RATE_LIMITS.export.limit; i++) checkRateLimit("export", "external-1", API_RATE_LIMITS.export);
    expect((await libraryExport(get("/x"), idParams)).status).toBe(429);
  });

  it("checklist-library export lets staff through to the template lookup (404 when missing)", async () => {
    testCtx.session = sessions.inspector();
    expect((await libraryExport(get("/x"), idParams)).status).toBe(404);
    expect(testCtx.mock.calls.length).toBeGreaterThan(0);
  });

  it("vault download-all redirects an unauthenticated caller to login", async () => {
    testCtx.session = null;
    const call = vaultDownloadAll(new (await import("next/server")).NextRequest("https://app.example.com/api/vault/p1/download-all"), { params: Promise.resolve({ projectId: "p1" }) });
    await expect(call).rejects.toBeInstanceOf(RedirectError);
  });

  it("vault download-all is 429 after the bulk-download budget (5 per 10 minutes)", async () => {
    const rule = API_RATE_LIMITS.bulkDownload as { limit: number; windowMs: number };
    const bucket: RateLimitBucket = "bulkDownload";
    for (let i = 0; i < rule.limit; i++) checkRateLimit(bucket, "external-1", rule);
    const { NextRequest } = await import("next/server");
    const res = await vaultDownloadAll(new NextRequest("https://app.example.com/api/vault/p1/download-all"), { params: Promise.resolve({ projectId: "p1" }) });
    expect(res.status).toBe(429);
  });

  it("vault download-all rejects a selection with no valid ids (400)", async () => {
    const { NextRequest } = await import("next/server");
    const res = await vaultDownloadAll(new NextRequest("https://app.example.com/api/vault/p1/download-all?ids=not-a-uuid"), { params: Promise.resolve({ projectId: "p1" }) });
    expect(res.status).toBe(400);
  });

  it("vault download-all gives a non-staff caller a 403 when none of the selected documents are approved", async () => {
    testCtx.mock.on("vault_folders", "select", { data: [{ id: "f1", name: "General" }] });
    testCtx.mock.on("vault_documents", "select", { data: [] });
    const { NextRequest } = await import("next/server");
    const id = "11111111-1111-1111-1111-111111111111";
    const res = await vaultDownloadAll(new NextRequest(`https://app.example.com/api/vault/p1/download-all?ids=${id}`), { params: Promise.resolve({ projectId: "p1" }) });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/vault/email-inbound (shared secret)", () => {
  const post = (headers: Record<string, string> = {}) =>
    emailInbound(new Request("https://app.example.com/api/vault/email-inbound", { method: "POST", headers, body: "{}" }));
  beforeEach(() => {
    process.env.VAULT_EMAIL_WEBHOOK_SECRET = "s3cret";
    resetTestCtx(null);
  });

  it("is 401 with no secret, a wrong secret, or a secret in the query string", async () => {
    expect((await post()).status).toBe(401);
    expect((await post({ "x-vault-webhook-secret": "wrong" })).status).toBe(401);
    const viaQuery = await emailInbound(new Request("https://app.example.com/api/vault/email-inbound?secret=s3cret", { method: "POST", body: "{}" }));
    expect(viaQuery.status).toBe(401);
  });

  it("rejects every request when no secret is configured on the deployment", async () => {
    delete process.env.VAULT_EMAIL_WEBHOOK_SECRET;
    expect((await post({ "x-vault-webhook-secret": "anything" })).status).toBe(401);
    expect((await post({ authorization: "Bearer " })).status).toBe(401);
  });

  it("accepts the secret via header or bearer token and moves on to payload validation (400)", async () => {
    expect((await post({ "x-vault-webhook-secret": "s3cret" })).status).toBe(400);
    expect((await post({ authorization: "Bearer s3cret" })).status).toBe(400);
  });
});
