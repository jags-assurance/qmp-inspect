import { describe, it, expect } from "vitest";
import path from "node:path";
// Pure helpers behind scripts/export-storage.mjs (F-06). Plain ESM, no types.
// @ts-expect-error -- .mjs without declarations
import * as lib from "../../scripts/lib/storage-export.mjs";

describe("parseArgs", () => {
  it("defaults", () => {
    expect(lib.parseArgs([])).toMatchObject({ out: null, buckets: null, since: null, concurrency: 4, dryRun: false, verify: true });
  });
  it("parses space and = forms, lists and booleans", () => {
    const o = lib.parseArgs(["--out", "/b", "--buckets=a, b ,c", "--since", "2026-11-01", "--concurrency=8", "--dry-run", "--no-verify"]);
    expect(o.out).toBe("/b");
    expect(o.buckets).toEqual(["a", "b", "c"]);
    expect(o.since).toBe("2026-11-01T00:00:00.000Z");
    expect(o.concurrency).toBe(8);
    expect(o.dryRun).toBe(true);
    expect(o.verify).toBe(false);
  });
  it("rejects typos and bad values instead of exporting the wrong thing", () => {
    expect(() => lib.parseArgs(["--bucket", "x"])).toThrow(/Unknown option/);
    expect(() => lib.parseArgs(["--concurrency", "0"])).toThrow();
    expect(() => lib.parseArgs(["--concurrency", "99"])).toThrow();
    expect(() => lib.parseArgs(["--since", "not a date"])).toThrow();
    expect(() => lib.parseArgs(["--out"])).toThrow(/needs a value/);
    expect(() => lib.parseArgs(["--out", "--dry-run"])).toThrow(/needs a value/);
    expect(() => lib.parseArgs(["stray"])).toThrow(/Unexpected argument/);
    expect(() => lib.parseArgs(["--buckets", " , "])).toThrow();
  });
});

describe("safeLocalPath", () => {
  const out = path.resolve("/backups/run1");
  it("maps a normal object path under <out>/<bucket>", () => {
    expect(lib.safeLocalPath(out, "generated-documents", "irns/abc/IRN-1.pdf")).toBe(path.join(out, "generated-documents", "irns", "abc", "IRN-1.pdf"));
  });
  it("refuses anything that could escape the bucket folder", () => {
    for (const bad of ["../x", "a/../../x", "/etc/passwd", "a//b", "./a", "a/./b", "a\\b", "", "a\0b"]) {
      expect(lib.safeLocalPath(out, "b", bad)).toBeNull();
    }
    expect(lib.safeLocalPath(out, "..", "a")).toBeNull();
    expect(lib.safeLocalPath(out, "a/b", "a")).toBeNull();
    expect(lib.safeLocalPath(out, "", "a")).toBeNull();
  });
});

describe("encodeObjectPath", () => {
  it("encodes each segment but keeps the slashes", () => {
    expect(lib.encodeObjectPath("proj 1/photo #2.jpg")).toBe("proj%201/photo%20%232.jpg");
  });
});

describe("splitListing", () => {
  it("separates folders (null id) from files and builds full paths", () => {
    const { folders, files } = lib.splitListing(
      [
        { name: "irns", id: null },
        { name: "a.pdf", id: "1", updated_at: "2026-11-01T00:00:00Z", metadata: { size: 12, eTag: '"x"' } },
        { name: "", id: "2" },
        null,
      ],
      "root"
    );
    expect(folders).toEqual(["root/irns"]);
    expect(files).toEqual([{ path: "root/a.pdf", size: 12, updatedAt: "2026-11-01T00:00:00Z", etag: '"x"' }]);
  });
  it("uses bare names at the bucket root", () => {
    expect(lib.splitListing([{ name: "x.png", id: "1", metadata: {} }], "").files[0].path).toBe("x.png");
    expect(lib.splitListing(undefined, "")).toEqual({ folders: [], files: [] });
  });
});

describe("changedSince / canSkipDownload", () => {
  it("incremental filter keeps newer and untimestamped objects", () => {
    const since = "2026-11-05T00:00:00.000Z";
    expect(lib.changedSince({ updatedAt: "2026-11-06T00:00:00Z" }, since)).toBe(true);
    expect(lib.changedSince({ updatedAt: "2026-11-05T00:00:00Z" }, since)).toBe(true);
    expect(lib.changedSince({ updatedAt: "2026-11-04T23:59:59Z" }, since)).toBe(false);
    expect(lib.changedSince({ updatedAt: null }, since)).toBe(true);
    expect(lib.changedSince({ updatedAt: "2020-01-01T00:00:00Z" }, null)).toBe(true);
  });
  it("resumes only complete files of the expected size", () => {
    expect(lib.canSkipDownload(100, 100)).toBe(true);
    expect(lib.canSkipDownload(50, 100)).toBe(false);
    expect(lib.canSkipDownload(null, 100)).toBe(false);
    expect(lib.canSkipDownload(0, 0)).toBe(false);
  });
});

describe("formatBytes / summarise / defaultOutDir", () => {
  it("formats sizes", () => {
    expect(lib.formatBytes(0)).toBe("0 B");
    expect(lib.formatBytes(1536)).toBe("1.5 KB");
    expect(lib.formatBytes(5 * 1024 ** 3)).toBe("5.0 GB");
    expect(lib.formatBytes(-1)).toBe("?");
  });
  it("totals results", () => {
    expect(
      lib.summarise([
        { status: "downloaded", size: 10 },
        { status: "skipped", size: 5 },
        { status: "failed", size: 0 },
      ])
    ).toEqual({ objects: 3, bytes: 15, downloaded: 1, skipped: 1, failed: 1 });
  });
  it("names the default folder with a filesystem-safe UTC stamp", () => {
    expect(lib.defaultOutDir(new Date("2026-11-11T03:15:00.123Z"))).toBe("storage-backup-20261111T031500Z");
  });
  it("covers the three production buckets by default", () => {
    expect(lib.DEFAULT_BUCKETS).toEqual(["generated-documents", "inspection-evidence", "org-branding"]);
  });
});
