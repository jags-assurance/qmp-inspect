import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resetTestCtx, sessions } from "@/lib/test-utils/mock-supabase";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/lib/test-utils/mock-supabase")).sessionModule());
vi.mock("next/cache", async () => (await import("@/lib/test-utils/mock-supabase")).nextCacheModule());
vi.mock("@/lib/audit/log", () => ({ recordAuditEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/vault/notifications", () => ({ notifyDocumentSubmitted: vi.fn(async () => undefined) }));
vi.mock("@/lib/vault/extract-text", () => ({ extractTextFromFile: vi.fn() }));
vi.mock("@/lib/numbering/generate", () => ({
  generateDocumentNumber: vi.fn(async () => ({ documentNumber: "DOC-001", internalReference: null })),
  NumberingError: class NumberingError extends Error {},
}));

import { uploadVaultDocumentCore } from "../actions";

const base = {
  folderId: "fold-1",
  projectId: "proj-1",
  title: "Spec",
  documentReference: "",
  revision: "0",
  documentDate: "",
  notes: "",
  fileSize: "100",
  uploadedBy: "user-1",
};

describe("uploadVaultDocumentCore orphan cleanup", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  beforeEach(() => {
    mock = resetTestCtx(sessions.inspector());
    mock.on("vault_folders", "select", { data: { id: "fold-1" } });
    mock.on("projects", "select", { data: { project_number: "P1", organization_id: "org-1" } });
    (mock.client.storage.from("inspection-evidence") as unknown as { remove: ReturnType<typeof vi.fn> }).remove.mockReset().mockResolvedValue({ data: [], error: null });
  });

  const remove = () => (mock.client.storage.from("inspection-evidence") as unknown as { remove: ReturnType<typeof vi.fn> }).remove;
  const run = (storagePath: string) => uploadVaultDocumentCore(mock.client as unknown as SupabaseClient, { ...base, storagePath });

  it("removes the uploaded object and reports the error when the row insert fails", async () => {
    mock.on("vault_documents", "insert", { data: null, error: { message: "rls" } });
    const res = await run("vault/proj-1/specifications/1-a.pdf");
    expect(res.error).toMatch(/Could not save the document record/);
    expect(remove()).toHaveBeenCalledWith(["vault/proj-1/specifications/1-a.pdf"]);
  });

  it("still reports the save error when the cleanup itself throws", async () => {
    mock.on("vault_documents", "insert", { data: null, error: { message: "rls" } });
    remove().mockRejectedValueOnce(new Error("boom"));
    const res = await run("vault/proj-1/specifications/1-a.pdf");
    expect(res.error).toMatch(/Could not save the document record/);
  });

  it("never removes a path outside this project's vault prefix", async () => {
    mock.on("vault_documents", "insert", { data: null, error: { message: "rls" } });
    await run("vault/other-proj/specifications/1-a.pdf");
    await run("vault/proj-1/../other/x.pdf");
    expect(remove()).not.toHaveBeenCalled();
  });

  it("does not remove anything when the row is saved", async () => {
    mock.on("vault_documents", "insert", { data: { id: "doc-1" } });
    mock.on("vault_documents", "update", { data: [] });
    const res = await run("vault/proj-1/specifications/1-a.pdf");
    expect(res.error).toBeNull();
    expect(remove()).not.toHaveBeenCalled();
  });
});
