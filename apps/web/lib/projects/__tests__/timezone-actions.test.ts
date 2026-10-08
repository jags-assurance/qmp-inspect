import { beforeEach, describe, expect, it, vi } from "vitest";
import { formData, resetTestCtx, sessions } from "@/lib/test-utils/mock-supabase";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/lib/test-utils/mock-supabase")).sessionModule());
vi.mock("next/cache", async () => (await import("@/lib/test-utils/mock-supabase")).nextCacheModule());
vi.mock("next/navigation", async () => (await import("@/lib/test-utils/mock-supabase")).nextNavigationModule());
const audit = vi.hoisted(() => ({ recordAuditEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit/log", () => audit);
vi.mock("@/lib/notifications/helpers", () => ({ createNotification: vi.fn(async () => undefined) }));
vi.mock("@/lib/ai/gate", () => ({ assertAiAllowed: vi.fn() }));
vi.mock("@/lib/ai/config", () => ({ aiErrorMessage: () => "ai error" }));
vi.mock("@/lib/ai/log", () => ({ logAiUsage: vi.fn() }));
vi.mock("@/lib/ai/cache", () => ({ findCachedAiResponse: vi.fn(), hashAiCacheInput: vi.fn() }));
vi.mock("@/lib/ai/gemini-provider", () => ({ geminiProvider: {}, getGeminiModel: () => "m", PROMPT_VERSIONS: {}, withGeminiUsage: vi.fn() }));

import { createProjectAction, updateProjectDetailsAction } from "../actions";
import { parseProjectTimeZone } from "../timezone";

const base = { organization_id: "org-1", project_number: "P-1", name: "Plant" };
const create = (over: Record<string, string> = {}) => createProjectAction({ error: null }, formData({ ...base, ...over }));

describe("parseProjectTimeZone", () => {
  it("accepts IANA zones, treats blank as not provided, rejects the rest", () => {
    expect(parseProjectTimeZone("Asia/Dubai")).toEqual({ ok: true, value: "Asia/Dubai" });
    expect(parseProjectTimeZone(" UTC ")).toEqual({ ok: true, value: "UTC" });
    expect(parseProjectTimeZone("")).toEqual({ ok: true, value: null });
    expect(parseProjectTimeZone("Mars/Olympus")).toMatchObject({ ok: false });
    expect(parseProjectTimeZone("not a zone")).toMatchObject({ ok: false });
  });
});

describe("createProjectAction timezone", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  beforeEach(() => {
    mock = resetTestCtx(sessions.admin());
    mock.on("projects", "insert", { data: { id: "proj-1" } });
  });

  it("saves a valid timezone on the new project", async () => {
    await expect(create({ timezone: "Europe/London" })).rejects.toThrow(/NEXT_REDIRECT/);
    expect(mock.writes("projects", "insert")[0].payload).toMatchObject({ timezone: "Europe/London", project_number: "P-1" });
  });

  it("omits the column when blank so the database default (UTC) applies", async () => {
    await expect(create()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(mock.writes("projects", "insert")[0].payload).not.toHaveProperty("timezone");
  });

  it("rejects an invalid zone before touching the database", async () => {
    const res = await create({ timezone: "Mars/Olympus" });
    expect(res.error).toMatch(/IANA/);
    expect(mock.writes("projects")).toHaveLength(0);
  });
});

describe("updateProjectDetailsAction timezone", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  const existing = { organization_id: "org-1", project_number: "P-1", name: "Plant", site_location: null, country: null, contract_number: null, start_date: null, end_date: null };
  beforeEach(() => {
    mock = resetTestCtx(sessions.admin());
    mock.on("projects", "select", (call) => ({ data: call.columns?.includes("timezone") && !call.columns.includes("organization_id") ? [] : existing }));
    mock.on("projects", "update", { data: [{ id: "proj-1" }] });
  });
  const edit = (over: Record<string, string> = {}) => updateProjectDetailsAction({ error: null }, formData({ project_id: "proj-1", ...base, ...over }));

  it("writes the timezone with the other details", async () => {
    const res = await edit({ timezone: "Asia/Dubai" });
    expect(res.error).toBeNull();
    expect(mock.writes("projects", "update")[0].payload).toMatchObject({ timezone: "Asia/Dubai", name: "Plant" });
  });

  it("leaves the timezone untouched when the field is blank", async () => {
    await edit();
    expect(mock.writes("projects", "update")[0].payload).not.toHaveProperty("timezone");
  });

  it("rejects an invalid zone", async () => {
    expect((await edit({ timezone: "Nowhere/Land" })).error).toMatch(/IANA/);
    expect(mock.writes("projects", "update")).toHaveLength(0);
  });

  it("falls back to saving without the column when it does not exist yet", async () => {
    mock.onOnce("projects", "update", { error: { code: "42703", message: 'column "timezone" of relation "projects" does not exist' } });
    const res = await edit({ timezone: "Asia/Dubai" });
    expect(res.error).toBeNull();
    const updates = mock.writes("projects", "update");
    expect(updates).toHaveLength(2);
    expect(updates[1].payload).not.toHaveProperty("timezone");
  });
});

