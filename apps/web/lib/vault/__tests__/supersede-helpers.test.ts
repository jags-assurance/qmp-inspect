import { describe, expect, it } from "vitest";
import { supersedeVaultDocumentsByReference } from "../supersede-refs";
import { supersedeIrnVaultDocuments } from "../irn-void";

// These two helpers are documented "best-effort: returns a count, never throws". Only the branches
// that need no real database are exercised here (the query shape itself is covered by the live
// suites), using a client that fails the test if it is touched when it should not be, and one that
// throws to prove the error is swallowed.
type Client = Parameters<typeof supersedeIrnVaultDocuments>[0];

const untouchable = new Proxy(
  {},
  {
    get() {
      throw new Error("the Supabase client must not be used on this path");
    },
  }
) as unknown as Client;

const alwaysThrowing = {
  from() {
    throw new Error("network down");
  },
} as unknown as Client;

describe("supersedeVaultDocumentsByReference", () => {
  it("does nothing (and never touches the database) when there are no references", async () => {
    await expect(supersedeVaultDocumentsByReference(untouchable, "project-1", [])).resolves.toBe(0);
  });

  it("swallows a database failure and reports 0 updated", async () => {
    await expect(supersedeVaultDocumentsByReference(alwaysThrowing, "project-1", ["NCR-001-CERT"])).resolves.toBe(0);
  });
});

describe("supersedeIrnVaultDocuments", () => {
  it("swallows a database failure and reports 0 updated", async () => {
    await expect(supersedeIrnVaultDocuments(alwaysThrowing, "project-1", "IRN-0001")).resolves.toBe(0);
  });
});
