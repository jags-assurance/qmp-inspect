import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestCtx, testCtx } from "@/lib/test-utils/mock-supabase";
import { resetRateLimits } from "@/lib/api/rate-limit";

// Replay semantics of POST /api/offline-sync: a queued item may be sent again after a lost response
// (or by the wrong user on a shared tablet) and must never duplicate, overwrite or mis-attribute data.
// The origin / auth / rate-limit gates are covered in offline-sync-route.test.ts.

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
const checklist = vi.hoisted(() => ({
  saveChecklistResponseAction: vi.fn(),
  completeInspectionCore: vi.fn(),
  startInspectionAction: vi.fn(),
  linkInspectionEvidenceDocumentAction: vi.fn(),
}));
vi.mock("@/lib/checklists/actions", () => checklist);
const ncrs = vi.hoisted(() => ({ createNcrAction: vi.fn(), addNcrPhotoAction: vi.fn() }));
vi.mock("@/lib/ncrs/actions", () => ncrs);
vi.mock("@/lib/standalone/actions", () => ({ addMeasurementAction: vi.fn(), addPhotoAction: vi.fn(), addSignatureAction: vi.fn() }));
vi.mock("@/lib/checklists/photo-validation", () => ({ validateOfflinePhoto: vi.fn(async () => ({ error: null })), MAX_PHOTO_BYTES: 25 * 1024 * 1024 }));

import { POST } from "@/app/api/offline-sync/route";

const URL_ = "https://app.example.com/api/offline-sync";

function req(fields: Record<string, string | Blob>, headers: Record<string, string> = {}): Request {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return new Request(URL_, {
    method: "POST",
    headers: { "x-idempotency-key": "key-1", "sec-fetch-site": "same-origin", ...headers },
    body,
  });
}

const checklistFields = { kind: "checklist_response", inspection_record_id: "rec-1", checklist_item_id: "ci-1", result: "yes", comment: " all good " };

describe("offline-sync replays: checklist_response", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  beforeEach(() => {
    resetRateLimits();
    mock = resetTestCtx(null);
    mock.setUser({ id: "user-1" });
    Object.values(checklist).forEach((f) => f.mockReset());
  });

  it("returns the new baseline (updatedAt) after a normal save", async () => {
    checklist.saveChecklistResponseAction.mockResolvedValue({ error: null, updatedAt: "2026-02-01T10:00:00Z" });
    const res = await POST(req(checklistFields));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, updatedAt: "2026-02-01T10:00:00Z" });
  });

  it("treats a conflict as an idempotent replay when the stored answer already equals the queued one (comment compared trimmed)", async () => {
    checklist.saveChecklistResponseAction.mockResolvedValue({ error: "Answer changed on the server.", conflict: true });
    mock.on("checklist_responses", "select", { data: { result: "yes", comment: "all good", updated_at: "2026-02-01T10:00:00Z" } });
    const res = await POST(req(checklistFields));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, updatedAt: "2026-02-01T10:00:00Z" });
    const lookup = mock.calls.find((c) => c.table === "checklist_responses");
    expect(lookup?.filters).toContainEqual(["eq", "inspection_record_id", "rec-1"]);
    expect(lookup?.filters).toContainEqual(["eq", "checklist_item_id", "ci-1"]);
    expect(mock.writes()).toHaveLength(0);
  });

  it("treats a null stored comment as an empty one when replaying an answer without a comment", async () => {
    checklist.saveChecklistResponseAction.mockResolvedValue({ error: "changed", conflict: true });
    mock.on("checklist_responses", "select", { data: { result: "na", comment: null, updated_at: "t1" } });
    const res = await POST(req({ ...checklistFields, result: "na", comment: "" }));
    expect(res.status).toBe(200);
  });

  it("answers 409 conflict (never overwrites) when someone else changed the answer to a different result", async () => {
    checklist.saveChecklistResponseAction.mockResolvedValue({ error: "Answer changed on the server.", conflict: true });
    mock.on("checklist_responses", "select", { data: { result: "no", comment: "all good", updated_at: "t2" } });
    const res = await POST(req(checklistFields));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, conflict: true, error: "Answer changed on the server." });
    expect(mock.writes()).toHaveLength(0);
  });

  it("answers 409 conflict when the comment differs even though the result matches", async () => {
    checklist.saveChecklistResponseAction.mockResolvedValue({ error: "changed", conflict: true });
    mock.on("checklist_responses", "select", { data: { result: "yes", comment: "different note", updated_at: "t2" } });
    expect((await POST(req(checklistFields))).status).toBe(409);
  });

  it("answers 409 conflict when the stored answer cannot be read back", async () => {
    checklist.saveChecklistResponseAction.mockResolvedValue({ error: "changed", conflict: true });
    mock.on("checklist_responses", "select", { data: null });
    const res = await POST(req(checklistFields));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, conflict: true });
  });

  it("answers 422 (rejected, not retried) for a validation error that is not a conflict", async () => {
    checklist.saveChecklistResponseAction.mockResolvedValue({ error: "You don't have permission to answer this checklist." });
    const res = await POST(req(checklistFields));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: "You don't have permission to answer this checklist." });
  });
});

describe("offline-sync replays: complete_inspection", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  const fields = { kind: "complete_inspection", inspection_record_id: "rec-1" };
  beforeEach(() => {
    resetRateLimits();
    mock = resetTestCtx(null);
    mock.setUser({ id: "user-1" });
    Object.values(checklist).forEach((f) => f.mockReset());
  });

  it("completes normally", async () => {
    checklist.completeInspectionCore.mockResolvedValue({ error: null, inspectionRecordId: "rec-1" });
    const res = await POST(req(fields));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it.each([["This inspection has already been completed."], ["Inspection already completed"]])("treats %j as a successful replay when the record has a result", async (message) => {
    checklist.completeInspectionCore.mockResolvedValue({ error: message });
    mock.on("inspection_records", "select", { data: { overall_result: "pass" } });
    const res = await POST(req(fields));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mock.calls.find((c) => c.table === "inspection_records")?.filters).toContainEqual(["eq", "id", "rec-1"]);
    expect(mock.writes()).toHaveLength(0);
  });

  it("does NOT accept 'already completed' when the record shows no overall result (answers 422)", async () => {
    checklist.completeInspectionCore.mockResolvedValue({ error: "This inspection has already been completed." });
    mock.on("inspection_records", "select", { data: { overall_result: null } });
    const res = await POST(req(fields));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false });
  });

  it("does NOT accept 'already completed' when the record cannot be read (answers 422)", async () => {
    checklist.completeInspectionCore.mockResolvedValue({ error: "This inspection has already been completed." });
    mock.on("inspection_records", "select", { data: null });
    expect((await POST(req(fields))).status).toBe(422);
  });

  it("rejects other completion errors (unanswered items, missing evidence) with 422 and never looks the record up", async () => {
    checklist.completeInspectionCore.mockResolvedValue({ error: "Answer every checklist item before completing." });
    const res = await POST(req(fields));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: "Answer every checklist item before completing." });
    expect(mock.calls).toHaveLength(0);
  });
});

describe("offline-sync replays: raise_observation (idempotent through ncrs.request_id)", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  const fields = { kind: "raise_observation", project_id: "proj-1", description: "Loose guard rail at gridline C" };
  const createdNcr = { error: null, created: { id: "ncr-1", ncrNumber: "NCR-001" } };
  beforeEach(() => {
    resetRateLimits();
    mock = resetTestCtx(null);
    mock.setUser({ id: "user-1" });
    Object.values(ncrs).forEach((f) => f.mockReset());
  });

  const passedForm = () => ncrs.createNcrAction.mock.calls[0][1] as FormData;

  it("passes the queued item's key as request_id, forces an observation and stays on the page", async () => {
    ncrs.createNcrAction.mockResolvedValue(createdNcr);
    const res = await POST(req({ ...fields, severity: "major_ncr" }, { "x-idempotency-key": "abc-123" }));
    expect(res.status).toBe(200);
    expect(passedForm().get("request_id")).toBe("abc-123");
    expect(passedForm().get("severity")).toBe("observation");
    expect(passedForm().get("stay_on_page")).toBe("true");
  });

  it("sanitises the key so only [a-zA-Z0-9-] (max 64) reaches the database", async () => {
    ncrs.createNcrAction.mockResolvedValue(createdNcr);
    await POST(req(fields, { "x-idempotency-key": `ab/c_d e!${"9".repeat(80)}` }));
    const requestId = String(passedForm().get("request_id"));
    expect(requestId).toMatch(/^[a-zA-Z0-9-]{1,64}$/);
    expect(requestId.startsWith("abcd")).toBe(true);
  });

  it("keeps a request_id the form already carries", async () => {
    ncrs.createNcrAction.mockResolvedValue(createdNcr);
    await POST(req({ ...fields, request_id: "from-form" }, { "x-idempotency-key": "abc-123" }));
    expect(passedForm().get("request_id")).toBe("from-form");
  });

  it("a replay returns success without a second raise or a second photo (the NCR already exists)", async () => {
    ncrs.createNcrAction.mockResolvedValue(createdNcr);
    const first = await POST(req(fields));
    const replay = await POST(req(fields));
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ ok: true });
    // Both calls carry the same key, which is what lets the unique (project_id, request_id) index dedupe them.
    expect(ncrs.createNcrAction.mock.calls.map((c) => (c[1] as FormData).get("request_id"))).toEqual(["key-1", "key-1"]);
    expect(ncrs.addNcrPhotoAction).not.toHaveBeenCalled();
  });

  it("answers 503 (kept in the queue) while another request with the same key is still in flight", async () => {
    ncrs.createNcrAction.mockResolvedValue({ error: "Still processing", inFlight: true });
    const res = await POST(req(fields));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "Still processing" });
  });

  it("answers 422 (rejected) when the NCR could not be raised, with a fallback message", async () => {
    ncrs.createNcrAction.mockResolvedValue({ error: "Describe the nonconformance (at least 10 characters)." });
    const res = await POST(req(fields));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: "Describe the nonconformance (at least 10 characters)." });
    ncrs.createNcrAction.mockResolvedValue({ error: null });
    const bare = await POST(req(fields));
    expect(bare.status).toBe(422);
    expect(await bare.json()).toEqual({ ok: false, error: "Could not raise the observation." });
  });

  describe("with a photo", () => {
    const photo = () => new File([new Uint8Array([1, 2, 3])], "site photo.jpg", { type: "image/jpeg" });

    it("uploads it to a key-derived path and records it once", async () => {
      ncrs.createNcrAction.mockResolvedValue(createdNcr);
      ncrs.addNcrPhotoAction.mockResolvedValue({ error: null });
      mock.on("ncr_photos", "select", { data: [] });
      const res = await POST(req({ ...fields, file: photo(), file_name: "site photo.jpg" }, { "x-idempotency-key": "abc-123" }));
      expect(res.status).toBe(200);
      const form = ncrs.addNcrPhotoAction.mock.calls[0][1] as FormData;
      expect(form.get("ncr_id")).toBe("ncr-1");
      expect(form.get("storage_path")).toBe("proj-1/ncrs/ncr-1/abc-123-site_photo.jpg");
    });

    it("does not upload or record the photo again when a previous attempt already saved it", async () => {
      ncrs.createNcrAction.mockResolvedValue(createdNcr);
      mock.on("ncr_photos", "select", { data: [{ id: "photo-1" }] });
      const res = await POST(req({ ...fields, file: photo() }, { "x-idempotency-key": "abc-123" }));
      expect(res.status).toBe(200);
      expect(ncrs.addNcrPhotoAction).not.toHaveBeenCalled();
    });

    it("answers 503 (retry, only the photo is repeated) when the upload fails after the NCR was raised", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      ncrs.createNcrAction.mockResolvedValue(createdNcr);
      mock.on("ncr_photos", "select", { data: [] });
      const upload = testCtx.mock.client.storage.from("inspection-evidence").upload as ReturnType<typeof vi.fn>;
      upload.mockResolvedValueOnce({ data: null, error: { message: "storage down" } });
      const res = await POST(req({ ...fields, file: photo() }));
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ ok: false });
      expect(ncrs.addNcrPhotoAction).not.toHaveBeenCalled();
    });

    it("skips a photo that is not an image (it can never succeed) but still reports the raised observation as done", async () => {
      ncrs.createNcrAction.mockResolvedValue(createdNcr);
      const res = await POST(req({ ...fields, file: new File(["x"], "notes.txt", { type: "text/plain" }) }));
      expect(res.status).toBe(200);
      expect(ncrs.addNcrPhotoAction).not.toHaveBeenCalled();
    });

    it("removes the uploaded object and answers 422 when the photo row is refused", async () => {
      ncrs.createNcrAction.mockResolvedValue(createdNcr);
      ncrs.addNcrPhotoAction.mockResolvedValue({ error: "This NCR is closed." });
      mock.on("ncr_photos", "select", { data: [] });
      const bucket = testCtx.mock.client.storage.from("inspection-evidence");
      (bucket.remove as ReturnType<typeof vi.fn>).mockClear();
      const res = await POST(req({ ...fields, file: photo() }, { "x-idempotency-key": "abc-123" }));
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ ok: false, error: "The observation was raised but its photo was not saved: This NCR is closed." });
      expect(bucket.remove).toHaveBeenCalledWith(["proj-1/ncrs/ncr-1/abc-123-photo.jpg"]);
    });
  });
});

describe("offline-sync replays: start_inspection marker", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  const fields = { kind: "start_inspection", project_id: "proj-1" };
  const download = () => testCtx.mock.client.storage.from("inspection-evidence").download as ReturnType<typeof vi.fn>;
  beforeEach(() => {
    resetRateLimits();
    mock = resetTestCtx(null);
    mock.setUser({ id: "user-1" });
    Object.values(checklist).forEach((f) => f.mockReset());
  });
  afterEach(() => {
    download().mockReset();
    download().mockResolvedValue({ data: null, error: { message: "not found" } });
  });

  it("is a no-op when the marker for this key already exists (an earlier attempt started, and maybe completed, the inspection)", async () => {
    download().mockResolvedValue({ data: new Blob(["{}"]), error: null });
    const res = await POST(req(fields, { "x-idempotency-key": "abc-123" }));
    expect(res.status).toBe(200);
    expect(checklist.startInspectionAction).not.toHaveBeenCalled();
    expect(download()).toHaveBeenCalledWith("proj-1/inspections/idem-start-abc-123.json");
    expect(mock.writes()).toHaveLength(0);
  });

  it("starts once, then writes the marker insert-only (never upsert)", async () => {
    download().mockResolvedValue({ data: null, error: { message: "not found" } });
    checklist.startInspectionAction.mockResolvedValue({ error: null });
    const upload = testCtx.mock.client.storage.from("inspection-evidence").upload as ReturnType<typeof vi.fn>;
    upload.mockClear();
    const res = await POST(req(fields, { "x-idempotency-key": "abc-123" }));
    expect(res.status).toBe(200);
    expect(checklist.startInspectionAction).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0]).toBe("proj-1/inspections/idem-start-abc-123.json");
    expect(upload.mock.calls[0][2]).toMatchObject({ upsert: false });
  });

  it("answers 422 and writes no marker when the start is refused", async () => {
    download().mockResolvedValue({ data: null, error: { message: "not found" } });
    checklist.startInspectionAction.mockResolvedValue({ error: "You are not assigned to this activity." });
    const upload = testCtx.mock.client.storage.from("inspection-evidence").upload as ReturnType<typeof vi.fn>;
    upload.mockClear();
    const res = await POST(req(fields, { "x-idempotency-key": "abc-123" }));
    expect(res.status).toBe(422);
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("offline-sync replays: wrongUser (shared tablet)", () => {
  beforeEach(() => {
    resetRateLimits();
    const mock = resetTestCtx(null);
    mock.setUser({ id: "user-1" });
    Object.values(checklist).forEach((f) => f.mockReset());
    Object.values(ncrs).forEach((f) => f.mockReset());
  });

  it.each([
    ["checklist_response", checklistFields],
    ["complete_inspection", { kind: "complete_inspection", inspection_record_id: "rec-1" }],
    ["raise_observation", { kind: "raise_observation", project_id: "proj-1", description: "Loose guard rail at gridline C" }],
    ["start_inspection", { kind: "start_inspection", project_id: "proj-1" }],
  ])("%s queued by another user is refused with 409 wrongUser and nothing is replayed or written", async (_kind, fields) => {
    const res = await POST(req(fields, { "x-queued-user": "user-2" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, wrongUser: true, error: expect.stringMatching(/different user/) });
    for (const fn of [...Object.values(checklist), ...Object.values(ncrs)]) expect(fn).not.toHaveBeenCalled();
    expect(testCtx.mock.writes()).toHaveLength(0);
  });

  it("an item queued by the same user (or one with no recorded owner) is replayed", async () => {
    checklist.saveChecklistResponseAction.mockResolvedValue({ error: null, updatedAt: "t" });
    expect((await POST(req(checklistFields, { "x-queued-user": "user-1" }))).status).toBe(200);
    expect((await POST(req(checklistFields))).status).toBe(200);
    expect(checklist.saveChecklistResponseAction).toHaveBeenCalledTimes(2);
  });
});
