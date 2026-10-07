import { describe, expect, it } from "vitest";
import {
  MAX_SERVER_FAILURES,
  STALE_QUEUE_DAYS,
  backoffMs,
  boundedCapturedAt,
  classifyHttpFailure,
  isStaleItem,
  mayReplayItem,
  queueAgeDays,
  responseKey,
} from "../policy";
import { isMissingSchemaError, isStoragePermissionError } from "../missing-schema";

describe("backoffMs", () => {
  it("doubles from 30s and caps at 30 minutes", () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(3)).toBe(120_000);
    expect(backoffMs(50)).toBe(30 * 60_000);
  });
  it("treats zero or negative as the first failure", () => {
    expect(backoffMs(0)).toBe(30_000);
  });
  it("has a retry budget of five server failures", () => {
    expect(MAX_SERVER_FAILURES).toBe(5);
  });
});

describe("classifyHttpFailure", () => {
  it("maps auth, conflict, size and validation statuses", () => {
    expect(classifyHttpFailure(401, true)).toBe("auth");
    expect(classifyHttpFailure(429, true)).toBe("network");
    expect(classifyHttpFailure(403, false)).toBe("auth");
    expect(classifyHttpFailure(409, true)).toBe("conflict");
    expect(classifyHttpFailure(413, false)).toBe("too_large");
    expect(classifyHttpFailure(422, true)).toBe("rejected");
    expect(classifyHttpFailure(400, true)).toBe("rejected");
  });
  it("counts a 5xx from our handler as a server failure but a bare gateway 5xx as network", () => {
    expect(classifyHttpFailure(500, true)).toBe("server");
    expect(classifyHttpFailure(503, true)).toBe("server");
    expect(classifyHttpFailure(502, false)).toBe("network");
    expect(classifyHttpFailure(504, false)).toBe("network");
  });
});

describe("mayReplayItem", () => {
  it("replays unowned legacy items for anyone", () => {
    expect(mayReplayItem(undefined, "u1")).toBe(true);
    expect(mayReplayItem(undefined, null)).toBe(true);
  });
  it("only replays an owned item for its owner", () => {
    expect(mayReplayItem("u1", "u1")).toBe(true);
    expect(mayReplayItem("u1", "u2")).toBe(false);
    expect(mayReplayItem("u1", null)).toBe(false);
  });
});

describe("queue age", () => {
  const day = 86_400_000;
  it("counts whole days and flags stale items", () => {
    const now = 10 * day;
    expect(queueAgeDays(now - 2.5 * day, now)).toBe(2);
    expect(isStaleItem(now - (STALE_QUEUE_DAYS - 1) * day, now)).toBe(false);
    expect(isStaleItem(now - STALE_QUEUE_DAYS * day, now)).toBe(true);
  });
});

describe("responseKey", () => {
  it("identifies one answer by record and item", () => {
    expect(responseKey({ kind: "checklist_response", fields: { inspection_record_id: "r", checklist_item_id: "i" } })).toBe("r:i");
    expect(responseKey({ kind: "photo", fields: { inspection_record_id: "r", checklist_item_id: "i" } })).toBeNull();
    expect(responseKey({ kind: "checklist_response", fields: { inspection_record_id: "r" } })).toBeNull();
  });
});

describe("boundedCapturedAt", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  it("accepts a recent past time", () => {
    expect(boundedCapturedAt("2026-10-07T08:00:00Z", now)).toBe("2026-10-07T08:00:00.000Z");
  });
  it("rejects future, too old, empty and garbage values", () => {
    expect(boundedCapturedAt("2026-10-08T08:00:00Z", now)).toBeNull();
    expect(boundedCapturedAt("2026-08-01T08:00:00Z", now)).toBeNull();
    expect(boundedCapturedAt("", now)).toBeNull();
    expect(boundedCapturedAt(null, now)).toBeNull();
    expect(boundedCapturedAt("not a date", now)).toBeNull();
  });
  it("tolerates a few minutes of clock skew", () => {
    expect(boundedCapturedAt("2026-10-07T12:03:00Z", now)).not.toBeNull();
  });
});

describe("schema error helpers", () => {
  it("recognises missing column / table / function codes", () => {
    for (const code of ["42703", "42P01", "42883", "PGRST202", "PGRST204", "PGRST205"]) {
      expect(isMissingSchemaError({ code })).toBe(true);
    }
    expect(isMissingSchemaError({ code: "23505" })).toBe(false);
    expect(isMissingSchemaError(null)).toBe(false);
    expect(isMissingSchemaError({ message: "Could not find the 'client_key' column of 'x' in the schema cache" })).toBe(true);
  });
  it("recognises storage permission refusals", () => {
    expect(isStoragePermissionError({ message: "new row violates row-level security policy" })).toBe(true);
    expect(isStoragePermissionError({ statusCode: 403 })).toBe(true);
    expect(isStoragePermissionError({ message: "timeout", statusCode: 500 })).toBe(false);
  });
});

import { formatQueueAge } from "../policy";

describe("formatQueueAge", () => {
  const now = 1_000_000_000_000;
  it("formats minutes, hours and days", () => {
    expect(formatQueueAge(now - 10_000, now)).toBe("just now");
    expect(formatQueueAge(now - 12 * 60_000, now)).toBe("12 min");
    expect(formatQueueAge(now - 3 * 3_600_000, now)).toBe("3 h");
    expect(formatQueueAge(now - 72 * 3_600_000, now)).toBe("3 days");
  });
  it("never goes negative for future timestamps", () => {
    expect(formatQueueAge(now + 5_000, now)).toBe("just now");
  });
});
