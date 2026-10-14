import { describe, expect, it, vi } from "vitest";
import { createMockSupabase } from "@/lib/test-utils/mock-supabase";
import { snapshotInitialIssue, snapshotApprovedRevision } from "../revisions";

function setup() {
  const mock = createMockSupabase();
  mock.on("itps", "select", { data: { id: "itp-1", revision: 0, title: "T", scope: null, applicable_standard: null } });
  mock.on("itp_sections", "select", { data: [] });
  mock.on("itp_revisions", "select", { data: null });
  return mock;
}

describe("baseline snapshots", () => {
  it("returns null on success", async () => {
    const mock = setup();
    expect(await snapshotInitialIssue(mock.client, "itp-1", "u1")).toBeNull();
    expect(mock.writes("itp_revisions", "insert")).toHaveLength(1);
  });

  it("is idempotent: no second insert when the row exists", async () => {
    const mock = setup();
    mock.on("itp_revisions", "select", { data: { id: "rev-0" } });
    expect(await snapshotApprovedRevision(mock.client, "itp-1", "u1")).toBeNull();
    expect(mock.writes("itp_revisions")).toHaveLength(0);
  });

  it("retries once and then reports the error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mock = setup();
    mock.on("itp_revisions", "insert", { error: { message: "db down" } });
    expect(await snapshotInitialIssue(mock.client, "itp-1", "u1")).toBe("db down");
    expect(mock.writes("itp_revisions", "insert")).toHaveLength(2);
  });

  it("succeeds when the retry works", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const mock = setup();
    mock.onOnce("itp_revisions", "insert", { error: { message: "blip" } });
    expect(await snapshotInitialIssue(mock.client, "itp-1", "u1")).toBeNull();
  });
});
