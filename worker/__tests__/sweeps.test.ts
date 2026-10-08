import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testCtx } from "../../apps/web/lib/test-utils/mock-supabase";

vi.mock("../src/supabase", async () => ({ supabase: (await import("../../apps/web/lib/test-utils/mock-supabase")).testCtx.mock.client }));
const automation = vi.hoisted(() => ({ getOrgAdminUserIds: vi.fn(), notify: vi.fn(async () => undefined) }));
vi.mock("../src/automation", () => automation);

const BASE = Date.UTC(2026, 9, 8, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
// Each sweep keeps a module-level "last run" gate, so every test starts a month later than the previous one.
let NOW = BASE;
const mock = testCtx.mock;

beforeEach(() => {
  mock.reset();
  automation.getOrgAdminUserIds.mockReset().mockResolvedValue(["admin-a", "admin-b"]);
  automation.notify.mockClear();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  NOW += 30 * DAY;
});
afterEach(() => vi.restoreAllMocks());

describe("runRetentionSweep", () => {
  const load = async () => (await import("../src/retention")).runRetentionSweep;
  const setting = (org: string, years = 7) => ({ organization_id: org, retention_years: years });
  const oldDoc = (id: string) => ({ id, project_id: "proj-1", created_at: "2010-01-01T00:00:00Z", approved_at: null });

  it("does nothing, and does not mark itself as run, when the settings table is unavailable", async () => {
    const run = await load();
    mock.on("org_retention_settings", "select", { error: { message: "relation does not exist" } });
    expect(await run(NOW)).toBe(0);
    // Not marked as run: the next call tries again straight away.
    mock.on("org_retention_settings", "select", { data: [] });
    expect(await run(NOW + 1000)).toBe(0);
    expect(mock.calls.filter((c) => c.table === "org_retention_settings")).toHaveLength(2);
  });

  it("only reads enabled organisations", async () => {
    const run = await load();
    mock.on("org_retention_settings", "select", { data: [] });
    await run(NOW);
    expect(mock.calls[0].filters).toContainEqual(["eq", "enabled", true]);
  });

  it("flags documents past retention for review, notifies the org admins, and writes nothing else", async () => {
    const run = await load();
    mock.on("org_retention_settings", "select", { data: [setting("org-1")] });
    mock.onRpc("retention_flag_candidates", { data: [oldDoc("d1"), oldDoc("d2")] });
    mock.on("vault_retention_flags", "upsert", { data: [] });

    expect(await run(NOW)).toBe(2);

    expect(mock.writeLog()).toEqual(["vault_retention_flags.upsert"]);
    const [upsert] = mock.writes("vault_retention_flags", "upsert");
    expect(upsert.payload).toEqual([
      expect.objectContaining({ document_id: "d1", organization_id: "org-1", project_id: "proj-1", retention_years: 7, reference_date: "2010-01-01", due_on: "2017-01-01" }),
      expect.objectContaining({ document_id: "d2" }),
    ]);
    expect(upsert.filters).toEqual([]);
    expect(mock.rpcCalls[0]).toMatchObject({ name: "retention_flag_candidates", args: expect.objectContaining({ p_organization_id: "org-1" }) });
    expect(automation.notify).toHaveBeenCalledTimes(2);
    expect(automation.notify).toHaveBeenCalledWith("org-1", null, "admin-a", "2 documents are past the retention period", expect.stringContaining("Nothing has been deleted"), expect.any(String));
  });

  it("never deletes: no storage removal and no delete/update on any table", async () => {
    const run = await load();
    mock.on("org_retention_settings", "select", { data: [setting("org-1")] });
    mock.onRpc("retention_flag_candidates", { data: [oldDoc("d1")] });
    await run(NOW);
    expect(mock.writes().every((c) => c.op === "upsert")).toBe(true);
  });

  it("does not flag a document that is not yet past retention", async () => {
    const run = await load();
    mock.on("org_retention_settings", "select", { data: [setting("org-1", 7)] });
    mock.onRpc("retention_flag_candidates", { data: [{ id: "young", project_id: "p", created_at: "2024-01-01T00:00:00Z", approved_at: null }] });
    expect(await run(NOW)).toBe(0);
    expect(mock.writes()).toHaveLength(0);
    expect(automation.notify).not.toHaveBeenCalled();
  });

  it("skips an organisation with an invalid retention period", async () => {
    const run = await load();
    mock.on("org_retention_settings", "select", { data: [setting("org-bad", 0), setting("org-bad2", 500)] });
    expect(await run(NOW)).toBe(0);
    expect(mock.rpcCalls).toHaveLength(0);
  });

  it("runs at most once a day", async () => {
    const run = await load();
    mock.on("org_retention_settings", "select", { data: [] });
    await run(NOW);
    const callsAfterFirst = mock.calls.length;
    expect(await run(NOW + DAY - 1000)).toBe(0);
    expect(mock.calls).toHaveLength(callsAfterFirst);
    await run(NOW + DAY);
    expect(mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("one organisation failing does not stop the others", async () => {
    const run = await load();
    mock.on("org_retention_settings", "select", { data: [setting("org-1"), setting("org-2")] });
    mock.onRpc("retention_flag_candidates", (args) =>
      (args as { p_organization_id: string }).p_organization_id === "org-1" ? { error: { message: "boom" } } : { data: [oldDoc("d9")] }
    );
    expect(await run(NOW)).toBe(1);
    expect(automation.notify).toHaveBeenCalledWith("org-2", null, "admin-a", expect.any(String), expect.any(String), expect.any(String));
    expect(automation.notify).not.toHaveBeenCalledWith("org-1", expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything());
  });
});

describe("runOrphanPhotoSweep", () => {
  const load = async () => (await import("../src/orphanPhotos")).runOrphanPhotoSweep;
  const candidate = (path: string, org = "org-1") => ({
    storage_path: path,
    project_id: "proj-1",
    organization_id: org,
    inspection_record_id: "rec-1",
    size_bytes: 1234,
    object_created_at: "2026-09-01T00:00:00Z",
  });

  it("does nothing when the candidates RPC is unavailable, and retries on the next cycle", async () => {
    const run = await load();
    mock.onRpc("orphan_photo_candidates", { error: { code: "PGRST202", message: "not found" } });
    expect(await run(NOW)).toBe(0);
    mock.onRpc("orphan_photo_candidates", { data: [candidate("a.jpg")] });
    expect(await run(NOW + 1000)).toBe(1);
  });

  it("only asks for objects older than seven days", async () => {
    const run = await load();
    mock.onRpc("orphan_photo_candidates", { data: [] });
    await run(NOW);
    const args = mock.rpcCalls[0].args as { p_created_before: string };
    expect(Date.parse(args.p_created_before)).toBe(NOW - 7 * DAY);
  });

  it("flags orphans idempotently and tells each organisation's admins how many, without deleting anything", async () => {
    const run = await load();
    mock.onRpc("orphan_photo_candidates", { data: [candidate("a.jpg"), candidate("b.jpg"), candidate("c.jpg", "org-2")] });
    mock.on("orphan_photo_flags", "upsert", { data: [] });

    expect(await run(NOW)).toBe(3);

    expect(mock.writeLog()).toEqual(["orphan_photo_flags.upsert"]);
    expect((mock.writes("orphan_photo_flags", "upsert")[0].payload as unknown[]).length).toBe(3);
    expect(automation.notify).toHaveBeenCalledWith("org-1", null, "admin-a", "2 orphaned photos found in storage", expect.stringContaining("Nothing has been deleted"), "/inspect");
    expect(automation.notify).toHaveBeenCalledWith("org-2", null, "admin-a", "1 orphaned photo found in storage", expect.any(String), "/inspect");
    expect(testCtx.mock.client.storage.from("inspection-evidence").remove).not.toHaveBeenCalled();
  });

  it("pages until a short page and stops", async () => {
    const run = await load();
    const full = Array.from({ length: 500 }, (_, i) => candidate(`p${i}.jpg`));
    mock.onRpc("orphan_photo_candidates", (() => {
      let page = 0;
      return () => ({ data: page++ === 0 ? full : [candidate("last.jpg")] });
    })());
    expect(await run(NOW)).toBe(501);
    expect(mock.rpcCalls).toHaveLength(2);
  });

  it("runs at most once a day", async () => {
    const run = await load();
    mock.onRpc("orphan_photo_candidates", { data: [candidate("a.jpg")] });
    expect(await run(NOW)).toBe(1);
    expect(await run(NOW + DAY - 1000)).toBe(0);
    expect(mock.rpcCalls).toHaveLength(1);
    expect(await run(NOW + DAY)).toBe(1);
  });

  it("surfaces a failed flag insert instead of reporting success", async () => {
    const run = await load();
    mock.onRpc("orphan_photo_candidates", { data: [candidate("a.jpg")] });
    mock.on("orphan_photo_flags", "upsert", { error: { message: "rls" } });
    await expect(run(NOW)).rejects.toThrow("rls");
    expect(automation.notify).not.toHaveBeenCalled();
  });

  it("a notification failure for one organisation does not lose the flags or stop the other notices", async () => {
    const run = await load();
    mock.onRpc("orphan_photo_candidates", { data: [candidate("a.jpg", "org-1"), candidate("b.jpg", "org-2")] });
    automation.getOrgAdminUserIds.mockRejectedValueOnce(new Error("lookup failed")).mockResolvedValue(["admin-z"]);
    expect(await run(NOW)).toBe(2);
    expect(automation.notify).toHaveBeenCalledWith("org-2", null, "admin-z", expect.any(String), expect.any(String), "/inspect");
  });
});
