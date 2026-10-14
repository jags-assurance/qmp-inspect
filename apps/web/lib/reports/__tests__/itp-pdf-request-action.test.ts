import { beforeEach, describe, expect, it, vi } from "vitest";
import { formData, resetTestCtx, sessions } from "@/lib/test-utils/mock-supabase";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/lib/test-utils/mock-supabase")).sessionModule());
vi.mock("next/cache", async () => (await import("@/lib/test-utils/mock-supabase")).nextCacheModule());
vi.mock("@/lib/audit/log", () => ({ recordAuditEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/ai/gate", () => ({ assertAiAllowed: vi.fn() }));
vi.mock("@/lib/ai/config", () => ({ aiErrorMessage: () => "ai error" }));
vi.mock("@/lib/ai/sanitize", () => ({ sanitizeAiText: (s: string) => s }));
vi.mock("@/lib/ai/log", () => ({ logAiUsage: vi.fn(), recordAiReviewDecision: vi.fn() }));
vi.mock("@/lib/ai/cache", () => ({ findCachedAiResponse: vi.fn(), hashAiCacheInput: vi.fn() }));
vi.mock("@/lib/ai/gemini-provider", () => ({ geminiProvider: {}, getGeminiModel: () => "m", PROMPT_VERSIONS: {}, withGeminiUsage: vi.fn() }));
vi.mock("@/lib/standalone/actions", () => ({ canRunStandaloneAssignment: vi.fn() }));

import { requestItpPdfAction } from "../actions";

describe("requestItpPdfAction (M7)", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  const req = () => requestItpPdfAction({ error: null }, formData({ itp_id: "itp-1" }));
  beforeEach(() => {
    mock = resetTestCtx(sessions.inspector());
    mock.on("background_jobs", "select", { data: [] });
    mock.on("background_jobs", "insert", { data: [{ id: "j1" }] });
  });
  it("queues a render when none is in flight", async () => {
    expect((await req()).success).toBe(true);
    expect(mock.writes("background_jobs", "insert")).toHaveLength(1);
  });
  it("does not queue a second render while one is queued/processing", async () => {
    mock.on("background_jobs", "select", { data: [{ id: "j0" }] });
    expect((await req()).success).toBe(true);
    expect(mock.writes("background_jobs", "insert")).toHaveLength(0);
  });
});
