import { describe, expect, it } from "vitest";
import { buildFormData } from "../sync-client";
import type { OutboxItem } from "../db";

const base: OutboxItem = {
  id: "i1",
  kind: "checklist_response",
  fields: { inspection_record_id: "r", checklist_item_id: "c", result: "na" },
  createdAt: Date.UTC(2026, 9, 13, 10, 0, 0),
  attempts: 0,
  lastError: null,
} as OutboxItem;

describe("buildFormData", () => {
  it("sends the item kind so /api/offline-sync can dispatch it", () => {
    const fd = buildFormData(base);
    expect(fd.get("kind")).toBe("checklist_response");
    expect(fd.get("result")).toBe("na");
    expect(fd.get("captured_at")).toBe("2026-10-13T10:00:00.000Z");
  });
  it("attaches a photo file", () => {
    const fd = buildFormData({ ...base, kind: "photo", file: new Blob(["x"]), fileName: "p.jpg" });
    expect(fd.get("kind")).toBe("photo");
    expect((fd.get("file") as File).name).toBe("p.jpg");
  });
});
