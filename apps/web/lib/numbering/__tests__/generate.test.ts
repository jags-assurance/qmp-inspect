import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateDocumentNumber, nextSequenceNumber, releaseSequence, NumberingError } from "../generate";

type RpcResult = { data: unknown; error: { code?: string; message: string } | null };

/** Minimal client: config selects return no rows, org has default engagement, rpc answers come from `rpc`. */
function fakeClient(rpc: (name: string, args: Record<string, unknown>) => RpcResult) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "returns"]) chain[m] = () => chain;
  chain.maybeSingle = async () => ({ data: { engagement_mode: "standard" }, error: null });
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
  const client = {
    from: () => chain,
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return rpc(name, args);
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const params = { organizationId: "org", projectId: "proj", docType: "ncr" as const, projectNumber: "P-1" };

describe("generateDocumentNumber", () => {
  it("throws NumberingError instead of issuing a timestamp fallback number", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { client } = fakeClient(() => ({ data: null, error: { message: "down" } }));
    await expect(generateDocumentNumber(client, params)).rejects.toBeInstanceOf(NumberingError);
  });

  it("returns a number in the configured default format and can release it", async () => {
    const { client, calls } = fakeClient((name) =>
      name === "next_document_sequence" ? { data: 7, error: null } : { data: true, error: null }
    );
    const generated = await generateDocumentNumber(client, params);
    expect(generated.documentNumber).toContain("007");
    await generated.releaseNumber?.();
    const release = calls.find((c) => c.name === "release_document_sequence");
    expect(release?.args).toMatchObject({ org_id: "org", proj_id: "proj", seq_doc_type: "ncr", released_value: 7 });
  });
});

describe("nextSequenceNumber / releaseSequence", () => {
  it("throws NumberingError when the RPC fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { client } = fakeClient(() => ({ data: null, error: { message: "down" } }));
    await expect(nextSequenceNumber(client, { organizationId: "o", projectId: "p", seqKey: "k" })).rejects.toBeInstanceOf(
      NumberingError
    );
  });

  it("release reports whether the counter was stepped back and tolerates the function being missing", async () => {
    const ok = fakeClient(() => ({ data: true, error: null }));
    expect(await releaseSequence(ok.client, { organizationId: "o", projectId: "p", seqKey: "k", value: 3 })).toBe(true);
    const stale = fakeClient(() => ({ data: false, error: null }));
    expect(await releaseSequence(stale.client, { organizationId: "o", projectId: "p", seqKey: "k", value: 3 })).toBe(false);
    const missing = fakeClient(() => ({ data: null, error: { code: "PGRST202", message: "not found" } }));
    expect(await releaseSequence(missing.client, { organizationId: "o", projectId: "p", seqKey: "k", value: 3 })).toBe(false);
  });
});
