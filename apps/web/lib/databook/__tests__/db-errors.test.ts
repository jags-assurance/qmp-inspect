import { describe, expect, it } from "vitest";
import { bookTransitionErrorMessage, formatUtcDate, formatUtcDateTime, isMissingDbObject } from "../db-errors";
import { fetchAllRows } from "../helpers";
import { jobStatusText } from "@/lib/reports/pdf-job-labels";

describe("isMissingDbObject", () => {
  it("recognises not-yet-deployed RPCs, columns and tables", () => {
    for (const code of ["42883", "42703", "42P01", "PGRST202", "PGRST204", "PGRST205"]) expect(isMissingDbObject({ code })).toBe(true);
    expect(isMissingDbObject({ message: "Could not find the function public.compile_data_book in the schema cache" })).toBe(true);
    expect(isMissingDbObject({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(isMissingDbObject(null)).toBe(false);
  });
});

describe("bookTransitionErrorMessage", () => {
  it("maps database failures to plain messages", () => {
    expect(bookTransitionErrorMessage("Data Book is not ready to compile: 2 open punch item(s)", "x")).toMatch(/2 open punch item/);
    expect(bookTransitionErrorMessage("Only admin staff can compile a Data Book with an override", "x")).toMatch(/Admin/);
    expect(bookTransitionErrorMessage("An override reason of at least 10 characters is required", "x")).toMatch(/reason/);
    expect(bookTransitionErrorMessage("boom", "fallback")).toBe("fallback");
  });
});

describe("UTC formatting", () => {
  it("labels the zone and does not shift date-only values", () => {
    expect(formatUtcDateTime("2026-10-07T23:30:00Z")).toBe("07 Oct 2026, 23:30 UTC");
    expect(formatUtcDate("2026-10-07")).toBe("07 Oct 2026");
    expect(formatUtcDate(null)).toBe("—");
    expect(formatUtcDateTime("nonsense")).toBe("—");
  });
});

describe("fetchAllRows fails closed", () => {
  it("throws when a page errors instead of reading it as empty", async () => {
    await expect(fetchAllRows<number>(async () => ({ data: null, error: { message: "rls denied" } }))).rejects.toThrow(/rls denied/);
  });
});

describe("failed PDF job text", () => {
  it("hides raw internal errors", () => {
    expect(jobStatusText({ status: "failed", errorMessage: "relation \"x\" does not exist at /srv/app/index.js:10" })).toBe("PDF generation failed. Please try again");
    expect(jobStatusText({ status: "failed", errorMessage: "IRN is voided" })).toContain("IRN is voided");
  });
});
